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

/** Planilla adicional guardada dentro de una carga (corrección, ajuste de ARL...). */
export type AdicionalGuardada = {
  numero: string;
  /** Mes cotizado 'AAAA-MM' ('' si no se indicó). */
  mes: string;
  valor: number;
  /** Ruta del archivo en Blob ('' si no se subió archivo). */
  archivo: string;
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
  inicio: date('inicio', { mode: 'string' }),
  fin: date('fin', { mode: 'string' }),
  honorario: integer('honorario'),
  valorTotal: integer('valor_total'),
  riesgo: text('riesgo').notNull().default('I'),
  riesgoNuevo: text('riesgo_nuevo').notNull().default(''),
  riesgoDesde: date('riesgo_desde', { mode: 'string' }),
  revisoNombre: text('reviso_nombre').notNull().default(''),
  revisoCargo: text('reviso_cargo').notNull().default(''),
  activo: boolean('activo').notNull().default(true),
  correo: text('correo').notNull().default(''),
});

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
    aprobado: boolean('aprobado').notNull().default(false),
    creado: timestamp('creado', { withTimezone: true }).notNull().defaultNow(),
    actualizado: timestamp('actualizado', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('cargas_contrato_mes_uq').on(t.contratoId, t.mes)],
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
