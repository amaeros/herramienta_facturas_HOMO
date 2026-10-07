import { beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN_SEGUNDOS,
  CLAVE_INTENTOS_ADMIN,
  MAX_FALLOS_ADMIN,
  VENTANA_ADMIN_MS,
  accesoFactura,
  crearTokenAdmin,
  exigirTokenAdmin,
  tokenAdminValido,
  verificarAdmin,
} from '../adminAuth';
import { crearToken } from '../auth';
import type { Db } from '../db';
import { intentosPin } from '../db/schema';
import { ErrorAmable } from '../errores';
import { datosFactura } from '../servicios';
import { BlobFalso, crearBase, crearCarga, crearContratista, crearDeps, vaciar } from './helpers';

const SECRETO = 'un-secreto-de-prueba-de-al-menos-32-caracteres!!';
const CLAVE = 'clave-de-prueba-admin';
const T0 = new Date('2026-09-15T17:00:00Z');
const mas = (ms: number) => new Date(T0.getTime() + ms);

let db: Db;
let guardado: { s?: string; a?: string };

beforeAll(async () => {
  db = await crearBase();
});

beforeEach(async () => {
  guardado = { s: process.env.SESSION_SECRET, a: process.env.ADMIN_PASSWORD };
  process.env.SESSION_SECRET = SECRETO;
  process.env.ADMIN_PASSWORD = CLAVE;
  await vaciar(db);
});

afterEach(() => {
  for (const [k, v] of [
    ['SESSION_SECRET', guardado.s],
    ['ADMIN_PASSWORD', guardado.a],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function error(p: Promise<unknown>): Promise<ErrorAmable> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorAmable);
    return e as ErrorAmable;
  }
  throw new Error('debía fallar');
}

describe('cookie de admin', () => {
  it('ida y vuelta y vence a las 8 h', () => {
    const t = crearTokenAdmin(SECRETO, T0.getTime());
    expect(tokenAdminValido(t, SECRETO, T0.getTime() + 1000)).toBe(true);
    expect(tokenAdminValido(t, SECRETO, T0.getTime() + (ADMIN_SEGUNDOS - 1) * 1000)).toBe(true);
    expect(tokenAdminValido(t, SECRETO, T0.getTime() + ADMIN_SEGUNDOS * 1000)).toBe(false);
    expect(ADMIN_SEGUNDOS).toBe(8 * 3600);
  });

  it('rechaza manipuladas, de otro secreto y mal formadas', () => {
    const t = crearTokenAdmin(SECRETO, T0.getTime());
    const [cuerpo, firma] = t.split('.');
    const falso = Buffer.from(JSON.stringify({ a: 1, e: Math.floor(T0.getTime() / 1000) + 999999 })).toString('base64url');
    expect(tokenAdminValido(falso + '.' + firma, SECRETO, T0.getTime())).toBe(false);
    expect(tokenAdminValido(cuerpo + '.' + firma.slice(0, -2) + 'AA', SECRETO, T0.getTime())).toBe(false);
    expect(tokenAdminValido(t, 'otro-secreto-distinto-de-32-caracteres-xx', T0.getTime())).toBe(false);
    for (const malo of ['', 'abc', 'a.b.c', undefined, null]) expect(tokenAdminValido(malo as string, SECRETO, T0.getTime())).toBe(false);
  });

  it('la cookie de contratista NO sirve como admin (otro propósito)', () => {
    const deContratista = crearToken(1, SECRETO, T0.getTime());
    expect(tokenAdminValido(deContratista, SECRETO, T0.getTime())).toBe(false);
  });

  it('sin sesión de admin -> 401', () => {
    expect(() => exigirTokenAdmin(undefined)).toThrowError(/administración/);
    try {
      exigirTokenAdmin('basura');
    } catch (e) {
      expect((e as ErrorAmable).estado).toBe(401);
    }
    expect(() => exigirTokenAdmin(crearTokenAdmin())).not.toThrow();
  });
});

describe('login de admin', () => {
  it('contraseña correcta entra', async () => {
    await expect(verificarAdmin(db, CLAVE, T0)).resolves.toBeUndefined();
  });

  it('contraseña incorrecta o vacía falla con mensaje amable', async () => {
    const e1 = await error(verificarAdmin(db, 'otra-clave', T0));
    expect(e1.estado).toBe(401);
    expect(e1.message).toMatch(/contraseña no es correcta/);
    expect((await error(verificarAdmin(db, '', T0))).estado).toBe(400);
    expect((await error(verificarAdmin(db, undefined, T0))).estado).toBe(400);
    expect((await error(verificarAdmin(db, 12345, T0))).estado).toBe(400);
  });

  it('5 fallos en 10 min bloquean 10 min, incluso con la clave correcta', async () => {
    for (let i = 0; i < MAX_FALLOS_ADMIN; i++) await error(verificarAdmin(db, 'mala', mas(i * 1000)));
    const [fila] = await db.select().from(intentosPin);
    expect(fila.clave).toBe(CLAVE_INTENTOS_ADMIN);
    const e = await error(verificarAdmin(db, CLAVE, mas(10_000)));
    expect(e.estado).toBe(429);
    expect(e.message).toMatch(/10 minutos/);
    // pasado el bloqueo vuelve a entrar y se limpia el contador
    await expect(verificarAdmin(db, CLAVE, mas(5_000 + VENTANA_ADMIN_MS + 1000))).resolves.toBeUndefined();
    expect(await db.select().from(intentosPin)).toHaveLength(0);
  });

  it('un acierto limpia los fallos anteriores', async () => {
    for (let i = 0; i < 3; i++) await error(verificarAdmin(db, 'mala', mas(i * 1000)));
    await verificarAdmin(db, CLAVE, mas(5000));
    expect(await db.select().from(intentosPin)).toHaveLength(0);
    for (let i = 0; i < 3; i++) await error(verificarAdmin(db, 'mala', mas(6000 + i * 1000)));
    await expect(verificarAdmin(db, CLAVE, mas(10_000))).resolves.toBeUndefined();
  });

  it('sin ADMIN_PASSWORD siempre falla con un mensaje claro y no cuenta intentos', async () => {
    delete process.env.ADMIN_PASSWORD;
    const e = await error(verificarAdmin(db, 'lo-que-sea', T0));
    expect(e.estado).toBe(503);
    expect(e.message).toMatch(/ADMIN_PASSWORD/);
    process.env.ADMIN_PASSWORD = '';
    expect((await error(verificarAdmin(db, '', T0))).estado).toBe(503);
    expect(await db.select().from(intentosPin)).toHaveLength(0);
  });
});

describe('GET /api/factura/[id]: acepta la cookie admin', () => {
  it('accesoFactura: admin -> sin filtro; contratista -> su id; nada -> 401', () => {
    expect(accesoFactura(undefined, crearTokenAdmin())).toBeUndefined();
    expect(accesoFactura(crearToken(7), undefined)).toBe(7);
    expect(accesoFactura(crearToken(7), 'cookie-admin-mala')).toBe(7);
    expect(() => accesoFactura(undefined, undefined)).toThrowError(/sesión venció/);
    expect(() => accesoFactura('mala', 'mala')).toThrowError(/sesión venció/);
    // la cookie de contratista puesta como cookie admin no abre el modo admin
    expect(() => accesoFactura(undefined, crearToken(7))).toThrowError(/sesión venció/);
  });

  it('con admin se baja la factura de cualquiera; con sesión de otra contratista, no', async () => {
    const deps = crearDeps(db, new BlobFalso());
    const dueña = await crearContratista(db);
    const otra = await crearContratista(db, { nombre: 'OTRA PRUEBA', cedula: '1000001111' });
    const cargaId = await crearCarga(db, dueña, '2026-08');

    const sinFiltro = accesoFactura(undefined, crearTokenAdmin());
    const { datos } = await datosFactura(deps, cargaId, sinFiltro);
    expect(datos.docNum).toBe('202608');

    const filtroOtra = accesoFactura(crearToken(otra), undefined);
    await expect(datosFactura(deps, cargaId, filtroOtra)).rejects.toMatchObject({ estado: 404 });
    const filtroDueña = accesoFactura(crearToken(dueña), undefined);
    await expect(datosFactura(deps, cargaId, filtroDueña)).resolves.toBeTruthy();
  });
});
