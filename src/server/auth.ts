// Sesiones con cookie firmada (HMAC-SHA256) y verificación de nombre + PIN con límite de intentos.
// Sin dependencias de Next: se puede probar con pglite y relojes inyectados.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { contratos, intentosPin, type ContratoFila } from './db/schema';
import { normTxt } from './entrada';
import { ErrorAmable } from './errores';

export const SESION_COOKIE = 'sesion';
export const SESION_SEGUNDOS = 2 * 3600;
export const MAX_FALLOS_PIN = 5;
export const VENTANA_PIN_MS = 10 * 60 * 1000;

// ------------------------------------------------------------------ comparaciones
/** Comparación en tiempo constante (se comparan los SHA-256 para que la longitud no se filtre). */
export function igualesSeguro(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function ultimos4(cedula: unknown): string {
  return String(cedula === null || cedula === undefined ? '' : cedula)
    .replace(/\D/g, '')
    .slice(-4);
}

// ------------------------------------------------------------------ cookie firmada
export function secretoSesion(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET falta o tiene menos de 32 caracteres');
  return s;
}

function firmar(datos: string, secreto: string): string {
  return createHmac('sha256', secreto).update(datos).digest('base64url');
}

/** Valor de la cookie: base64url({c: contratoId, e: expiraEnSegundos}) + '.' + firma. */
export function crearToken(contratoId: number, secreto: string = secretoSesion(), ahoraMs: number = Date.now()): string {
  const exp = Math.floor(ahoraMs / 1000) + SESION_SEGUNDOS;
  const cuerpo = Buffer.from(JSON.stringify({ c: contratoId, e: exp })).toString('base64url');
  return cuerpo + '.' + firmar(cuerpo, secreto);
}

/** Devuelve el contratoId si la cookie es auténtica y no ha vencido; si no, null. */
export function leerToken(
  token: string | undefined | null,
  secreto: string = secretoSesion(),
  ahoraMs: number = Date.now(),
): number | null {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const [cuerpo, firma] = partes;
  if (!igualesSeguro(firma, firmar(cuerpo, secreto))) return null;
  try {
    const o = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as { c?: unknown; e?: unknown };
    if (typeof o.c !== 'number' || !Number.isInteger(o.c) || typeof o.e !== 'number') return null;
    if (Math.floor(ahoraMs / 1000) >= o.e) return null;
    return o.c;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ PIN y bloqueo
export function claveIntentos(nombre: string): string {
  return normTxt(nombre)
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 120);
}

const MSG_DATOS = 'Escoge tu nombre y escribe tu PIN de 4 números.';
const MSG_BLOQUEO =
  'Ya intentaste muchas veces con un PIN incorrecto. Espera 10 minutos e inténtalo de nuevo, o habla con tu supervisor.';
const MSG_PIN = 'El nombre o el PIN no son correctos. El PIN son los últimos 4 números de tu cédula.';

/** Suma un fallo de forma atómica. El contador vuelve a 1 si el último fallo fue hace más de 10 min. */
async function registrarFallo(db: Db, clave: string, ahora: Date): Promise<void> {
  const iso = ahora.toISOString();
  const ventana = new Date(ahora.getTime() - VENTANA_PIN_MS).toISOString();
  const hasta = new Date(ahora.getTime() + VENTANA_PIN_MS).toISOString();
  const nuevos = sql`CASE WHEN ${intentosPin.ultimoFallo} > ${ventana}::timestamptz THEN ${intentosPin.fallos} + 1 ELSE 1 END`;
  await db
    .insert(intentosPin)
    .values({ clave, fallos: 1, ultimoFallo: ahora, bloqueadoHasta: null })
    .onConflictDoUpdate({
      target: intentosPin.clave,
      set: {
        fallos: nuevos,
        ultimoFallo: sql`${iso}::timestamptz`,
        bloqueadoHasta: sql`CASE WHEN (${nuevos}) >= ${MAX_FALLOS_PIN} THEN ${hasta}::timestamptz ELSE NULL END`,
      },
    });
}

/**
 * Valida nombre + PIN (últimos 4 dígitos de la cédula). 5 fallos por nombre en 10 min bloquean 10 min,
 * incluso con el PIN correcto. Un acierto limpia el contador. Devuelve el contrato (activo) de la contratista.
 */
export async function verificarLogin(db: Db, nombre: unknown, pin: unknown, ahora: Date = new Date()): Promise<ContratoFila> {
  const n = String(nombre ?? '').trim();
  const p = String(pin ?? '').trim();
  if (!n || !/^\d{4}$/.test(p)) throw new ErrorAmable(MSG_DATOS, 400);

  const clave = claveIntentos(n);
  const [fila] = await db.select().from(intentosPin).where(eq(intentosPin.clave, clave)).limit(1);
  if (fila?.bloqueadoHasta && fila.bloqueadoHasta.getTime() > ahora.getTime()) throw new ErrorAmable(MSG_BLOQUEO, 429);

  const activos = await db.select().from(contratos).where(eq(contratos.activo, true));
  const buscado = normTxt(n);
  const c = activos.find((x) => normTxt(x.nombre) === buscado) ?? null;
  const real = c ? ultimos4(c.cedula) : '';
  // siempre se compara (aunque no haya contrato) para no filtrar por tiempo si el nombre existe
  const igual = igualesSeguro(p, real.length === 4 ? real : 'x');
  if (!c || real.length !== 4 || !igual) {
    await registrarFallo(db, clave, ahora);
    throw new ErrorAmable(MSG_PIN, 401);
  }
  if (fila) await db.delete(intentosPin).where(and(eq(intentosPin.clave, clave)));
  return c;
}
