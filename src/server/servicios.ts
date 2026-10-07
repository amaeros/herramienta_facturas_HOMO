// Servicios del servidor: replican la lógica de legacy/apps-script/Code.gs (api_*, procesarEnvio_,
// recalcularAcumuladosContratista_, otrasPlanillas_...) sobre Postgres + Blob.
// Las rutas de src/app/api/** son delgadas y solo llaman a estas funciones.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lt, ne, or } from 'drizzle-orm';
import {
  cumulative,
  evaluate,
  expectedPeriod,
  commercialDays,
  periodValue,
  monthsBetween,
  monthLabel,
  riskFor,
  docNumber,
  ESTADO_TEXTO,
  ESTADO_EMOJI,
  type Contrato,
  type EvalResult,
  type OtraPlanilla,
  type Params,
} from '../lib/calc';
import { nombreArchivoFactura, type DatosFactura } from '../lib/factura';
import { parsePlanillaText } from '../lib/parser';
import { CADUCIDAD_LECTURA_MS, MAX_BYTES, MAX_TEXTO_NAVEGADOR, MIN_TEXTO_NAVEGADOR, rutaPlanilla, tipoArchivo } from './archivos';
import type { BlobStore } from './blob';
import type { Db } from './db';
import { asegurarParametros } from './db/seed';
import {
  cargas,
  contratos,
  lecturas,
  parametros,
  type AdicionalGuardada,
  type ContratoFila,
  type Parametros,
} from './db/schema';
import {
  extrasDePedido,
  fechaValida,
  limpiarDatos,
  mesValido,
  normTxt,
  type DatosPlanilla,
  type Extras,
} from './entrada';
import { ErrorAmable, MENSAJE_SESION } from './errores';
import { verificarLogin } from './auth';

export type Deps = { db: Db; blob: BlobStore; ahora?: () => Date };

function ahoraDe(deps: Deps): Date {
  return deps.ahora ? deps.ahora() : new Date();
}

// =================================================================== tipos de respuesta
export type MesResumen = {
  key: string;
  label: string;
  inicio: string;
  corte: string;
  dias: number | null;
  valor: number;
  /** estadoTexto de la carga de ese mes ('✅ OK', '🟡 REVISAR', '🔴 ERROR') o ''. */
  enviado: string;
};

export type Resumen = {
  nombre: string;
  numeroContrato: string;
  honorario: number;
  inicio: string;
  fin: string;
  riesgo: string;
  meses: MesResumen[];
  mesDefault: string;
};

export type PedidoEvaluar = {
  mes?: unknown;
  fechaInicio?: unknown;
  fechaCorte?: unknown;
  datos?: unknown;
  adicionales?: unknown;
  diasManual?: unknown;
};

export type PedidoPlanilla = {
  archivo: { bytes: Uint8Array; nombre: string };
  /** Texto que sacó pdf.js en el navegador (puede venir vacío). */
  texto?: string;
  mes: unknown;
  fechaInicio?: unknown;
  fechaCorte?: unknown;
  adicionales?: unknown;
  diasManual?: unknown;
  /** true si es una planilla adicional (corrección...): se lee pero no se evalúa. */
  adicional?: boolean;
};

export type RespuestaPlanilla = {
  tempId: string;
  leyo: boolean;
  confianza: 'alta' | 'media' | 'baja';
  tipoDoc: string;
  fuente: 'navegador' | 'ninguna';
  notas: string[];
  lectura: DatosPlanilla;
  evaluacion: EvalResult | null;
  valor: number | null;
};

export type PedidoEnviar = PedidoEvaluar & { tempId?: unknown };

export type RespuestaEnviar = {
  estado: EvalResult['estado'];
  estadoTexto: string;
  emoji: string;
  mensaje: string;
  factura: { nombre: string; url: string };
};

// =================================================================== mapeos fila -> calc
export function paramsDeFila(f: Parametros): Params {
  return {
    pctIbc: f.pctIbc,
    pctSalud: f.salud,
    pctPension: f.pension,
    smmlv: f.smmlv,
    piso: f.ibcPisoMult,
    techo: f.ibcTechoMult,
    arl: { ...f.arl },
    tolerancia: f.toleranciaSs,
  };
}

export function contratoCalc(c: ContratoFila): Contrato {
  return {
    inicio: c.inicio ?? '',
    fin: c.fin ?? '',
    honorario: c.honorario ?? NaN,
    total: c.valorTotal ?? 0,
    riesgo: c.riesgo,
    riesgoNuevo: c.riesgoNuevo,
    desde: c.riesgoDesde ?? '',
  };
}

export async function cargarParametros(db: Db): Promise<Parametros> {
  let [f] = await db.select().from(parametros).where(eq(parametros.id, 1)).limit(1);
  if (!f) {
    await asegurarParametros(db);
    [f] = await db.select().from(parametros).where(eq(parametros.id, 1)).limit(1);
  }
  if (!f) throw new Error('No hay fila de parametros');
  return f;
}

/** El contrato de la sesión: debe existir y estar activo; si no, la sesión ya no sirve. */
export async function contratoActivo(db: Db, contratoId: number): Promise<ContratoFila> {
  const [c] = await db.select().from(contratos).where(eq(contratos.id, contratoId)).limit(1);
  if (!c || !c.activo) throw new ErrorAmable(MENSAJE_SESION, 401);
  return c;
}

function validarContratoCompleto(c: ContratoFila): void {
  if (!c.inicio || !c.fin || c.honorario === null || !isFinite(c.honorario)) {
    throw new ErrorAmable('Tu contrato no tiene las fechas o el honorario completos. Avisa a tu supervisor.');
  }
}

// =================================================================== contratistas y resumen
/** Nombres de contratistas activas, ordenados sin tildes. Solo nombres: nada de datos personales. */
export async function listarContratistas(deps: Deps): Promise<string[]> {
  const filas = await deps.db.select({ nombre: contratos.nombre }).from(contratos).where(eq(contratos.activo, true));
  return filas
    .map((f) => f.nombre)
    .sort((a, b) => {
      const x = normTxt(a), y = normTxt(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
}

/** Mes actual 'AAAA-MM' en hora de Bogotá. */
export function mesActual(d: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).formatToParts(d);
  const y = partes.find((p) => p.type === 'year')!.value;
  const m = partes.find((p) => p.type === 'month')!.value;
  return `${y}-${m}`;
}

export async function resumen(deps: Deps, c: ContratoFila): Promise<Resumen> {
  validarContratoCompleto(c);
  const cc = contratoCalc(c);
  const meses = monthsBetween(cc.inicio, cc.fin);
  const filas = await deps.db.select({ mes: cargas.mes, estado: cargas.estado }).from(cargas).where(eq(cargas.contratoId, c.id));
  const porMes: Record<string, string> = {};
  for (const f of filas) porMes[f.mes] = f.estado;
  const lista: MesResumen[] = meses.map((k) => {
    const p = expectedPeriod(k, cc.inicio, cc.fin)!;
    const dias = commercialDays(p.inicio, p.corte);
    const est = porMes[k] as keyof typeof ESTADO_TEXTO | undefined;
    return {
      key: k,
      label: monthLabel(k),
      inicio: p.inicio,
      corte: p.corte,
      dias,
      valor: periodValue(cc.honorario, dias),
      enviado: est ? (ESTADO_TEXTO[est] ?? String(est)) : '',
    };
  });
  const hoy = mesActual(ahoraDe(deps));
  const def = meses.indexOf(hoy) >= 0 ? hoy : hoy < meses[0] ? meses[0] : meses[meses.length - 1];
  return {
    nombre: c.nombre,
    numeroContrato: c.numeroContrato,
    honorario: c.honorario as number,
    inicio: c.inicio as string,
    fin: c.fin as string,
    riesgo: riskFor(cc, def),
    meses: lista,
    mesDefault: def,
  };
}

/** Resumen del contrato de la sesión (para /api/sesion y para refrescar después de enviar). */
export async function resumenDeSesion(deps: Deps, contratoId: number): Promise<Resumen> {
  return resumen(deps, await contratoActivo(deps.db, contratoId));
}

/** Nombre + PIN -> contrato y resumen. El límite de intentos vive en auth.verificarLogin. */
export async function login(deps: Deps, nombre: unknown, pin: unknown): Promise<{ contratoId: number; resumen: Resumen }> {
  const c = await verificarLogin(deps.db, nombre, pin, ahoraDe(deps));
  return { contratoId: c.id, resumen: await resumen(deps, c) };
}

// =================================================================== evaluación
/** Planillas de las demás cuentas (todas las contratistas), menos la misma contratista + mes. */
export async function otrasPlanillas(db: Db, contratoId: number, mes: string): Promise<OtraPlanilla[]> {
  const filas = await db
    .select({ contratoId: cargas.contratoId, mes: cargas.mes, planilla: cargas.planillaNumero, adicionales: cargas.adicionales })
    .from(cargas)
    .where(or(ne(cargas.contratoId, contratoId), ne(cargas.mes, mes)));
  const res: OtraPlanilla[] = [];
  for (const r of filas) {
    const misma = r.contratoId === contratoId;
    if (r.planilla) res.push({ numero: r.planilla, mismaContratista: misma, mes: r.mes });
    for (const x of r.adicionales ?? []) res.push({ numero: x.numero, mismaContratista: misma, mes: r.mes });
  }
  return res;
}

async function evaluarEnvio(
  db: Db,
  c: ContratoFila,
  params: Params,
  mes: string,
  fechaInicio: unknown,
  fechaCorte: unknown,
  datos: DatosPlanilla,
  extra: Extras,
): Promise<EvalResult> {
  return evaluate({
    contrato: contratoCalc(c),
    params,
    mes,
    periodo: { inicio: fechaValida(fechaInicio), corte: fechaValida(fechaCorte) },
    planilla: { numero: datos.numero, mesCotizado: datos.periodo, salud: datos.salud, pension: datos.pension, arl: datos.arl },
    otras: await otrasPlanillas(db, c.id, mes),
    adicionales: extra.adicionales.map((a) => ({ numero: a.numero, mesCotizado: a.mesCotizado, valor: a.valor })),
    diasManual: extra.diasManual,
  });
}

/** Revisa datos (escritos o corregidos) sin guardar nada. */
export async function evaluar(deps: Deps, contratoId: number, p: PedidoEvaluar): Promise<EvalResult> {
  const c = await contratoActivo(deps.db, contratoId);
  const mes = mesValido(p.mes);
  const params = paramsDeFila(await cargarParametros(deps.db));
  return evaluarEnvio(deps.db, c, params, mes, p.fechaInicio, p.fechaCorte, limpiarDatos(p.datos), extrasDePedido(p));
}

// =================================================================== lectura de la planilla
const VACIA: DatosPlanilla = { numero: '', periodo: '', salud: null, pension: null, arl: null };

/** Borra las planillas subidas hace más de 6 h que nunca se enviaron (y sus archivos). Best-effort. */
export async function limpiarLecturasVencidas(deps: Deps): Promise<void> {
  try {
    const limite = new Date(ahoraDe(deps).getTime() - CADUCIDAD_LECTURA_MS);
    const viejas = await deps.db.select().from(lecturas).where(lt(lecturas.creado, limite)).limit(30);
    if (!viejas.length) return;
    await deps.blob.del(viejas.map((v) => v.archivo));
    await deps.db.delete(lecturas).where(inArray(lecturas.tempId, viejas.map((v) => v.tempId)));
  } catch (e) {
    console.error('No se pudieron limpiar las lecturas vencidas:', e);
  }
}

/**
 * Recibe la planilla (PDF/JPG/PNG), la guarda en Blob (privado), la lee con el texto que sacó el navegador
 * y devuelve lo leído + la evaluación. No hay OCR: sin texto útil, la contratista escribe los datos a mano.
 */
export async function leerPlanilla(deps: Deps, contratoId: number, p: PedidoPlanilla): Promise<RespuestaPlanilla> {
  const c = await contratoActivo(deps.db, contratoId);
  const mes = mesValido(p.mes);
  const bytes = p.archivo?.bytes;
  if (!bytes || bytes.length === 0) throw new ErrorAmable('No recibimos el archivo. Vuelve a elegirlo.');
  if (bytes.length > MAX_BYTES) throw new ErrorAmable('El archivo pesa más de 4 MB. Sube un PDF más liviano o una foto más pequeña.', 413);
  const tipo = tipoArchivo(bytes);
  if (!tipo) throw new ErrorAmable('Solo podemos recibir archivos PDF, JPG o PNG.', 415);
  const params = paramsDeFila(await cargarParametros(deps.db));

  await limpiarLecturasVencidas(deps);

  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const archivo = rutaPlanilla(c.id, mes, p.archivo.nombre, tipo.ext);
  await deps.blob.put(archivo, buf, tipo.mime);

  let lectura: DatosPlanilla = { ...VACIA };
  let confianza: 'alta' | 'media' | 'baja' = 'baja';
  let notas: string[] = [];
  let leyo = false;
  let tipoDoc = 'otro';
  let fuente: 'navegador' | 'ninguna' = 'ninguna';

  // Solo los PDF tienen capa de texto; el navegador manda lo que extrajo con pdf.js.
  const textoNav = tipo.ext === 'pdf' && typeof p.texto === 'string' ? p.texto.slice(0, MAX_TEXTO_NAVEGADOR) : '';
  const util = textoNav.replace(/\s+/g, ' ').trim().length;
  if (util >= MIN_TEXTO_NAVEGADOR) {
    try {
      const r = parsePlanillaText(textoNav);
      fuente = 'navegador';
      confianza = r.confianza || 'baja';
      notas = r.notas || [];
      tipoDoc = r.tipo || 'otro';
      if (confianza !== 'baja') {
        lectura = {
          numero: r.numero || '',
          periodo: r.periodo || '',
          salud: r.salud,
          pension: r.pension,
          arl: r.arl,
        };
        leyo = !!(r.numero || r.periodo || r.salud !== null || r.pension !== null || r.arl !== null);
      }
    } catch (e) {
      console.error('No se pudo interpretar el texto de la planilla:', e);
      notas = ['No pudimos leer el archivo automáticamente.'];
    }
  } else {
    notas = ['No pudimos leer el archivo automáticamente.'];
  }

  const tempId = randomUUID();
  await deps.db.insert(lecturas).values({
    tempId,
    contratoId: c.id,
    archivo,
    tipo: tipo.ext,
    lectura,
    leyo,
    creado: ahoraDe(deps),
  });

  // Planilla ADICIONAL: no se valida contra lo esperado; solo se propone el valor total.
  let evaluacion: EvalResult | null = null;
  let valor: number | null = null;
  if (p.adicional) {
    if (leyo && lectura.salud !== null && lectura.pension !== null && lectura.arl !== null) {
      valor = lectura.salud + lectura.pension + lectura.arl;
    }
  } else if (leyo) {
    evaluacion = await evaluarEnvio(deps.db, c, params, mes, p.fechaInicio, p.fechaCorte, limpiarDatos(lectura), extrasDePedido(p));
  }
  return { tempId, leyo, confianza, tipoDoc, fuente, notas, lectura, evaluacion, valor };
}

// =================================================================== enviar
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_SIN_PLANILLA = 'No encontramos la planilla que subiste (pudo vencerse). Vuelve a subirla, por favor.';

async function planillaTemporal(deps: Deps, tempId: unknown, contratoId: number) {
  const id = String(tempId ?? '');
  if (!UUID_RE.test(id)) throw new ErrorAmable(MSG_SIN_PLANILLA);
  const [l] = await deps.db.select().from(lecturas).where(and(eq(lecturas.tempId, id), eq(lecturas.contratoId, contratoId))).limit(1);
  if (!l || ahoraDe(deps).getTime() - l.creado.getTime() > CADUCIDAD_LECTURA_MS) throw new ErrorAmable(MSG_SIN_PLANILLA);
  return l;
}

/** Recalcula acumulado y % de TODAS las cargas de un contrato, en orden de mes. Solo escribe lo que cambió. */
export async function recalcularAcumulados(db: Db, c: ContratoFila): Promise<void> {
  const cc = contratoCalc(c);
  const filas = await db.select().from(cargas).where(eq(cargas.contratoId, c.id)).orderBy(asc(cargas.mes));
  const valores: Record<string, number> = {};
  for (const f of filas) valores[f.mes] = f.valor;
  for (const f of filas) {
    const a = cumulative(cc, f.mes, valores);
    if (a.acumulado !== f.acumulado || Math.abs(a.pct - f.pct) > 1e-12) {
      await db.update(cargas).set({ acumulado: a.acumulado, pct: a.pct }).where(eq(cargas.id, f.id));
    }
  }
}

/** Guarda todo y deja lista la cuenta de cobro. La evaluación del servidor es la que manda. */
export async function enviar(deps: Deps, contratoId: number, p: PedidoEnviar): Promise<RespuestaEnviar> {
  const c = await contratoActivo(deps.db, contratoId);
  validarContratoCompleto(c);
  const db = deps.db;
  const mes = mesValido(p.mes);
  const cc = contratoCalc(c);
  if (monthsBetween(cc.inicio, cc.fin).indexOf(mes) < 0) {
    throw new ErrorAmable('Ese mes no está dentro de la vigencia de tu contrato. Escoge otro mes.');
  }
  const params = paramsDeFila(await cargarParametros(db));
  const datos = limpiarDatos(p.datos);
  const extra = extrasDePedido(p);
  const ev = await evaluarEnvio(db, c, params, mes, p.fechaInicio, p.fechaCorte, datos, extra);
  // Las alertas (🟡 / 🔴) nunca bloquean; solo falta un dato obligatorio o un formato imposible.
  if (ev.bloquea) throw new ErrorAmable(ev.mensaje);
  if (!ev.periodo || ev.dias === null || ev.valor === null) throw new ErrorAmable('No pudimos calcular el periodo. Revisa las fechas.');

  // --- planillas subidas (ya están en Blob con su ruta definitiva) ---------------------------
  const lec = await planillaTemporal(deps, p.tempId, c.id);
  const lecExtra = [] as Array<Awaited<ReturnType<typeof planillaTemporal>> | null>;
  for (let i = 0; i < ev.adicionales.length; i++) {
    const t = extra.adicionales[i]?.tempId;
    lecExtra.push(t ? await planillaTemporal(deps, t, c.id) : null);
  }
  let lectura: 'auto' | 'corregido' | 'manual';
  if (!lec.leyo) lectura = 'manual';
  else {
    const l = limpiarDatos(lec.lectura);
    lectura =
      l.numero === datos.numero && l.periodo === datos.periodo && l.salud === datos.salud && l.pension === datos.pension && l.arl === datos.arl
        ? 'auto'
        : 'corregido';
  }
  const adicionales: AdicionalGuardada[] = ev.adicionales.map((a, i) => ({
    numero: a.numero,
    mes: a.mesCotizado,
    valor: a.valor,
    archivo: lecExtra[i]?.archivo ?? '',
  }));

  // --- guardar (UNIQUE contrato+mes: reenviar reemplaza la fila y anula la aprobación) ---------
  const previas = await db.select().from(cargas).where(eq(cargas.contratoId, c.id));
  const previa = previas.find((f) => f.mes === mes) ?? null;
  const valoresMes: Record<string, number> = {};
  for (const f of previas) valoresMes[f.mes] = f.valor;
  valoresMes[mes] = ev.valor;
  const acum = cumulative(cc, mes, valoresMes);
  const ahora = ahoraDe(deps);
  const campos = {
    fechaInicio: ev.periodo.inicio,
    fechaCorte: ev.periodo.corte,
    planillaNumero: datos.numero,
    planillaMes: datos.periodo,
    ssDeclarada: ev.declarado,
    adicionales,
    diasManual: ev.diasManual && extra.diasManual ? Number(extra.diasManual.dias) : null,
    motivoNovedad: ev.diasManual && extra.diasManual ? extra.diasManual.motivo : '',
    docNum: docNumber(mes),
    dias: ev.dias,
    valor: ev.valor,
    acumulado: acum.acumulado,
    pct: acum.pct,
    ssEsperada: ev.ss ? ev.ss.total : null,
    desglose: ev.ss ? ev.ss.desglose : ev.parcial ? 'mes parcial: no se valida' : '',
    estado: ev.estado,
    mensaje: ev.mensaje,
    lectura,
    archivoPlanilla: lec.archivo,
    aprobado: false,
    actualizado: ahora,
  };
  const [fila] = await db
    .insert(cargas)
    .values({ contratoId: c.id, mes, creado: ahora, ...campos })
    .onConflictDoUpdate({ target: [cargas.contratoId, cargas.mes], set: campos })
    .returning();
  await recalcularAcumulados(db, c);

  // --- limpieza: archivos del envío anterior que ya no se usan, y las lecturas consumidas -----
  try {
    const nuevos = new Set([lec.archivo, ...adicionales.map((a) => a.archivo)]);
    const viejos = previa ? [previa.archivoPlanilla, ...(previa.adicionales ?? []).map((a) => a.archivo)] : [];
    const sobran = viejos.filter((a) => a && !nuevos.has(a));
    if (sobran.length) await deps.blob.del(sobran);
    const usados = [lec.tempId, ...lecExtra.filter((x) => x).map((x) => x!.tempId)];
    await db.delete(lecturas).where(inArray(lecturas.tempId, usados));
  } catch (e) {
    console.error('No se pudo limpiar después de enviar:', e);
  }

  return {
    estado: ev.estado,
    estadoTexto: ev.estadoTexto,
    emoji: ESTADO_EMOJI[ev.estado],
    mensaje: ev.mensaje,
    factura: { nombre: nombreArchivoFactura(String(fila.docNum), c.nombre), url: `/api/factura/${fila.id}` },
  };
}

// =================================================================== factura
/** Datos para el .xlsx de una carga. Si se pasa contratoId, la carga debe ser de esa contratista (si no, 'no existe'). */
export async function datosFactura(
  deps: Deps,
  cargaId: number,
  contratoId?: number,
): Promise<{ datos: DatosFactura; contratoId: number }> {
  const [r] = await deps.db
    .select({ carga: cargas, contrato: contratos })
    .from(cargas)
    .innerJoin(contratos, eq(cargas.contratoId, contratos.id))
    .where(eq(cargas.id, cargaId))
    .limit(1);
  if (!r || (contratoId !== undefined && r.contrato.id !== contratoId)) {
    throw new ErrorAmable('No encontramos esa cuenta de cobro.', 404);
  }
  const { carga: g, contrato: c } = r;
  const datos: DatosFactura = {
    nombre: c.nombre,
    cedula: c.cedula,
    direccion: c.direccion,
    telefono: c.telefono,
    ciudad: c.ciudad,
    cargo: c.cargo,
    numeroContrato: c.numeroContrato,
    objeto: c.objeto,
    valorTotalContrato: c.valorTotal ?? 0,
    revisoNombre: c.revisoNombre,
    revisoCargo: c.revisoCargo,
    docNum: String(g.docNum),
    fechaInicio: g.fechaInicio,
    fechaCorte: g.fechaCorte,
    valorPeriodo: g.valor,
    acumulado: g.acumulado,
    ssDeclarada: g.ssDeclarada ?? 0,
    planillaNumero: g.planillaNumero,
    planillaMes: g.planillaMes,
    adicionales: (g.adicionales ?? []).map((a) => ({ numero: a.numero, mes: a.mes, valor: a.valor })),
  };
  return { datos, contratoId: c.id };
}
