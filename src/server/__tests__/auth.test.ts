import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_FALLOS_PIN,
  SESION_SEGUNDOS,
  VENTANA_PIN_MS,
  crearToken,
  igualesSeguro,
  leerToken,
  ultimos4,
  verificarLogin,
} from '../auth';
import type { Db } from '../db';
import { ErrorAmable } from '../errores';
import { crearBase, crearContratista, vaciar } from './helpers';

const SECRETO = 'un-secreto-de-prueba-de-al-menos-32-caracteres!!';
const T0 = new Date('2026-09-15T17:00:00Z');
const mas = (ms: number) => new Date(T0.getTime() + ms);

describe('sesión firmada', () => {
  it('ida y vuelta, y vence a las 2 h', () => {
    const token = crearToken(7, SECRETO, T0.getTime());
    expect(leerToken(token, SECRETO, T0.getTime() + 1000)).toBe(7);
    expect(leerToken(token, SECRETO, T0.getTime() + (SESION_SEGUNDOS - 1) * 1000)).toBe(7);
    expect(leerToken(token, SECRETO, T0.getTime() + SESION_SEGUNDOS * 1000)).toBeNull();
  });

  it('rechaza cookies manipuladas, de otro secreto o mal formadas', () => {
    const token = crearToken(7, SECRETO, T0.getTime());
    const [cuerpo, firma] = token.split('.');
    const falso = Buffer.from(JSON.stringify({ c: 8, e: Math.floor(T0.getTime() / 1000) + 99999 })).toString('base64url');
    expect(leerToken(falso + '.' + firma, SECRETO, T0.getTime())).toBeNull();
    expect(leerToken(cuerpo + '.' + firma.slice(0, -2) + 'AA', SECRETO, T0.getTime())).toBeNull();
    expect(leerToken(token, 'otro-secreto-distinto-de-32-caracteres-xx', T0.getTime())).toBeNull();
    for (const malo of ['', 'abc', 'a.b.c', undefined, null]) expect(leerToken(malo as string, SECRETO, T0.getTime())).toBeNull();
  });

  it('SESSION_SECRET corto o ausente es un error de configuración', () => {
    const guardado = process.env.SESSION_SECRET;
    try {
      delete process.env.SESSION_SECRET;
      expect(() => crearToken(1)).toThrow();
      process.env.SESSION_SECRET = 'corto';
      expect(() => crearToken(1)).toThrow();
      process.env.SESSION_SECRET = SECRETO;
      expect(leerToken(crearToken(5))).toBe(5);
    } finally {
      if (guardado === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = guardado;
    }
  });

  it('igualesSeguro y ultimos4', () => {
    expect(igualesSeguro('0879', '0879')).toBe(true);
    expect(igualesSeguro('0879', '0878')).toBe(false);
    expect(igualesSeguro('0879', '08790')).toBe(false);
    expect(ultimos4('1.000.000.879')).toBe('0879');
    expect(ultimos4(null)).toBe('');
  });
});

describe('login con PIN y bloqueo', () => {
  let db: Db;
  beforeAll(async () => {
    db = await crearBase();
  });
  beforeEach(async () => {
    await vaciar(db);
    await crearContratista(db);
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

  it('entra con el PIN correcto; el nombre no distingue tildes ni mayúsculas', async () => {
    const c = await verificarLogin(db, 'prueba perez', '0879', T0);
    expect(c.nombre).toBe('PRUEBA PÉREZ');
    expect((await verificarLogin(db, '  PRUEBA   PÉREZ ', '0879', T0)).id).toBe(c.id);
  });

  it('PIN malo, nombre inexistente y datos incompletos', async () => {
    const e1 = await error(verificarLogin(db, 'PRUEBA PÉREZ', '1111', T0));
    expect(e1.estado).toBe(401);
    expect(e1.message).toMatch(/no son correctos/);
    expect((await error(verificarLogin(db, 'NADIE', '0879', T0))).estado).toBe(401);
    expect((await error(verificarLogin(db, '', '0879', T0))).estado).toBe(400);
    expect((await error(verificarLogin(db, 'PRUEBA PÉREZ', '87', T0))).estado).toBe(400);
    expect((await error(verificarLogin(db, 'PRUEBA PÉREZ', 'abcd', T0))).estado).toBe(400);
  });

  it('una contratista inactiva no puede entrar', async () => {
    await vaciar(db);
    await crearContratista(db, { activo: false });
    expect((await error(verificarLogin(db, 'PRUEBA PÉREZ', '0879', T0))).estado).toBe(401);
  });

  it('5 fallos bloquean 10 min, incluso con el PIN correcto', async () => {
    for (let i = 0; i < MAX_FALLOS_PIN; i++) await error(verificarLogin(db, 'PRUEBA PÉREZ', '0000', mas(i * 1000)));
    const e = await error(verificarLogin(db, 'PRUEBA PÉREZ', '0879', mas(10_000)));
    expect(e.estado).toBe(429);
    expect(e.message).toMatch(/10 minutos/);
    // el bloqueo se aplica por nombre normalizado
    expect((await error(verificarLogin(db, 'prueba perez', '0879', mas(11_000)))).estado).toBe(429);
    // pasados 10 min del último fallo, vuelve a entrar
    const c = await verificarLogin(db, 'PRUEBA PÉREZ', '0879', mas(4000 + VENTANA_PIN_MS + 1));
    expect(c.nombre).toBe('PRUEBA PÉREZ');
  });

  it('4 fallos + acierto limpia el contador', async () => {
    for (let i = 0; i < 4; i++) await error(verificarLogin(db, 'PRUEBA PÉREZ', '0000', mas(i * 1000)));
    await verificarLogin(db, 'PRUEBA PÉREZ', '0879', mas(5000));
    for (let i = 0; i < 4; i++) await error(verificarLogin(db, 'PRUEBA PÉREZ', '0000', mas(6000 + i * 1000)));
    // sigue sin bloquear porque el acierto reinició la cuenta
    expect((await verificarLogin(db, 'PRUEBA PÉREZ', '0879', mas(11_000))).nombre).toBe('PRUEBA PÉREZ');
  });

  it('los fallos de hace más de 10 min ya no cuentan', async () => {
    for (let i = 0; i < 4; i++) await error(verificarLogin(db, 'PRUEBA PÉREZ', '0000', mas(i * 1000)));
    const tarde = mas(3000 + VENTANA_PIN_MS + 1000);
    await error(verificarLogin(db, 'PRUEBA PÉREZ', '0000', tarde)); // cuenta como el fallo 1, no el 5
    expect((await verificarLogin(db, 'PRUEBA PÉREZ', '0879', new Date(tarde.getTime() + 1000))).nombre).toBe('PRUEBA PÉREZ');
  });
});
