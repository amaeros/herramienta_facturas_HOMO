// "Mi contrato": la contratista llena y corrige los datos de SU contrato que salen en la cuenta de cobro (dirección,
// teléfono, ciudad, correo, cargo, equipo o línea, n.º de contrato, objeto, fechas, honorario mensual, valor total,
// riesgo ARL y quién revisa). Todo lo demás (nombre, cédula, riesgo nuevo/desde, activo, estado) solo lo cambia el
// supervisor y se ignora si llega en el cuerpo.
// Cada cambio real queda en la bitácora (cambios_contrato; los datos personales como "(dato personal)"; el honorario
// y el riesgo con alerta para que el supervisor los mire) y se recalculan acumulado y % de las cuentas del periodo.
// Ver docs/ARQUITECTURA.md.

import { eq } from 'drizzle-orm';
import { expectedTotal, fmtMoney, parseYMD } from '../lib/calc';
import { CAMPOS_CONTRATISTA, diferencias, registrarCambios, type CampoContratista } from './cambios';
import { contratos, type ContratoFila } from './db/schema';
import {
  CORREO_RE,
  MAX_ENTERO,
  MENSAJE_CORREO,
  MENSAJE_FECHA_CONTRATO,
  MENSAJE_FIN_ANTES_DE_INICIO,
  MENSAJE_VALOR_TOTAL_MENOR,
  monto,
  riesgoRomano,
} from './entrada';
import { ErrorAmable, ErrorValidacion } from './errores';
import { contratoActivo, recalcularAcumulados, resumen, type Deps, type Resumen } from './servicios';

export type DatosMiContrato = {
  direccion: string;
  telefono: string;
  ciudad: string;
  correo: string;
  cargo: string;
  /** Equipo o línea (opcional). */
  linea: string;
  numeroContrato: string;
  objeto: string;
  inicio: string;
  fin: string;
  /** Lo que cobra por un mes completo (null si el contrato aún no lo tiene). */
  honorario: number | null;
  valorTotal: number | null;
  /** Riesgo ARL de I a V. */
  riesgo: string;
  revisoNombre: string;
  revisoCargo: string;
  /** Lo que da el honorario por toda la vigencia (null si faltan fechas u honorario). */
  valorTotalEsperado: number | null;
};

export type RespuestaGuardar = { datos: DatosMiContrato; contrato: Resumen; aviso?: string };

/** Campos de texto libre: cuánto pueden medir, cómo se llaman en los mensajes y si son obligatorios. */
const TEXTOS = {
  direccion: { max: 150, etiqueta: 'La dirección', pide: 'Escribe tu dirección.', obligatorio: true },
  ciudad: { max: 80, etiqueta: 'La ciudad', pide: 'Escribe tu ciudad.', obligatorio: true },
  cargo: { max: 120, etiqueta: 'El cargo', pide: 'Escribe tu cargo.', obligatorio: true },
  linea: { max: 120, etiqueta: 'El equipo o línea', pide: '', obligatorio: false },
  numeroContrato: { max: 60, etiqueta: 'El número de contrato', pide: 'Escribe el número de tu contrato.', obligatorio: true },
  objeto: { max: 1500, etiqueta: 'El objeto', pide: 'Escribe el objeto de tu contrato.', obligatorio: true },
  revisoNombre: { max: 120, etiqueta: 'El nombre de quien revisó', pide: 'Escribe el nombre de quien revisa tu cuenta.', obligatorio: true },
  revisoCargo: { max: 120, etiqueta: 'El cargo de quien revisó', pide: 'Escribe el cargo de quien revisa tu cuenta.', obligatorio: true },
} as const;

const MENSAJE_TELEFONO = 'El teléfono solo lleva números, espacios o el signo +, entre 7 y 15 dígitos. Ejemplo: 300 123 4567';
const MAX_CORREO = 200;

export function valorTotalEsperadoDe(c: ContratoFila): number | null {
  return expectedTotal(c.inicio, c.fin, c.honorario);
}

export function datosDeContrato(c: ContratoFila): DatosMiContrato {
  return {
    direccion: c.direccion,
    telefono: c.telefono,
    ciudad: c.ciudad,
    correo: c.correo,
    cargo: c.cargo,
    linea: c.linea,
    numeroContrato: c.numeroContrato,
    objeto: c.objeto,
    inicio: c.inicio ?? '',
    fin: c.fin ?? '',
    honorario: c.honorario,
    valorTotal: c.valorTotal,
    riesgo: c.riesgo,
    revisoNombre: c.revisoNombre,
    revisoCargo: c.revisoCargo,
    valorTotalEsperado: valorTotalEsperadoDe(c),
  };
}

/** GET /api/mi-contrato: los campos editables (fechas vacías si el contrato aún no las tiene) y el valor total esperado. */
export async function leerMiContrato(deps: Deps, contratoId: number): Promise<DatosMiContrato> {
  return datosDeContrato(await contratoActivo(deps.db, contratoId));
}

function textoDe(v: unknown): string | null {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v.trim() : null;
}

/**
 * PUT /api/mi-contrato. Solo mira los campos de CAMPOS_CONTRATISTA (cualquier otra clave se ignora).
 * Lo que no viene se conserva. Lanza ErrorValidacion con TODOS los errores por campo.
 * `aviso` (no bloquea) cuando mandó un valor total distinto al que da su honorario por la vigencia.
 */
export async function guardarMiContrato(
  deps: Deps,
  contratoId: number,
  entrada: Record<string, unknown>,
): Promise<RespuestaGuardar> {
  const actual = await contratoActivo(deps.db, contratoId);
  const enviados = CAMPOS_CONTRATISTA.filter((k) => k in entrada);
  if (enviados.length === 0) throw new ErrorAmable('No hay nada que guardar.');

  const err: Record<string, string> = {};
  const nuevos: Partial<Record<CampoContratista, string | number>> = {};

  // textos con largo máximo; el correo es el único que puede quedar vacío
  for (const k of Object.keys(TEXTOS) as Array<keyof typeof TEXTOS>) {
    if (!(k in entrada)) continue;
    const t = TEXTOS[k];
    const texto = textoDe(entrada[k]);
    if (texto === null) err[k] = `${t.etiqueta} debe ser texto.`;
    else if (texto === '' && t.obligatorio) err[k] = t.pide;
    else if (texto.length > t.max) err[k] = `${t.etiqueta} es demasiado largo (máximo ${t.max} caracteres).`;
    else nuevos[k] = texto;
  }

  if ('telefono' in entrada) {
    const texto = textoDe(entrada.telefono);
    if (texto === null) err.telefono = 'El teléfono debe ser texto.';
    else if (texto === '') err.telefono = 'Escribe tu teléfono.';
    else if (!/^[\d\s+]+$/.test(texto) || !/^\d{7,15}$/.test(texto.replace(/[\s+]/g, ''))) err.telefono = MENSAJE_TELEFONO;
    else nuevos.telefono = texto;
  }

  if ('correo' in entrada) {
    const texto = textoDe(entrada.correo);
    if (texto === null) err.correo = 'El correo debe ser texto.';
    else if (texto !== '' && (texto.length > MAX_CORREO || !CORREO_RE.test(texto))) err.correo = MENSAJE_CORREO;
    else nuevos.correo = texto;
  }

  for (const k of ['inicio', 'fin'] as const) {
    if (!(k in entrada)) continue;
    const v = entrada[k];
    const texto = typeof v === 'string' ? v.trim() : '';
    if (texto === '') err[k] = k === 'inicio' ? 'Escribe la fecha de inicio de tu contrato.' : 'Escribe la fecha de fin de tu contrato.';
    else if (!parseYMD(texto)) err[k] = MENSAJE_FECHA_CONTRATO[k];
    else nuevos[k] = texto;
  }

  // fin >= inicio, con lo que viene o, si falta alguno, con lo que ya está guardado
  if (!err.inicio && !err.fin && ('inicio' in nuevos || 'fin' in nuevos)) {
    const inicio = (nuevos.inicio as string | undefined) ?? actual.inicio ?? '';
    const fin = (nuevos.fin as string | undefined) ?? actual.fin ?? '';
    if (inicio && fin && fin < inicio) err.fin = MENSAJE_FIN_ANTES_DE_INICIO;
  }

  if ('honorario' in entrada) {
    const v = entrada.honorario;
    const vacio = v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    const n = vacio ? null : monto(v);
    if (vacio) err.honorario = 'Escribe tu honorario mensual.';
    else if (n === null || n <= 0 || n > MAX_ENTERO) {
      err.honorario = 'El honorario mensual debe ser un valor en pesos mayor que cero (por ejemplo 4.009.000).';
    } else nuevos.honorario = n;
  }

  if ('riesgo' in entrada) {
    const v = entrada.riesgo;
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) err.riesgo = 'Escoge el riesgo ARL (I, II, III, IV o V).';
    else {
      const r = riesgoRomano(v);
      if (r) nuevos.riesgo = r;
      else err.riesgo = 'El riesgo ARL debe ser I, II, III, IV o V.';
    }
  }

  // el valor total no puede ser menor que el honorario, con el honorario NUEVO si viene en la misma petición
  const honorarioVigente = (nuevos.honorario as number | undefined) ?? actual.honorario;
  if ('valorTotal' in entrada) {
    const v = entrada.valorTotal;
    const vacio = v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    const n = vacio ? null : monto(v);
    if (vacio) err.valorTotal = 'Escribe el valor total de tu contrato.';
    else if (n === null || n <= 0 || n > MAX_ENTERO) {
      err.valorTotal = 'El valor total del contrato debe ser un valor en pesos mayor que cero (por ejemplo 44.099.000).';
    } else if (honorarioVigente !== null && n < honorarioVigente) err.valorTotal = MENSAJE_VALOR_TOTAL_MENOR;
    else nuevos.valorTotal = n;
  } else if ('honorario' in nuevos && actual.valorTotal !== null && honorarioVigente !== null && actual.valorTotal < honorarioVigente) {
    // subió el honorario por encima del valor total que ya tenía guardado: que corrija el valor total
    err.valorTotal = MENSAJE_VALOR_TOTAL_MENOR;
  }

  if (Object.keys(err).length) throw new ErrorValidacion(err);

  const cambios = diferencias(actual, nuevos as Partial<ContratoFila>, Object.keys(nuevos));
  let c = actual;
  if (cambios.length) {
    const aGuardar: Record<string, string | number | null> = {};
    for (const d of cambios) aGuardar[d.campo] = nuevos[d.campo as CampoContratista]!;
    // un cambio de la contratista deja sin efecto la verificación con documentos del supervisor: hay que revisarla de nuevo
    aGuardar.verificadaEn = null;
    [c] = await deps.db.update(contratos).set(aGuardar).where(eq(contratos.id, contratoId)).returning();
  }

  // valor total distinto al que da el honorario por la vigencia (con las fechas ya guardadas): aviso que no bloquea
  const esperado = valorTotalEsperadoDe(c);
  const distinto = 'valorTotal' in entrada && esperado !== null && c.valorTotal !== null && c.valorTotal !== esperado;
  if (cambios.length) {
    // alerta (ámbar para el supervisor): valor total distinto al esperado y cualquier cambio de honorario o de riesgo ARL
    for (const d of cambios) {
      if ((d.campo === 'valorTotal' && distinto) || d.campo === 'honorario' || d.campo === 'riesgo') d.alerta = true;
    }
    await registrarCambios(deps, contratoId, 'contratista', cambios);
    // las fechas y el valor total pueden mover el periodo y el %: acumulado y % se recalculan (el valor de cada mes
    // NO se re-evalúa y las fotos del contrato de las cuentas ya enviadas no se tocan)
    await recalcularAcumulados(deps.db, c);
  }

  const respuesta: RespuestaGuardar = { datos: datosDeContrato(c), contrato: await resumen(deps, c) };
  if (distinto) {
    respuesta.aviso =
      `El valor total que escribiste (${fmtMoney(c.valorTotal as number)}) no coincide con el que da tu honorario por la vigencia ` +
      `(${fmtMoney(esperado)}). Revísalo con tu acta; si tu acta dice otra cifra, déjalo así.`;
  }
  return respuesta;
}
