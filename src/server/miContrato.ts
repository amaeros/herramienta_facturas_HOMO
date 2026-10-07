// "Mi contrato": la contratista edita 4 campos de SU contrato (fechas de inicio y fin, y quién revisó). Todo lo demás
// (honorario, valor total, riesgo, n.º de contrato...) solo lo cambia el supervisor y se ignora si llega en el cuerpo.
// Cada cambio real queda en la bitácora (cambios_contrato) y se recalculan acumulado y % de las cuentas del periodo.

import { eq } from 'drizzle-orm';
import { parseYMD } from '../lib/calc';
import { CAMPOS_CONTRATISTA, diferencias, registrarCambios, type CampoContratista } from './cambios';
import { contratos, type ContratoFila } from './db/schema';
import { MENSAJE_FECHA_CONTRATO, MENSAJE_FIN_ANTES_DE_INICIO } from './entrada';
import { ErrorAmable, ErrorValidacion } from './errores';
import { contratoActivo, recalcularAcumulados, resumen, type Deps, type Resumen } from './servicios';

export type DatosMiContrato = { inicio: string; fin: string; revisoNombre: string; revisoCargo: string };

const MAX_REVISO = 120;
const ETIQUETA_REVISO = { revisoNombre: 'El nombre de quien revisó', revisoCargo: 'El cargo de quien revisó' } as const;

export function datosDeContrato(c: ContratoFila): DatosMiContrato {
  return { inicio: c.inicio ?? '', fin: c.fin ?? '', revisoNombre: c.revisoNombre, revisoCargo: c.revisoCargo };
}

/** GET /api/mi-contrato: los 4 campos editables (fechas vacías si el contrato aún no las tiene). */
export async function leerMiContrato(deps: Deps, contratoId: number): Promise<DatosMiContrato> {
  return datosDeContrato(await contratoActivo(deps.db, contratoId));
}

/**
 * PUT /api/mi-contrato. Solo mira inicio, fin, revisoNombre y revisoCargo (cualquier otra clave se ignora).
 * Lo que no viene se conserva. Lanza ErrorValidacion con TODOS los errores por campo.
 */
export async function guardarMiContrato(
  deps: Deps,
  contratoId: number,
  entrada: Record<string, unknown>,
): Promise<{ datos: DatosMiContrato; contrato: Resumen }> {
  const actual = await contratoActivo(deps.db, contratoId);
  const enviados = CAMPOS_CONTRATISTA.filter((k) => k in entrada);
  if (enviados.length === 0) throw new ErrorAmable('No hay nada que guardar.');

  const err: Record<string, string> = {};
  const nuevos: Partial<Record<CampoContratista, string>> = {};

  for (const k of ['inicio', 'fin'] as const) {
    if (!(k in entrada)) continue;
    const v = entrada[k];
    const texto = typeof v === 'string' ? v.trim() : '';
    if (texto === '') err[k] = k === 'inicio' ? 'Escribe la fecha de inicio de tu contrato.' : 'Escribe la fecha de fin de tu contrato.';
    else if (!parseYMD(texto)) err[k] = MENSAJE_FECHA_CONTRATO[k];
    else nuevos[k] = texto;
  }

  for (const k of ['revisoNombre', 'revisoCargo'] as const) {
    if (!(k in entrada)) continue;
    const v = entrada[k];
    if (v !== null && v !== undefined && typeof v !== 'string') err[k] = `${ETIQUETA_REVISO[k]} debe ser texto.`;
    else {
      const texto = (v ?? '').trim();
      if (texto.length > MAX_REVISO) err[k] = `${ETIQUETA_REVISO[k]} es demasiado largo (máximo ${MAX_REVISO} caracteres).`;
      else nuevos[k] = texto;
    }
  }

  // fin >= inicio, con lo que viene o, si falta alguno, con lo que ya está guardado
  if (!err.inicio && !err.fin && ('inicio' in nuevos || 'fin' in nuevos)) {
    const inicio = nuevos.inicio ?? actual.inicio ?? '';
    const fin = nuevos.fin ?? actual.fin ?? '';
    if (inicio && fin && fin < inicio) err.fin = MENSAJE_FIN_ANTES_DE_INICIO;
  }

  if (Object.keys(err).length) throw new ErrorValidacion(err);

  const cambios = diferencias(actual, nuevos, Object.keys(nuevos));
  let c = actual;
  if (cambios.length) {
    const aGuardar: Partial<typeof contratos.$inferInsert> = {};
    for (const d of cambios) (aGuardar as Record<string, string>)[d.campo] = nuevos[d.campo as CampoContratista]!;
    [c] = await deps.db.update(contratos).set(aGuardar).where(eq(contratos.id, contratoId)).returning();
    await registrarCambios(deps, contratoId, 'contratista', cambios);
    // las fechas pueden mover el periodo vigente: acumulado y % se recalculan (el valor de cada mes NO se re-evalúa
    // y las fotos del contrato de las cuentas ya enviadas no se tocan)
    await recalcularAcumulados(deps.db, c);
  }
  return { datos: datosDeContrato(c), contrato: await resumen(deps, c) };
}
