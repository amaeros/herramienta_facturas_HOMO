// Acceso a la base de datos. En producción: Neon por HTTP (DATABASE_URL).
// En pruebas: se inyecta una instancia de drizzle sobre pglite con setDb().
//
// OJO: el driver neon-http NO soporta transacciones. Por eso el código del servidor usa
// sentencias sueltas y atómicas (upsert con ON CONFLICT) en vez de db.transaction().

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

/** Tipo común de neon-http y pglite. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, typeof schema, any>;

let inyectada: Db | null = null;
let neonDb: Db | null = null;

/** Para pruebas: usa esta base en vez de Neon. Pasa null para volver a la normal. */
export function setDb(db: Db | null): void {
  inyectada = db;
}

export function getDb(): Db {
  if (inyectada) return inyectada;
  if (!neonDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Falta la variable de entorno DATABASE_URL');
    neonDb = drizzle({ client: neon(url), schema }) as unknown as Db;
  }
  return neonDb;
}

export { schema };
