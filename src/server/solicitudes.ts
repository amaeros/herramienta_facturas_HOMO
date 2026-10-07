// Solicitudes de cuenta (registro propio de la contratista) vistas por el supervisor: lista, detalle, aprobar (con
// correcciones opcionales) y rechazar. Ver docs/ADMIN.md. La cédula completa solo sale en el detalle.

import { and, asc, eq, inArray } from 'drizzle-orm';
import { validarContrato, type ContratoAdmin } from './admin';
import { CAMPOS_AUDITADOS_ADMIN, diferencias, registrarCambios } from './cambios';
import type { Db } from './db';
import { cambiosContrato, contratos, documentos, type ContratoFila } from './db/schema';
import { ErrorAmable } from './errores';
import type { Deps } from './servicios';

const MSG_NO_SOLICITUD = 'No encontramos esa solicitud. Puede que ya la hayas aprobado o rechazado.';

/** En la lista no va la cédula completa: solo los últimos 4 ('…1234'). */
export type SolicitudResumen = Omit<ContratoFila, 'cedula'> & { cedulaFinal4: string; solicitada: Date | null };
export type SolicitudDetalle = ContratoFila & { solicitada: Date | null };

async function fechasDeSolicitud(db: Db, ids: number[]): Promise<Map<number, Date>> {
  if (ids.length === 0) return new Map();
  const filas = await db
    .select({ contratoId: cambiosContrato.contratoId, creado: cambiosContrato.creado })
    .from(cambiosContrato)
    .where(and(inArray(cambiosContrato.contratoId, ids), eq(cambiosContrato.campo, 'registro')))
    .orderBy(asc(cambiosContrato.creado));
  const m = new Map<number, Date>();
  for (const f of filas) if (!m.has(f.contratoId)) m.set(f.contratoId, f.creado);
  return m;
}

/** Las solicitudes pendientes, de la más antigua a la más nueva (se atienden en orden de llegada). */
export async function listarSolicitudes(deps: Deps): Promise<SolicitudResumen[]> {
  const filas = await deps.db.select().from(contratos).where(eq(contratos.estado, 'pendiente'));
  const fechas = await fechasDeSolicitud(deps.db, filas.map((f) => f.id));
  return filas
    .map(({ cedula, ...resto }) => ({ ...resto, cedulaFinal4: '…' + cedula.slice(-4), solicitada: fechas.get(resto.id) ?? null }))
    .sort((a, b) => (a.solicitada?.getTime() ?? 0) - (b.solicitada?.getTime() ?? 0) || a.id - b.id);
}

async function solicitudPorId(db: Db, id: number): Promise<ContratoFila> {
  const [c] = await db.select().from(contratos).where(and(eq(contratos.id, id), eq(contratos.estado, 'pendiente'))).limit(1);
  if (!c) throw new ErrorAmable(MSG_NO_SOLICITUD, 404);
  return c;
}

/** Una solicitud con todos sus datos (cédula completa, para el formulario de corrección). */
export async function detalleSolicitud(deps: Deps, id: number): Promise<SolicitudDetalle> {
  const c = await solicitudPorId(deps.db, id);
  return { ...c, solicitada: (await fechasDeSolicitud(deps.db, [id])).get(id) ?? null };
}

/**
 * Aprueba la solicitud: valida como la edición del panel (lo que no viene se conserva; `entrada` puede traer
 * correcciones), la deja 'activa' y activa, y anota en la bitácora lo corregido y que se aprobó.
 */
export async function aprobarSolicitud(deps: Deps, id: number, entrada: Record<string, unknown>): Promise<ContratoAdmin> {
  const actual = await solicitudPorId(deps.db, id);
  const otros = (await deps.db.select().from(contratos)).filter((c) => c.id !== id);
  const v = validarContrato({ ...entrada, activo: true }, actual, otros);
  // el UPDATE vuelve a exigir 'pendiente': si otra pestaña la aprobó o rechazó mientras tanto, no pasa nada raro
  const [c] = await deps.db
    .update(contratos)
    .set({ ...v, activo: true, estado: 'activa' })
    .where(and(eq(contratos.id, id), eq(contratos.estado, 'pendiente')))
    .returning();
  if (!c) throw new ErrorAmable(MSG_NO_SOLICITUD, 404);
  const correcciones = diferencias(actual, c, CAMPOS_AUDITADOS_ADMIN.filter((k) => k !== 'activo'));
  await registrarCambios(deps, id, 'admin', [...correcciones, { campo: 'aprobada', antes: '', despues: 'Aprobada' }]);
  return { ...c, cargas: 0 };
}

/**
 * Rechaza la solicitud: se borra la fila (su bitácora y sus documentos se borran en cascada). Nunca borra una cuenta ya
 * aprobada. Los PDF de los documentos que subió el supervisor se borran de Blob primero: si Blob falla, no se pierde nada.
 */
export async function rechazarSolicitud(deps: Deps, id: number): Promise<void> {
  await solicitudPorId(deps.db, id); // 404 si ya no es una solicitud pendiente: así nunca se tocan archivos de una cuenta aprobada
  const pdfs = await deps.db.select({ archivo: documentos.archivo }).from(documentos).where(eq(documentos.contratoId, id));
  const archivos = pdfs.map((d) => d.archivo).filter(Boolean);
  if (archivos.length) {
    try {
      await deps.blob.del(archivos);
    } catch {
      throw new ErrorAmable('No pudimos borrar los PDF de la solicitud. No se rechazó; inténtalo de nuevo en un momento.', 502);
    }
  }
  const borradas = await deps.db
    .delete(contratos)
    .where(and(eq(contratos.id, id), eq(contratos.estado, 'pendiente')))
    .returning({ id: contratos.id });
  if (borradas.length === 0) throw new ErrorAmable(MSG_NO_SOLICITUD, 404);
}
