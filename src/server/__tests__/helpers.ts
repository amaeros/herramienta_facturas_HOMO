// Ayudas para las pruebas del servidor. TODOS los datos son inventados.
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import type { BlobStore } from '../blob';
import type { Db } from '../db';
import * as schema from '../db/schema';
import type { Deps } from '../servicios';

export async function crearBase(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  return db as unknown as Db;
}

export async function vaciar(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE cargas, lecturas, intentos_pin, contratos RESTART IDENTITY CASCADE`);
}

/** Almacén en memoria con el mismo contrato que blob.ts. */
export class BlobFalso implements BlobStore {
  archivos = new Map<string, { body: Buffer; contentType: string }>();
  async put(pathname: string, body: Buffer, contentType: string) {
    if (this.archivos.has(pathname)) throw new Error('ya existe ' + pathname);
    this.archivos.set(pathname, { body, contentType });
  }
  async del(pathnames: string[]) {
    for (const p of pathnames) this.archivos.delete(p);
  }
}

export const AHORA = new Date('2026-09-15T17:00:00Z'); // 12:00 en Bogotá, septiembre de 2026

export function crearDeps(db: Db, blob: BlobFalso, ahora: () => Date = () => AHORA): Deps {
  return { db, blob, ahora };
}

/** PRUEBA PÉREZ: honorario 4.009.000, riesgo III, contrato 2026-01-01 a 2026-09-30. PIN 0879. */
export async function crearContratista(db: Db, over: Partial<typeof schema.contratos.$inferInsert> = {}): Promise<number> {
  const [c] = await db
    .insert(schema.contratos)
    .values({
      nombre: 'PRUEBA PÉREZ',
      cedula: '1000000879',
      direccion: 'Calle 1 # 2-3',
      telefono: '3000000000',
      ciudad: 'Medellín',
      cargo: 'Profesional de prueba',
      numeroContrato: '2026CPS999',
      objeto: 'Objeto ficticio de prueba.',
      inicio: '2026-01-01',
      fin: '2026-09-30',
      honorario: 4009000,
      valorTotal: 36081000,
      riesgo: 'III',
      revisoNombre: 'Revisora de Prueba',
      revisoCargo: 'Apoyo Técnico',
      activo: true,
      ...over,
    })
    .returning({ id: schema.contratos.id });
  return c.id;
}

export function bytesPdf(extra = ''): Uint8Array {
  return new Uint8Array(Buffer.from('%PDF-1.4\n% archivo de prueba ' + extra + '\n%%EOF\n'));
}

/** Texto en formato "Aportes en Línea" que el lector (parser.ts) reconoce con confianza alta. */
export function textoPlanilla(o: { numero?: string; periodo?: string; salud?: number; pension?: number; arl?: number } = {}): string {
  const numero = o.numero ?? '1234567890';
  const periodo = o.periodo ?? '2026-09';
  const salud = o.salud ?? 218900,
    pension = o.pension ?? 280200,
    arl = o.arl ?? 42700;
  const f = (n: number) => '$ ' + n.toLocaleString('de-DE');
  return [
    'Aportes en Linea',
    'Liquidacion Detallada de Aportes',
    'Datos Generales de la Liquidacion',
    'Periodo pension Periodo salud Clave planilla Tipo Valor total a pagar',
    `${periodo} ${periodo} ${numero} E ${f(salud + pension + arl)}`,
    'Resumen de Pago',
    `AFP (ADMINISTRADORA: 1) ${f(pension)}`,
    `EPS (ADMINISTRADORA: 1) ${f(salud)}`,
    `ARL (ADMINISTRADORA: 1) ${f(arl)}`,
    'CCF (ADMINISTRADORA: 1) $ 0',
    `TOTAL 4 ${f(salud + pension + arl)} $ 0`,
  ].join('\n');
}
