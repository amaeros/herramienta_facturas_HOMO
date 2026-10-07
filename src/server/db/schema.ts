// Esquema de la base de datos (Postgres en Neon; pglite en las pruebas).
// Ver docs/ARQUITECTURA.md. Fechas como texto 'AAAA-MM-DD' (mode: 'string'), meses como 'AAAA-MM'.

import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { CamposDocumento } from '../../lib/documentos';

/** Planilla adicional guardada dentro de una carga (corrección, ajuste de ARL...). */
export type AdicionalGuardada = {
  numero: string;
  /** Mes cotizado 'AAAA-MM' ('' si no se indicó). */
  mes: string;
  valor: number;
  /** Ruta del archivo en Blob ('' si no se subió archivo). */
  archivo: string;
};

/**
 * Foto de los datos del contrato que usa la cuenta de cobro, tomada al enviarla.
 * Así, un otrosí (el contrato se edita con nuevas fechas/valor) no cambia las cuentas ya enviadas.
 */
export type ContratoSnapshot = {
  nombre: string;
  cedula: string;
  direccion: string;
  telefono: string;
  ciudad: string;
  cargo: string;
  numeroContrato: string;
  objeto: string;
  valorTotal: number;
  honorario: number;
  inicio: string;
  fin: string;
  /** Riesgo ARL vigente en el mes cobrado. */
  riesgo: string;
  revisoNombre: string;
  revisoCargo: string;
};

/** Una sola fila (id = 1) con las reglas de seguridad social. */
export const parametros = pgTable('parametros', {
  id: integer('id').primaryKey().default(1),
  pctIbc: doublePrecision('pct_ibc').notNull(),
  salud: doublePrecision('salud').notNull(),
  pension: doublePrecision('pension').notNull(),
  smmlv: integer('smmlv').notNull(),
  ibcPisoMult: doublePrecision('ibc_piso_mult').notNull(),
  ibcTechoMult: doublePrecision('ibc_techo_mult').notNull(),
  /** { I: 0.00522, II: ..., V: ... } */
  arl: jsonb('arl').$type<Record<string, number>>().notNull(),
  enviarCorreo: boolean('enviar_correo').notNull().default(false),
  correoSupervisor: text('correo_supervisor').notNull().default(''),
  toleranciaSs: integer('tolerancia_ss').notNull().default(100),
});

export const contratos = pgTable('contratos', {
  id: serial('id').primaryKey(),
  nombre: text('nombre').notNull(),
  /** Solo dígitos. Los últimos 4 son el PIN. */
  cedula: text('cedula').notNull().default(''),
  direccion: text('direccion').notNull().default(''),
  telefono: text('telefono').notNull().default(''),
  ciudad: text('ciudad').notNull().default(''),
  cargo: text('cargo').notNull().default(''),
  numeroContrato: text('numero_contrato').notNull().default(''),
  objeto: text('objeto').notNull().default(''),
  /** "Línea política pública" (viene del Excel de control). */
  linea: text('linea').notNull().default(''),
  inicio: date('inicio', { mode: 'string' }),
  fin: date('fin', { mode: 'string' }),
  honorario: integer('honorario'),
  valorTotal: integer('valor_total'),
  riesgo: text('riesgo').notNull().default('I'),
  riesgoNuevo: text('riesgo_nuevo').notNull().default(''),
  riesgoDesde: date('riesgo_desde', { mode: 'string' }),
  revisoNombre: text('reviso_nombre').notNull().default(''),
  revisoCargo: text('reviso_cargo').notNull().default(''),
  /** Desactivar (activo = false) no cambia el estado: la cuenta sigue siendo 'activa' pero no entra. */
  activo: boolean('activo').notNull().default(true),
  correo: text('correo').notNull().default(''),
  /**
   * 'activa' | 'pendiente' | 'rechazada'. Una solicitud de registro nace 'pendiente' (y con activo = false) hasta que el
   * supervisor la aprueba. Para entrar hace falta estado = 'activa' Y activo = true.
   */
  estado: text('estado').notNull().default('activa'),
  /**
   * Cuándo el supervisor marcó el contrato como "verificada" contra los PDF (contrato, acta o póliza). Si la contratista
   * cambia después cualquier dato de su contrato ("mi contrato"), vuelve a null: hace falta revisarla otra vez.
   * Lo que edita el supervisor no la borra.
   */
  verificadaEn: timestamp('verificada_en', { withTimezone: true }),
});

export type EstadoContrato = 'activa' | 'pendiente' | 'rechazada';

export const cargas = pgTable(
  'cargas',
  {
    id: serial('id').primaryKey(),
    contratoId: integer('contrato_id')
      .notNull()
      .references(() => contratos.id),
    /** Mes cobrado 'AAAA-MM'. */
    mes: text('mes').notNull(),
    fechaInicio: date('fecha_inicio', { mode: 'string' }).notNull(),
    fechaCorte: date('fecha_corte', { mode: 'string' }).notNull(),
    planillaNumero: text('planilla_numero').notNull().default(''),
    /** Mes cotizado de la planilla principal 'AAAA-MM' ('' si no se indicó). */
    planillaMes: text('planilla_mes').notNull().default(''),
    ssDeclarada: integer('ss_declarada'),
    adicionales: jsonb('adicionales').$type<AdicionalGuardada[]>().notNull().default([]),
    diasManual: integer('dias_manual'),
    motivoNovedad: text('motivo_novedad').notNull().default(''),
    docNum: integer('doc_num').notNull(),
    dias: integer('dias').notNull(),
    valor: integer('valor').notNull(),
    acumulado: integer('acumulado').notNull().default(0),
    pct: doublePrecision('pct').notNull().default(0),
    ssEsperada: integer('ss_esperada'),
    desglose: text('desglose').notNull().default(''),
    /** 'OK' | 'REVISAR' | 'ERROR' */
    estado: text('estado').notNull(),
    mensaje: text('mensaje').notNull().default(''),
    /** 'auto' | 'corregido' | 'manual' */
    lectura: text('lectura').notNull(),
    /** Ruta (pathname) de la planilla principal en Blob. */
    archivoPlanilla: text('archivo_planilla').notNull().default(''),
    observacion: text('observacion').notNull().default(''),
    /** Datos del contrato al momento de enviar (null en cuentas viejas: se usa el contrato actual). */
    contratoSnapshot: jsonb('contrato_snapshot').$type<ContratoSnapshot>(),
    aprobado: boolean('aprobado').notNull().default(false),
    creado: timestamp('creado', { withTimezone: true }).notNull().defaultNow(),
    actualizado: timestamp('actualizado', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('cargas_contrato_mes_uq').on(t.contratoId, t.mes)],
);

/**
 * Bitácora de cambios al contrato: quién (contratista o admin), qué campo, y el valor antes y después ya legibles
 * (fechas como DD/MM/AAAA). Se borra junto con el contrato.
 */
export const cambiosContrato = pgTable(
  'cambios_contrato',
  {
    id: serial('id').primaryKey(),
    contratoId: integer('contrato_id')
      .notNull()
      .references(() => contratos.id, { onDelete: 'cascade' }),
    /** 'contratista' | 'admin' */
    autor: text('autor').notNull(),
    /** Nombre del campo del contrato en camelCase ('inicio', 'fin', 'revisoNombre', 'revisoCargo'...). */
    campo: text('campo').notNull(),
    antes: text('antes').notNull().default(''),
    despues: text('despues').notNull().default(''),
    /** true si la contratista guardó un valor total distinto al esperado, o cambió su honorario o su riesgo ARL. */
    alerta: boolean('alerta').notNull().default(false),
    creado: timestamp('creado', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('cambios_contrato_contrato_idx').on(t.contratoId), index('cambios_contrato_creado_idx').on(t.creado)],
);

/**
 * PDF del contrato, del acta de prórroga o adición, o de la póliza que el supervisor sube para comparar con los datos de la
 * app. `campos` y `notas` los saca el SERVIDOR con leerDocumento (nunca se confía en lo que lea el navegador). El PDF va a
 * Blob privado (`archivo` = ruta; nunca se devuelve al navegador). Se borra junto con el contrato (la fila en cascada; el
 * archivo, a mano en borrarContrato / rechazarSolicitud).
 */
export const documentos = pgTable(
  'documentos',
  {
    id: serial('id').primaryKey(),
    contratoId: integer('contrato_id')
      .notNull()
      .references(() => contratos.id, { onDelete: 'cascade' }),
    /** 'contrato' | 'acta_prorroga' | 'poliza' | 'desconocido' */
    tipo: text('tipo').notNull(),
    nombreArchivo: text('nombre_archivo').notNull(),
    /** Ruta (pathname) del PDF en Blob. */
    archivo: text('archivo').notNull(),
    campos: jsonb('campos').$type<CamposDocumento>().notNull(),
    notas: jsonb('notas').$type<string[]>().notNull().default([]),
    subido: timestamp('subido', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('documentos_contrato_idx').on(t.contratoId)],
);

/** Planillas subidas que todavía no se enviaron (caducan a las 6 h). */
export const lecturas = pgTable(
  'lecturas',
  {
    tempId: uuid('temp_id').primaryKey(),
    contratoId: integer('contrato_id')
      .notNull()
      .references(() => contratos.id),
    archivo: text('archivo').notNull(),
    /** 'pdf' | 'jpg' | 'png' */
    tipo: text('tipo').notNull(),
    lectura: jsonb('lectura')
      .$type<{ numero: string; periodo: string; salud: number | null; pension: number | null; arl: number | null }>()
      .notNull(),
    leyo: boolean('leyo').notNull().default(false),
    creado: timestamp('creado', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lecturas_creado_idx').on(t.creado)],
);

/** Límite de intentos de PIN por nombre normalizado. */
export const intentosPin = pgTable('intentos_pin', {
  clave: text('clave').primaryKey(),
  fallos: integer('fallos').notNull().default(0),
  /** Momento del último fallo: sirve para que el contador caduque a los 10 min. */
  ultimoFallo: timestamp('ultimo_fallo', { withTimezone: true }),
  bloqueadoHasta: timestamp('bloqueado_hasta', { withTimezone: true }),
});

export type Parametros = typeof parametros.$inferSelect;
export type ContratoFila = typeof contratos.$inferSelect;
export type CargaFila = typeof cargas.$inferSelect;
export type LecturaFila = typeof lecturas.$inferSelect;
export type CambioContratoFila = typeof cambiosContrato.$inferSelect;
export type DocumentoFila = typeof documentos.$inferSelect;
