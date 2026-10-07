// Servicios del panel del supervisor (/admin): trabajadoras (contratos), importación desde el Excel de control,
// cuentas del mes y parámetros. Las rutas de src/app/api/admin/** son delgadas y solo llaman a estas funciones.
// Ver docs/ADMIN.md. Nunca se registran datos personales en logs.

import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { addMonths, ESTADO_EMOJI, ESTADO_TEXTO, monthsBetween, parseYMD, type Estado } from '../lib/calc';
import { nombreLimpio } from './archivos';
import type { BlobStore } from './blob';
import type { Db } from './db';
import { cargas, contratos, documentos, lecturas, parametros, type AdicionalGuardada, type ContratoFila, type Parametros } from './db/schema';
import { CAMPOS_AUDITADOS_ADMIN, diferencias, registrarCambios } from './cambios';
import {
  CORREO_RE,
  MAX_ENTERO,
  MENSAJE_CORREO,
  MENSAJE_FECHA_CONTRATO,
  MENSAJE_FIN_ANTES_DE_INICIO,
  MENSAJE_VALOR_TOTAL_MENOR,
  monto,
  mesValido,
  normTxt,
  RIESGOS,
  riesgoRomano,
} from './entrada';
import { ErrorAmable, ErrorValidacion, MENSAJE_GENERICO } from './errores';
import { MAX_BYTES_IMPORTAR, parsearExcelControl } from './importar';
import { cargarParametros, mesActual, recalcularAcumulados, type Deps } from './servicios';

const MSG_NO_TRABAJADORA = 'No encontramos a esa trabajadora.';
const MSG_NO_CARGA = 'No encontramos esa cuenta de cobro.';

export type ContratoAdmin = ContratoFila & { cargas: number };

function porNombre(a: string, b: string): number {
  const x = normTxt(a),
    y = normTxt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

// =================================================================== validación de contratos
const CAMPOS_TEXTO: Array<[keyof ContratoFila, number, string]> = [
  ['direccion', 200, 'La dirección'],
  ['telefono', 40, 'El teléfono'],
  ['ciudad', 100, 'La ciudad'],
  ['cargo', 200, 'El cargo'],
  ['numeroContrato', 60, 'El número de contrato'],
  ['objeto', 3000, 'El objeto'],
  ['linea', 200, 'La línea política pública'],
  ['revisoNombre', 200, 'El nombre de quien revisó'],
  ['revisoCargo', 200, 'El cargo de quien revisó'],
];

type ValoresContrato = Omit<typeof contratos.$inferInsert, 'id'>;

/** snake_case -> camelCase (el cliente puede mandar `valor_total` o `valorTotal`). */
function aCamel(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) r[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  return r;
}

function vacio(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Cédula escrita con puntos/espacios -> solo dígitos ('' si trae letras u otros signos). */
function soloDigitos(v: unknown): string {
  const s = String(v ?? '').replace(/[\s.]/g, '');
  return /^\d*$/.test(s) ? s : '';
}

/**
 * Valida y limpia los datos de una trabajadora. `base` = la fila actual (PUT: lo que no viene se conserva) o null (POST).
 * `otros` = las demás trabajadoras (para nombre y cédula únicos). Lanza ErrorValidacion con TODOS los errores por campo.
 */
export function validarContrato(
  entrada: Record<string, unknown>,
  base: ContratoFila | null,
  otros: ContratoFila[],
  /** Mensajes de "ya existe" distintos a los del panel (el registro público no dice "otra trabajadora"). */
  mensajes: { nombreRepetido?: string; cedulaRepetida?: string } = {},
): ValoresContrato {
  const e = aCamel(entrada);
  const get = (k: keyof ContratoFila): unknown => (k in e ? e[k] : base ? base[k] : undefined);
  const err: Record<string, string> = {};

  // nombre: único sin tildes / mayúsculas / espacios repetidos
  let nombre = '';
  {
    const v = get('nombre');
    nombre = typeof v === 'string' ? v.trim() : '';
    if (!nombre) err.nombre = 'Escribe el nombre completo de la trabajadora.';
    else if (nombre.length > 150) err.nombre = 'El nombre es demasiado largo (máximo 150 letras).';
    else if (otros.some((o) => normTxt(o.nombre) === normTxt(nombre))) {
      err.nombre =
        mensajes.nombreRepetido ??
        'Ya hay otra trabajadora con ese nombre (no se distinguen tildes ni mayúsculas). El nombre es con el que entra al celular, no se puede repetir.';
    }
  }

  // cédula: solo dígitos, 6-10, única
  let cedula = '';
  {
    const v = get('cedula');
    cedula = soloDigitos(v);
    if (vacio(v)) err.cedula = 'Escribe la cédula (solo números).';
    else if (!/^\d{6,10}$/.test(cedula)) err.cedula = 'La cédula debe tener solo números, entre 6 y 10 dígitos.';
    else if (otros.some((o) => o.cedula === cedula)) err.cedula = mensajes.cedulaRepetida ?? 'Ya hay otra trabajadora con esa cédula.';
  }

  // riesgo
  let riesgo = 'I';
  {
    const v = get('riesgo');
    if (vacio(v)) {
      if (base) err.riesgo = 'Escoge el riesgo ARL (I, II, III, IV o V).';
    } else {
      const r = riesgoRomano(v);
      if (r) riesgo = r;
      else err.riesgo = 'El riesgo ARL debe ser I, II, III, IV o V.';
    }
  }
  let riesgoNuevo = '';
  {
    const v = get('riesgoNuevo');
    if (!vacio(v)) {
      const r = riesgoRomano(v);
      if (r) riesgoNuevo = r;
      else err.riesgoNuevo = 'El riesgo nuevo debe ser I, II, III, IV o V (o déjalo vacío).';
    }
  }
  let riesgoDesde: string | null = null;
  if (riesgoNuevo) {
    const v = get('riesgoDesde');
    const f = vacio(v) ? null : parseYMD(String(v).trim());
    if (vacio(v)) err.riesgoDesde = 'Si hay riesgo nuevo, indica desde cuándo rige (el día 1 de un mes).';
    else if (!f) err.riesgoDesde = 'La fecha "riesgo desde" no es válida. Usa el formato AAAA-MM-DD.';
    else if (f.d !== 1) err.riesgoDesde = 'El riesgo nuevo rige desde el día 1 de un mes (por ejemplo 2026-06-01).';
    else riesgoDesde = String(v).trim();
  }

  // fechas del contrato (pueden ir vacías: contrato "por completar")
  const fecha = (k: 'inicio' | 'fin'): string | null => {
    const v = get(k);
    if (vacio(v)) return null;
    if (!parseYMD(String(v).trim())) {
      err[k] = MENSAJE_FECHA_CONTRATO[k];
      return null;
    }
    return String(v).trim();
  };
  const inicio = fecha('inicio');
  const fin = fecha('fin');
  if (inicio && fin && fin < inicio && !err.fin) err.fin = MENSAJE_FIN_ANTES_DE_INICIO;

  // dinero
  const dinero = (k: 'honorario' | 'valorTotal', etiqueta: string): number | null => {
    const v = get(k);
    if (vacio(v)) return null;
    const n = monto(v);
    if (n === null || n <= 0 || n > MAX_ENTERO) {
      err[k] = `${etiqueta} debe ser un valor en pesos mayor que cero (por ejemplo 7.174.000).`;
      return null;
    }
    return n;
  };
  const honorario = dinero('honorario', 'El honorario');
  const valorTotal = dinero('valorTotal', 'El valor total del contrato');
  if (honorario !== null && valorTotal !== null && valorTotal < honorario && !err.valorTotal) {
    err.valorTotal = MENSAJE_VALOR_TOTAL_MENOR;
  }

  // correo
  let correo = '';
  {
    const v = get('correo');
    correo = vacio(v) ? '' : String(v).trim();
    if (correo && (correo.length > 200 || !CORREO_RE.test(correo))) err.correo = MENSAJE_CORREO;
  }

  // activo
  let activo = true;
  {
    const v = get('activo');
    if (typeof v === 'boolean') activo = v;
    else if (v === 'true' || v === 'false') activo = v === 'true';
    else if (v !== undefined && v !== null) err.activo = 'Indica si la trabajadora está activa (sí o no).';
  }

  // textos libres
  const textos: Record<string, string> = {};
  for (const [k, max, etiqueta] of CAMPOS_TEXTO) {
    const v = get(k);
    const s = vacio(v) ? '' : String(v).trim();
    if (s.length > max) err[k] = `${etiqueta} es demasiado largo (máximo ${max} caracteres).`;
    textos[k] = s;
  }

  if (Object.keys(err).length) throw new ErrorValidacion(err);

  return {
    nombre,
    cedula,
    direccion: textos.direccion,
    telefono: textos.telefono,
    ciudad: textos.ciudad,
    cargo: textos.cargo,
    numeroContrato: textos.numeroContrato,
    objeto: textos.objeto,
    linea: textos.linea,
    inicio,
    fin,
    honorario,
    valorTotal,
    riesgo,
    riesgoNuevo,
    riesgoDesde,
    revisoNombre: textos.revisoNombre,
    revisoCargo: textos.revisoCargo,
    activo,
    correo,
  };
}

// =================================================================== trabajadoras (CRUD)
export async function contarCargas(db: Db, id: number): Promise<number> {
  const [r] = await db.select({ n: count() }).from(cargas).where(eq(cargas.contratoId, id));
  return Number(r?.n ?? 0);
}

/**
 * Una trabajadora de verdad. Las solicitudes pendientes se manejan solo desde "Solicitudes" (aprobar o rechazar),
 * salvo que `incluirPendientes` (la verificación con documentos también trabaja sobre las solicitudes).
 */
async function contratoPorId(db: Db, id: number, incluirPendientes = false): Promise<ContratoFila> {
  const [c] = await db.select().from(contratos).where(eq(contratos.id, id)).limit(1);
  if (!c || (c.estado === 'pendiente' && !incluirPendientes)) throw new ErrorAmable(MSG_NO_TRABAJADORA, 404);
  return c;
}

/** Un contrato por id, sea trabajadora o solicitud pendiente (404 si no existe). */
export async function contratoCualquiera(db: Db, id: number): Promise<ContratoFila> {
  return contratoPorId(db, id, true);
}

export async function listarContratos(deps: Deps): Promise<ContratoAdmin[]> {
  const filas = await deps.db.select().from(contratos).where(ne(contratos.estado, 'pendiente'));
  const cuentas = await deps.db.select({ id: cargas.contratoId, n: count() }).from(cargas).groupBy(cargas.contratoId);
  const n = new Map(cuentas.map((r) => [r.id, Number(r.n)]));
  return filas.map((c) => ({ ...c, cargas: n.get(c.id) ?? 0 })).sort((a, b) => porNombre(a.nombre, b.nombre) || a.id - b.id);
}

export async function crearContrato(deps: Deps, entrada: Record<string, unknown>): Promise<ContratoAdmin> {
  const todos = await deps.db.select().from(contratos);
  const v = validarContrato(entrada, null, todos);
  const [c] = await deps.db.insert(contratos).values(v).returning();
  return { ...c, cargas: 0 };
}

export type OpcionesActualizar = {
  /** También edita una solicitud pendiente (la verificación con documentos la usa). */
  incluirPendientes?: boolean;
  /** Campos extra que se anotan en la bitácora además de CAMPOS_AUDITADOS_ADMIN (los personales salen como "(dato personal)"). */
  auditar?: readonly string[];
};

export async function actualizarContrato(
  deps: Deps,
  id: number,
  entrada: Record<string, unknown>,
  opciones: OpcionesActualizar = {},
): Promise<ContratoAdmin> {
  const actual = await contratoPorId(deps.db, id, opciones.incluirPendientes === true);
  const otros = (await deps.db.select().from(contratos)).filter((c) => c.id !== id);
  const v = validarContrato(entrada, actual, otros);
  // `verificadaEn` no está en `v`: lo que edita el supervisor NO borra la verificación (solo lo que cambia la contratista)
  const [c] = await deps.db.update(contratos).set(v).where(eq(contratos.id, id)).returning();
  // bitácora: solo los campos que de verdad cambiaron
  await registrarCambios(deps, id, 'admin', diferencias(actual, c, [...CAMPOS_AUDITADOS_ADMIN, ...(opciones.auditar ?? [])]));
  // el valor total / fechas pueden haber cambiado: acumulado y % se recalculan (el valor de cada mes NO se re-evalúa)
  await recalcularAcumulados(deps.db, c);
  return { ...c, cargas: await contarCargas(deps.db, id) };
}

/**
 * Borra una trabajadora. Sin cuentas: se borra. Con cuentas: exige `confirmar` = su nombre (sin tildes/mayúsculas);
 * entonces se borran los archivos de Blob (planillas y adicionales), las cargas, las lecturas y el contrato.
 * Los archivos se borran PRIMERO: si Blob falla, no se pierde nada y se puede reintentar.
 */
export async function borrarContrato(deps: Deps, id: number, confirmar?: unknown): Promise<void> {
  const db = deps.db;
  const c = await contratoPorId(db, id);
  const filas = await db.select().from(cargas).where(eq(cargas.contratoId, id));
  if (filas.length > 0 && normTxt(confirmar) !== normTxt(c.nombre)) {
    throw new ErrorAmable(
      `Para borrar a ${c.nombre} con ${filas.length} ${filas.length === 1 ? 'cuenta enviada' : 'cuentas enviadas'}, escribe su nombre completo. ` +
        'Si solo quieres que no aparezca en el celular, desactívala.',
    );
  }
  const pendientes = await db.select({ archivo: lecturas.archivo }).from(lecturas).where(eq(lecturas.contratoId, id));
  const pdfs = await db.select({ archivo: documentos.archivo }).from(documentos).where(eq(documentos.contratoId, id));
  const archivos = new Set<string>();
  for (const d of pdfs) if (d.archivo) archivos.add(d.archivo);
  for (const f of filas) {
    if (f.archivoPlanilla) archivos.add(f.archivoPlanilla);
    for (const a of f.adicionales ?? []) if (a.archivo) archivos.add(a.archivo);
  }
  for (const p of pendientes) if (p.archivo) archivos.add(p.archivo);
  if (archivos.size) {
    try {
      await deps.blob.del([...archivos]);
    } catch {
      throw new ErrorAmable('No pudimos borrar los archivos de las planillas. No se borró nada; inténtalo de nuevo en un momento.', 502);
    }
  }
  await db.delete(cargas).where(eq(cargas.contratoId, id));
  await db.delete(lecturas).where(eq(lecturas.contratoId, id));
  await db.delete(contratos).where(eq(contratos.id, id));
}

// =================================================================== cambio en lote (fecha de fin y/o de inicio)
export const MAX_LOTE = 100;

export type ResultadoLote = { id: number; nombre: string; ok: boolean; error?: string };

/**
 * Cambia la fecha de fin y/o de inicio de varias trabajadoras a la vez. Solo esos dos campos: para cada una se hace la
 * misma edición del panel (validaciones, bitácora y recálculo de acumulados). Si una falla (por ejemplo, el fin queda
 * antes del inicio de ella), las demás se aplican igual y el resultado dice cuál falló y por qué.
 */
export async function actualizarLote(
  deps: Deps,
  entrada: Record<string, unknown>,
): Promise<{ resultados: ResultadoLote[]; aplicadas: number; fallidas: number }> {
  const err: Record<string, string> = {};
  const lista = Array.isArray(entrada.ids) ? entrada.ids : null;
  const ids = lista ? [...new Set(lista.map((x) => (typeof x === 'number' ? x : NaN)))] : [];
  if (!lista || ids.length === 0) err.ids = 'Escoge al menos una trabajadora.';
  else if (ids.some((x) => !Number.isInteger(x) || x <= 0)) err.ids = 'La lista de trabajadoras no es válida. Recarga la página e inténtalo de nuevo.';
  else if (ids.length > MAX_LOTE) err.ids = `Puedes cambiar hasta ${MAX_LOTE} trabajadoras a la vez.`;

  const cambio: Record<string, string> = {};
  for (const k of ['inicio', 'fin'] as const) {
    const v = entrada[k];
    if (vacio(v)) continue;
    if (typeof v !== 'string' || !parseYMD(v.trim())) err[k] = MENSAJE_FECHA_CONTRATO[k];
    else cambio[k] = v.trim();
  }
  if (!err.ids && !err.inicio && !err.fin && Object.keys(cambio).length === 0) err.fin = 'Escribe la fecha de fin, la de inicio o las dos.';
  if (cambio.inicio && cambio.fin && cambio.fin < cambio.inicio && !err.fin) err.fin = MENSAJE_FIN_ANTES_DE_INICIO;
  if (Object.keys(err).length) throw new ErrorValidacion(err);

  const nombres = new Map(
    (await deps.db.select({ id: contratos.id, nombre: contratos.nombre }).from(contratos).where(inArray(contratos.id, ids))).map((f) => [f.id, f.nombre]),
  );
  const resultados: ResultadoLote[] = [];
  for (const id of ids) {
    const nombre = nombres.get(id) ?? '';
    try {
      await actualizarContrato(deps, id, { ...cambio });
      resultados.push({ id, nombre, ok: true });
    } catch (e) {
      if (e instanceof ErrorAmable) resultados.push({ id, nombre, ok: false, error: e.message });
      else {
        console.error('Error en el cambio en lote:', e instanceof Error ? (e.stack ?? e.message) : e);
        resultados.push({ id, nombre, ok: false, error: MENSAJE_GENERICO });
      }
    }
  }
  const aplicadas = resultados.filter((r) => r.ok).length;
  return { resultados, aplicadas, fallidas: resultados.length - aplicadas };
}

// =================================================================== importar desde el Excel de control
export type CambioImportacion = { campo: string; etiqueta: string; antes: string | number | null; despues: string | number | null };

export type ResumenImportacion = {
  /** cedulaFinal4 = '…1234' (nunca la cédula completa). */
  crear: Array<{ nombre: string; cedulaFinal4: string }>;
  actualizar: Array<{ id: number; nombre: string; cambios: CambioImportacion[] }>;
  sinCambios: number;
  errores: Array<{ fila: number; mensaje: string }>;
};

const CAMPOS_IMPORTADOS: Array<[keyof ContratoFila & ('nombre' | 'numeroContrato' | 'honorario' | 'riesgo' | 'linea'), string]> = [
  ['nombre', 'Nombre'],
  ['numeroContrato', 'N.º de contrato'],
  ['honorario', 'Honorario'],
  ['riesgo', 'Riesgo ARL'],
  ['linea', 'Línea política pública'],
];

/**
 * Lee el Excel de control y, si `aplicar`, guarda los cambios. Clave = cédula. Existe -> se actualizan solo
 * nombre, n.º de contrato, honorario, riesgo y línea si cambiaron (celdas vacías no borran nada). No existe -> se crea
 * (activa, lo demás vacío). Las filas con error se saltan. El archivo no se guarda y la cédula completa nunca sale.
 */
export async function importarExcel(deps: Deps, bytes: Uint8Array, aplicar: boolean): Promise<ResumenImportacion> {
  if (bytes.length > MAX_BYTES_IMPORTAR) throw new ErrorAmable('El archivo pesa más de 1 MB. Sube solo la hoja de control.', 413);
  // un .xlsx es un zip: empieza por "PK"
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ErrorAmable('Tiene que ser un archivo de Excel .xlsx.', 415);
  const { filas, errores } = await parsearExcelControl(bytes);

  const existentes = await deps.db.select().from(contratos);
  const porCedula = new Map(existentes.map((c) => [c.cedula, c]));
  const porNom = new Map(existentes.map((c) => [normTxt(c.nombre), c.id]));
  const res: ResumenImportacion = { crear: [], actualizar: [], sinCambios: 0, errores: [...errores] };

  for (const f of filas) {
    const ex = porCedula.get(f.cedula);
    if (ex?.estado === 'pendiente') {
      res.errores.push({ fila: f.fila, mensaje: 'Hay una solicitud pendiente con esa cédula. Apruébala o recházala en «Solicitudes».' });
      continue;
    }
    const dueño = porNom.get(normTxt(f.nombre));
    if (dueño !== undefined && dueño !== (ex?.id ?? -1)) {
      res.errores.push({ fila: f.fila, mensaje: 'Ya hay otra trabajadora con ese nombre (no se distinguen tildes ni mayúsculas).' });
      continue;
    }
    try {
      if (!ex) {
        if (aplicar) {
          await deps.db.insert(contratos).values({
            nombre: f.nombre,
            cedula: f.cedula,
            numeroContrato: f.numeroContrato ?? '',
            honorario: f.honorario ?? null,
            riesgo: f.riesgo ?? 'I',
            linea: f.linea ?? '',
            activo: true,
          });
        }
        porNom.set(normTxt(f.nombre), -2); // reserva el nombre para filas siguientes del mismo archivo
        res.crear.push({ nombre: f.nombre, cedulaFinal4: '…' + f.cedula.slice(-4) });
        continue;
      }
      const cambios: CambioImportacion[] = [];
      const nuevos: Partial<typeof contratos.$inferInsert> = {};
      for (const [campo, etiqueta] of CAMPOS_IMPORTADOS) {
        const despues = f[campo];
        if (despues === undefined) continue;
        const antes = ex[campo];
        if (antes !== despues) {
          cambios.push({ campo, etiqueta, antes: antes ?? null, despues });
          (nuevos as Record<string, unknown>)[campo] = despues;
        }
      }
      if (cambios.length === 0) {
        res.sinCambios++;
        continue;
      }
      if (aplicar) await deps.db.update(contratos).set(nuevos).where(eq(contratos.id, ex.id));
      if (nuevos.nombre) {
        porNom.delete(normTxt(ex.nombre));
        porNom.set(normTxt(nuevos.nombre), ex.id);
      }
      res.actualizar.push({ id: ex.id, nombre: f.nombre, cambios });
    } catch {
      res.errores.push({ fila: f.fila, mensaje: 'No se pudo guardar esta fila. Inténtalo de nuevo.' });
    }
  }
  res.errores.sort((a, b) => a.fila - b.fila);
  return res;
}

// =================================================================== cuentas del mes
export type CargaAdmin = {
  id: number;
  contratoId: number;
  nombre: string;
  mes: string;
  estado: string;
  estadoTexto: string;
  emoji: string;
  mensaje: string;
  docNum: number;
  dias: number;
  valor: number;
  acumulado: number;
  pct: number;
  ssEsperada: number | null;
  ssDeclarada: number | null;
  planillaNumero: string;
  planillaMes: string;
  /** Hay archivo de la planilla principal (se ve con GET /api/admin/planilla/<id>?n=0). */
  tienePlanilla: boolean;
  /** n = posición + 1 en GET /api/admin/planilla/<id>?n=. Nunca se devuelve la ruta del archivo. */
  adicionales: Array<{ numero: string; mes: string; valor: number; tieneArchivo: boolean }>;
  lectura: string;
  aprobado: boolean;
  observacion: string;
  actualizado: Date;
};

type CargaConNombre = typeof cargas.$inferSelect & { nombre: string };

function aCargaAdmin(f: CargaConNombre): CargaAdmin {
  const estado = f.estado as Estado;
  return {
    id: f.id,
    contratoId: f.contratoId,
    nombre: f.nombre,
    mes: f.mes,
    estado: f.estado,
    estadoTexto: ESTADO_TEXTO[estado] ?? f.estado,
    emoji: ESTADO_EMOJI[estado] ?? '',
    mensaje: f.mensaje,
    docNum: f.docNum,
    dias: f.dias,
    valor: f.valor,
    acumulado: f.acumulado,
    pct: f.pct,
    ssEsperada: f.ssEsperada,
    ssDeclarada: f.ssDeclarada,
    planillaNumero: f.planillaNumero,
    planillaMes: f.planillaMes,
    tienePlanilla: !!f.archivoPlanilla,
    adicionales: (f.adicionales ?? []).map((a) => ({ numero: a.numero, mes: a.mes, valor: a.valor, tieneArchivo: !!a.archivo })),
    lectura: f.lectura,
    aprobado: f.aprobado,
    observacion: f.observacion,
    actualizado: f.actualizado,
  };
}

/** Mes anterior al actual en hora de Bogotá ('AAAA-MM'). */
export function mesPorDefecto(ahora: Date): string {
  return addMonths(mesActual(ahora), -1);
}

export async function listarCargas(
  deps: Deps,
  mesPedido?: unknown,
): Promise<{ mes: string; cargas: CargaAdmin[]; faltan: Array<{ contratoId: number; nombre: string }> }> {
  const ahora = deps.ahora ? deps.ahora() : new Date();
  const mes = vacio(mesPedido) ? mesPorDefecto(ahora) : mesValido(mesPedido);
  const filas = await deps.db
    .select({ carga: cargas, nombre: contratos.nombre })
    .from(cargas)
    .innerJoin(contratos, eq(cargas.contratoId, contratos.id))
    .where(eq(cargas.mes, mes));
  const lista = filas.map((r) => aCargaAdmin({ ...r.carga, nombre: r.nombre })).sort((a, b) => porNombre(a.nombre, b.nombre) || a.id - b.id);

  // activas cuyo contrato cubre ese mes y todavía no tienen cuenta
  const conCarga = new Set(lista.map((c) => c.contratoId));
  const activos = await deps.db.select().from(contratos).where(and(eq(contratos.activo, true), eq(contratos.estado, 'activa')));
  const faltan = activos
    .filter((c) => !conCarga.has(c.id) && monthsBetween(c.inicio, c.fin).includes(mes))
    .map((c) => ({ contratoId: c.id, nombre: c.nombre }))
    .sort((a, b) => porNombre(a.nombre, b.nombre));
  return { mes, cargas: lista, faltan };
}

async function cargaConNombre(db: Db, id: number): Promise<CargaConNombre> {
  const [r] = await db
    .select({ carga: cargas, nombre: contratos.nombre })
    .from(cargas)
    .innerJoin(contratos, eq(cargas.contratoId, contratos.id))
    .where(eq(cargas.id, id))
    .limit(1);
  if (!r) throw new ErrorAmable(MSG_NO_CARGA, 404);
  return { ...r.carga, nombre: r.nombre };
}

/** Aprobar / observación. No toca `actualizado` (es la fecha del envío de la contratista). */
export async function actualizarCarga(deps: Deps, id: number, entrada: Record<string, unknown>): Promise<CargaAdmin> {
  const cambios: Partial<typeof cargas.$inferInsert> = {};
  const err: Record<string, string> = {};
  if ('aprobado' in entrada) {
    if (typeof entrada.aprobado === 'boolean') cambios.aprobado = entrada.aprobado;
    else err.aprobado = 'Aprobado debe ser sí o no.';
  }
  if ('observacion' in entrada) {
    const o = entrada.observacion;
    if (o === null || o === undefined) cambios.observacion = '';
    else if (typeof o !== 'string') err.observacion = 'La observación debe ser texto.';
    else if (o.trim().length > 1000) err.observacion = 'La observación es demasiado larga (máximo 1000 caracteres).';
    else cambios.observacion = o.trim();
  }
  if (Object.keys(err).length) throw new ErrorValidacion(err);
  if (Object.keys(cambios).length === 0) throw new ErrorAmable('No hay nada que guardar.');
  await cargaConNombre(deps.db, id); // 404 si no existe
  await deps.db.update(cargas).set(cambios).where(eq(cargas.id, id));
  return aCargaAdmin(await cargaConNombre(deps.db, id));
}

// =================================================================== ver planilla (Blob privado)
const MIME_POR_EXT: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };

export type PlanillaParaVer = { stream: ReadableStream<Uint8Array>; mime: string; size: number | null; nombreArchivo: string };

/** n = 0 planilla principal; 1..3 adicionales. */
export async function planillaParaVer(deps: Deps, cargaId: number, n: number): Promise<PlanillaParaVer> {
  if (!Number.isInteger(n) || n < 0 || n > 3) throw new ErrorAmable('Ese archivo no existe.', 404);
  const c = await cargaConNombre(deps.db, cargaId);
  const adicional: AdicionalGuardada | undefined = n > 0 ? (c.adicionales ?? [])[n - 1] : undefined;
  const ruta = n === 0 ? c.archivoPlanilla : (adicional?.archivo ?? '');
  if (!ruta) throw new ErrorAmable('Esa cuenta no tiene ese archivo de planilla.', 404);
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(ruta)?.[1] ?? '').toLowerCase();
  const mime = MIME_POR_EXT[ext];
  if (!mime) throw new ErrorAmable('Ese archivo no se puede mostrar.', 415);
  const b = await (deps.blob as BlobStore).get(ruta);
  if (!b) throw new ErrorAmable('No encontramos el archivo de la planilla (pudo haberse borrado).', 404);
  const sufijo = n === 0 ? '' : `-adicional-${n}`;
  return {
    stream: b.stream,
    mime,
    size: b.size,
    nombreArchivo: `Planilla-${c.mes}-${nombreLimpio(c.nombre)}${sufijo}.${ext}`,
  };
}

// =================================================================== parámetros
export async function leerParametros(deps: Deps): Promise<Parametros> {
  return cargarParametros(deps.db);
}

function decimal(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(',', '.');
  return /^\d*\.?\d+$|^\d+\.$/.test(s) ? Number(s) : null;
}

/** Valida y guarda la fila de parámetros. Lo que no viene se conserva. Errores por campo (`arl.I`...). */
export async function guardarParametros(deps: Deps, entrada: Record<string, unknown>): Promise<Parametros> {
  const actual = await cargarParametros(deps.db);
  const e = aCamel(entrada);
  const err: Record<string, string> = {};

  const pct = (k: 'pctIbc' | 'salud' | 'pension', etiqueta: string): number => {
    const v = k in e ? decimal(e[k]) : actual[k];
    if (v === null || v < 0 || v > 1) {
      err[k] = `${etiqueta} debe ser un porcentaje entre 0 % y 100 % (guárdalo como número entre 0 y 1, por ejemplo 0,125).`;
      return actual[k];
    }
    return v;
  };
  const pctIbc = pct('pctIbc', 'El porcentaje del IBC');
  const salud = pct('salud', 'El porcentaje de salud');
  const pension = pct('pension', 'El porcentaje de pensión');

  let smmlv = actual.smmlv;
  if ('smmlv' in e) {
    const n = monto(e.smmlv);
    if (n === null || n <= 0 || n > MAX_ENTERO) err.smmlv = 'El salario mínimo (SMMLV) debe ser un valor en pesos mayor que cero (por ejemplo 1.750.905).';
    else smmlv = n;
  }

  const mult = (k: 'ibcPisoMult' | 'ibcTechoMult', etiqueta: string): number => {
    const v = k in e ? decimal(e[k]) : actual[k];
    if (v === null || v <= 0) {
      err[k] = `${etiqueta} debe ser un número mayor que cero.`;
      return actual[k];
    }
    return v;
  };
  const ibcPisoMult = mult('ibcPisoMult', 'El piso del IBC (en salarios mínimos)');
  const ibcTechoMult = mult('ibcTechoMult', 'El techo del IBC (en salarios mínimos)');
  if (!err.ibcPisoMult && !err.ibcTechoMult && ibcTechoMult < ibcPisoMult) err.ibcTechoMult = 'El techo del IBC no puede ser menor que el piso.';

  const arl: Record<string, number> = { ...actual.arl };
  const entradaArl = e.arl && typeof e.arl === 'object' && !Array.isArray(e.arl) ? (e.arl as Record<string, unknown>) : null;
  if ('arl' in e && !entradaArl) err.arl = 'Las tarifas de ARL deben venir como una tabla con los riesgos I a V.';
  if (entradaArl) {
    for (const r of RIESGOS) {
      if (!(r in entradaArl)) continue;
      const v = decimal(entradaArl[r]);
      if (v === null || v < 0 || v > 0.2) err[`arl.${r}`] = `La tarifa ARL del riesgo ${r} debe estar entre 0 y 0,2 (20 %).`;
      else arl[r] = v;
    }
  }

  let enviarCorreo = actual.enviarCorreo;
  if ('enviarCorreo' in e) {
    if (typeof e.enviarCorreo === 'boolean') enviarCorreo = e.enviarCorreo;
    else err.enviarCorreo = 'Indica si se envía correo (sí o no).';
  }

  let correoSupervisor = actual.correoSupervisor;
  if ('correoSupervisor' in e) {
    const s = vacio(e.correoSupervisor) ? '' : String(e.correoSupervisor).trim();
    if (s && (s.length > 200 || !CORREO_RE.test(s))) err.correoSupervisor = 'El correo del supervisor no tiene un formato válido (o déjalo vacío).';
    else correoSupervisor = s;
  }

  let toleranciaSs = actual.toleranciaSs;
  if ('toleranciaSs' in e) {
    const n = monto(e.toleranciaSs);
    if (n === null || n < 0 || n > MAX_ENTERO) err.toleranciaSs = 'La tolerancia debe ser un valor en pesos, cero o mayor.';
    else toleranciaSs = n;
  }

  if (Object.keys(err).length) throw new ErrorValidacion(err);

  const [fila] = await deps.db
    .update(parametros)
    .set({ pctIbc, salud, pension, smmlv, ibcPisoMult, ibcTechoMult, arl, enviarCorreo, correoSupervisor, toleranciaSs })
    .where(eq(parametros.id, 1))
    .returning();
  return fila;
}
