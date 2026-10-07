// Bitácora de cambios al contrato (tabla cambios_contrato): la escriben "mi contrato" (contratista) y la edición del
// panel de admin; la lee el supervisor en GET /api/admin/cambios. Ver docs/ADMIN.md.
// Los datos personales (dirección, teléfono, correo) nunca se guardan: el cambio queda anotado como "(dato personal)".

import { and, desc, eq } from 'drizzle-orm';
import { fmtFecha, fmtMoney } from '../lib/calc';
import type { Db } from './db';
import { cambiosContrato, contratos, type ContratoFila } from './db/schema';
import { ErrorAmable } from './errores';
import type { Deps } from './servicios';

export type AutorCambio = 'contratista' | 'admin';

/** Lo que se anota en lugar del valor de un dato personal. */
export const DATO_PERSONAL = '(dato personal)';

/** Campos cuyo valor NUNCA se guarda en la bitácora. */
export const CAMPOS_PERSONALES: ReadonlySet<string> = new Set(['direccion', 'telefono', 'correo', 'nombre', 'cedula']);

/** Etiqueta legible de cada campo auditado (lo que ve el supervisor). */
export const ETIQUETAS_CAMPO: Record<string, string> = {
  inicio: 'Fecha de inicio',
  fin: 'Fecha de fin',
  revisoNombre: 'Revisó (nombre)',
  revisoCargo: 'Revisó (cargo)',
  numeroContrato: 'N.º de contrato',
  objeto: 'Objeto del contrato',
  honorario: 'Honorario',
  valorTotal: 'Valor total del contrato',
  riesgo: 'Riesgo ARL',
  riesgoNuevo: 'Riesgo ARL nuevo',
  riesgoDesde: 'Riesgo ARL nuevo desde',
  activo: 'Trabajadora activa',
  // solicitud de cuenta nueva (registro propio de la contratista, aprobado por el supervisor)
  registro: 'Solicitud de cuenta',
  aprobada: 'Solicitud aprobada',
  // verificación contra los PDF del contrato (docs/ADMIN.md)
  verificada: 'Verificación con documento',
  nombre: 'Nombre',
  cedula: 'Cédula',
  // los que solo cambia la contratista (los admin no se anotan: ver CAMPOS_AUDITADOS_ADMIN)
  direccion: 'Dirección',
  telefono: 'Teléfono',
  correo: 'Correo',
  ciudad: 'Ciudad',
  cargo: 'Cargo',
};

/** Los campos que la contratista puede editar de su propio contrato, en el orden de la pantalla. */
export const CAMPOS_CONTRATISTA = [
  'direccion',
  'telefono',
  'ciudad',
  'correo',
  'cargo',
  'objeto',
  'inicio',
  'fin',
  'valorTotal',
  'revisoNombre',
  'revisoCargo',
] as const;
export type CampoContratista = (typeof CAMPOS_CONTRATISTA)[number];

/** Campos que se anotan cuando los cambia el admin (sin datos personales, igual que siempre). */
export const CAMPOS_AUDITADOS_ADMIN = [
  'inicio',
  'fin',
  'revisoNombre',
  'revisoCargo',
  'numeroContrato',
  'objeto',
  'honorario',
  'valorTotal',
  'riesgo',
  'riesgoNuevo',
  'riesgoDesde',
  'activo',
];

const CAMPOS_FECHA = new Set(['inicio', 'fin', 'riesgoDesde']);
const CAMPOS_DINERO = new Set(['honorario', 'valorTotal']);
const VACIO = '(vacío)';

/** Valor de un campo como texto legible: fechas DD/MM/AAAA, dinero con puntos, sí/no. */
export function textoDeCampo(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return VACIO;
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (CAMPOS_FECHA.has(campo)) return fmtFecha(v) || String(v);
  if (CAMPOS_DINERO.has(campo) && typeof v === 'number') return fmtMoney(v);
  return String(v);
}

export type Diferencia = { campo: string; antes: string; despues: string; alerta?: boolean };

/**
 * Campos de `campos` cuyo valor cambió entre `antes` y `despues` (null y '' cuentan como lo mismo).
 * Los datos personales se anotan como "(dato personal)": nunca su valor.
 */
export function diferencias(antes: Partial<ContratoFila>, despues: Partial<ContratoFila>, campos: readonly string[]): Diferencia[] {
  const res: Diferencia[] = [];
  for (const campo of campos) {
    const a = (antes as Record<string, unknown>)[campo] ?? '';
    const d = (despues as Record<string, unknown>)[campo] ?? '';
    if (a === d) continue;
    if (CAMPOS_PERSONALES.has(campo)) res.push({ campo, antes: DATO_PERSONAL, despues: DATO_PERSONAL });
    else res.push({ campo, antes: textoDeCampo(campo, a), despues: textoDeCampo(campo, d) });
  }
  return res;
}

/** Escribe una fila por cambio. Sin cambios no hace nada. */
export async function registrarCambios(
  deps: Pick<Deps, 'db' | 'ahora'>,
  contratoId: number,
  autor: AutorCambio,
  lista: Diferencia[],
): Promise<void> {
  if (lista.length === 0) return;
  const creado = deps.ahora ? deps.ahora() : new Date();
  await deps.db.insert(cambiosContrato).values(lista.map((d) => ({ contratoId, autor, campo: d.campo, antes: d.antes, despues: d.despues, alerta: d.alerta === true, creado })),
  );
}

// =================================================================== lectura (supervisor)
export type CambioAdmin = {
  id: number;
  contratoId: number;
  nombre: string;
  autor: string;
  campo: string;
  etiqueta: string;
  antes: string;
  despues: string;
  /** La contratista guardó un valor total distinto al que da su honorario por la vigencia. */
  alerta: boolean;
  creado: Date;
};

const MAX_CAMBIOS = 100;

/** Los últimos 100 cambios, del más nuevo al más viejo; de un solo contrato si se pasa `contratoIdPedido`. */
export async function listarCambios(db: Db, contratoIdPedido?: unknown): Promise<CambioAdmin[]> {
  const pedido = contratoIdPedido === null || contratoIdPedido === undefined ? '' : String(contratoIdPedido).trim();
  if (pedido !== '' && !/^\d{1,9}$/.test(pedido)) throw new ErrorAmable('El contratoId no es válido.');
  const consulta = db
    .select({ cambio: cambiosContrato, nombre: contratos.nombre })
    .from(cambiosContrato)
    .innerJoin(contratos, eq(cambiosContrato.contratoId, contratos.id));
  // las solicitudes pendientes todavía no son trabajadoras: su bitácora aparece cuando se aprueban
  const soloActivas = eq(contratos.estado, 'activa');
  const filas = await consulta
    .where(pedido === '' ? soloActivas : and(soloActivas, eq(cambiosContrato.contratoId, Number(pedido))))
    .orderBy(desc(cambiosContrato.creado), desc(cambiosContrato.id))
    .limit(MAX_CAMBIOS);
  return filas.map(({ cambio: c, nombre }) => ({
    id: c.id,
    contratoId: c.contratoId,
    nombre,
    autor: c.autor,
    campo: c.campo,
    etiqueta: ETIQUETAS_CAMPO[c.campo] ?? c.campo,
    antes: c.antes,
    despues: c.despues,
    alerta: c.alerta,
    creado: c.creado,
  }));
}
