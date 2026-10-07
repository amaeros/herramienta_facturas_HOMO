// Acceso del supervisor (/admin): contraseña única (ADMIN_PASSWORD) -> cookie `admin` firmada con SESSION_SECRET.
// Sin dependencias de Next: se prueba con pglite y relojes inyectados. Ver docs/ADMIN.md.

import { eq } from 'drizzle-orm';
import {
  MAX_FALLOS_PIN,
  VENTANA_PIN_MS,
  firmar,
  igualesSeguro,
  leerToken,
  registrarFallo,
  secretoSesion,
} from './auth';
import type { Db } from './db';
import { intentosPin } from './db/schema';
import { ErrorAmable, MENSAJE_SESION } from './errores';

export const ADMIN_COOKIE = 'admin';
export const ADMIN_SEGUNDOS = 8 * 3600;
/** Clave en `intentos_pin` (no puede chocar con las de contratistas: esas solo tienen a-z, 0-9 y un '_' en medio). */
export const CLAVE_INTENTOS_ADMIN = '__admin__';
export { MAX_FALLOS_PIN as MAX_FALLOS_ADMIN, VENTANA_PIN_MS as VENTANA_ADMIN_MS };

export const MENSAJE_SESION_ADMIN = 'Tu sesión de administración venció. Vuelve a entrar con la contraseña.';
const MSG_SIN_CONFIG =
  'El acceso de administración todavía no está configurado (falta la variable ADMIN_PASSWORD en Vercel). Avisa a quien instaló la app.';
const MSG_CLAVE = 'La contraseña no es correcta.';
const MSG_BLOQUEO = 'Ya intentaste muchas veces con una contraseña incorrecta. Espera 10 minutos e inténtalo de nuevo.';

/** Valor de la cookie: base64url({a: 1, e: expiraEnSegundos}) + '.' + firma. El campo `a` la distingue de la de contratista (`c`). */
export function crearTokenAdmin(secreto: string = secretoSesion(), ahoraMs: number = Date.now()): string {
  const exp = Math.floor(ahoraMs / 1000) + ADMIN_SEGUNDOS;
  const cuerpo = Buffer.from(JSON.stringify({ a: 1, e: exp })).toString('base64url');
  return cuerpo + '.' + firmar(cuerpo, secreto);
}

/** true si la cookie es auténtica, es de admin y no ha vencido. */
export function tokenAdminValido(
  token: string | undefined | null,
  secreto: string = secretoSesion(),
  ahoraMs: number = Date.now(),
): boolean {
  if (!token || typeof token !== 'string') return false;
  const partes = token.split('.');
  if (partes.length !== 2) return false;
  const [cuerpo, firma] = partes;
  if (!igualesSeguro(firma, firmar(cuerpo, secreto))) return false;
  try {
    const o = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as { a?: unknown; e?: unknown };
    return o.a === 1 && typeof o.e === 'number' && Math.floor(ahoraMs / 1000) < o.e;
  } catch {
    return false;
  }
}

/**
 * Valida la contraseña de admin. 5 fallos en 10 min bloquean 10 min (incluso con la clave correcta).
 * Sin ADMIN_PASSWORD el login siempre falla con un mensaje claro (y no cuenta como intento).
 */
export async function verificarAdmin(db: Db, password: unknown, ahora: Date = new Date()): Promise<void> {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) throw new ErrorAmable(MSG_SIN_CONFIG, 503);
  const p = typeof password === 'string' ? password : '';
  if (!p) throw new ErrorAmable('Escribe la contraseña.', 400);

  const [fila] = await db.select().from(intentosPin).where(eq(intentosPin.clave, CLAVE_INTENTOS_ADMIN)).limit(1);
  if (fila?.bloqueadoHasta && fila.bloqueadoHasta.getTime() > ahora.getTime()) throw new ErrorAmable(MSG_BLOQUEO, 429);

  if (!igualesSeguro(p, real)) {
    await registrarFallo(db, CLAVE_INTENTOS_ADMIN, ahora);
    throw new ErrorAmable(MSG_CLAVE, 401);
  }
  if (fila) await db.delete(intentosPin).where(eq(intentosPin.clave, CLAVE_INTENTOS_ADMIN));
}

/** ¿Esta cookie `admin` es de un supervisor con sesión vigente? */
export function esAdmin(cookieAdmin: string | undefined | null): boolean {
  return tokenAdminValido(cookieAdmin);
}

/** Exige sesión de admin; si no, 401. */
export function exigirTokenAdmin(cookieAdmin: string | undefined | null): void {
  if (!tokenAdminValido(cookieAdmin)) throw new ErrorAmable(MENSAJE_SESION_ADMIN, 401);
}

/**
 * Quién puede bajar una factura: admin (cualquiera, devuelve undefined) o la contratista dueña (devuelve su contratoId).
 * Sin ninguna de las dos cookies válidas -> 401.
 */
export function accesoFactura(cookieSesion: string | undefined | null, cookieAdmin: string | undefined | null): number | undefined {
  if (tokenAdminValido(cookieAdmin)) return undefined;
  const id = leerToken(cookieSesion);
  if (id === null) throw new ErrorAmable(MENSAJE_SESION, 401);
  return id;
}
