// Ayudas para las rutas de src/app/api/**: respuestas {ok:true,...} | {ok:false,error}, cookie de sesión y cuerpos JSON.

import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_COOKIE, ADMIN_SEGUNDOS, crearTokenAdmin, exigirTokenAdmin } from './adminAuth';
import { SESION_COOKIE, SESION_SEGUNDOS, crearToken, leerToken } from './auth';
import { getBlobStore } from './blob';
import { getDb } from './db';
import { ErrorAmable, ErrorValidacion, MENSAJE_GENERICO, MENSAJE_SESION } from './errores';
import type { Deps } from './servicios';

const SIN_CACHE = { 'Cache-Control': 'no-store' };
const MAX_JSON = 300_000;

export function deps(): Deps {
  return { db: getDb(), blob: getBlobStore() };
}

export function ok(datos: Record<string, unknown> = {}, init: ResponseInit = {}): NextResponse {
  return NextResponse.json({ ok: true, ...datos }, { ...init, headers: { ...SIN_CACHE, ...(init.headers ?? {}) } });
}

export function fallo(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers: SIN_CACHE });
}

/** Ejecuta la ruta: los ErrorAmable salen con su mensaje; cualquier otra cosa, con un mensaje genérico (sin detalles). */
export async function responder(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErrorValidacion) {
      return NextResponse.json({ ok: false, error: e.message, campos: e.campos }, { status: e.estado, headers: SIN_CACHE });
    }
    if (e instanceof ErrorAmable) return fallo(e.message, e.estado);
    console.error('Error en el servidor:', e instanceof Error ? (e.stack ?? e.message) : e);
    return fallo(MENSAJE_GENERICO, 500);
  }
}

export async function leerJson(req: Request): Promise<Record<string, unknown>> {
  const largo = Number(req.headers.get('content-length') ?? 0);
  if (largo > MAX_JSON) throw new ErrorAmable('La solicitud es demasiado grande.', 413);
  const texto = await req.text();
  if (texto.length > MAX_JSON) throw new ErrorAmable('La solicitud es demasiado grande.', 413);
  try {
    const o = JSON.parse(texto || '{}');
    if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
  } catch {
    /* cae al error de abajo */
  }
  throw new ErrorAmable('No entendimos la solicitud. Recarga la página e inténtalo de nuevo.');
}

/** contratoId de la cookie de sesión; sin sesión válida -> 401. */
export function contratoIdDeSesion(req: NextRequest): number {
  const id = leerToken(req.cookies.get(SESION_COOKIE)?.value);
  if (id === null) throw new ErrorAmable(MENSAJE_SESION, 401);
  return id;
}

export function ponerCookieSesion(res: NextResponse, contratoId: number): void {
  res.cookies.set(SESION_COOKIE, crearToken(contratoId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESION_SEGUNDOS,
  });
}

export function quitarCookieSesion(res: NextResponse): void {
  res.cookies.set(SESION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Id numérico de una ruta dinámica ('12' -> 12); si no es un entero razonable -> 404 con `mensaje`. */
export function idDeRuta(s: string, mensaje: string): number {
  if (!/^\d{1,9}$/.test(s)) throw new ErrorAmable(mensaje, 404);
  return Number(s);
}

/** Exige la cookie `admin` (supervisor); si no, 401. */
export function exigirAdmin(req: NextRequest): void {
  exigirTokenAdmin(req.cookies.get(ADMIN_COOKIE)?.value);
}

export function ponerCookieAdmin(res: NextResponse): void {
  res.cookies.set(ADMIN_COOKIE, crearTokenAdmin(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_SEGUNDOS,
  });
}

export function quitarCookieAdmin(res: NextResponse): void {
  res.cookies.set(ADMIN_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Content-Disposition con filename ASCII de respaldo y filename* (RFC 5987) para tildes y ñ. */
export function contentDispositionAdjunto(nombre: string, tipo: 'attachment' | 'inline' = 'attachment'): string {
  const ascii = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '');
  const codificado = encodeURIComponent(nombre).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${codificado}`;
}
