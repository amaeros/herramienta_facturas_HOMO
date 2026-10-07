// Cambios guiados del supervisor: cambio en lote de fechas, y la diferencia entre otrosí y contrato nuevo.
// TODOS los datos son inventados.
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_LOTE, actualizarContrato, actualizarLote } from '../admin';
import { listarCambios } from '../cambios';
import type { Db } from '../db';
import { cargas, contratos } from '../db/schema';
import { ErrorValidacion } from '../errores';
import { datosFactura, enviar, leerPlanilla, resumenDeSesion, type Deps } from '../servicios';
import { BlobFalso, bytesPdf, crearBase, crearCarga, crearContratista, crearDeps, textoPlanilla, vaciar } from './helpers';

let db: Db;
let deps: Deps;

beforeAll(async () => {
  db = await crearBase();
});

beforeEach(async () => {
  await vaciar(db);
  deps = crearDeps(db, new BlobFalso());
});

async function validacion(p: Promise<unknown>): Promise<ErrorValidacion> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorValidacion);
    return e as ErrorValidacion;
  }
  throw new Error('debía fallar');
}

const campo = async (id: number) => (await db.select().from(contratos).where(eq(contratos.id, id)))[0];

// =================================================================== cambio en lote
describe('cambio en lote (fecha de fin y/o de inicio)', () => {
  async function dos() {
    const a = await crearContratista(db, { nombre: 'Lote Prueba Uno', cedula: '1000001001' });
    const b = await crearContratista(db, { nombre: 'Lote Prueba Dos', cedula: '1000001002' });
    return [a, b] as const;
  }

  it('aplica la fecha de fin a todas, anota la bitácora de cada una y recalcula el % guardado', async () => {
    const [a, b] = await dos();
    await crearCarga(db, a, '2026-09', { acumulado: 36081000, pct: 1 });
    const r = await actualizarLote(deps, { ids: [a, b], fin: '2026-11-30' });
    expect(r).toMatchObject({ aplicadas: 2, fallidas: 0 });
    expect(r.resultados).toEqual([
      { id: a, nombre: 'Lote Prueba Uno', ok: true },
      { id: b, nombre: 'Lote Prueba Dos', ok: true },
    ]);
    expect((await campo(a)).fin).toBe('2026-11-30');
    expect((await campo(b)).fin).toBe('2026-11-30');
    expect((await campo(b)).inicio).toBe('2026-01-01'); // lo demás no se toca
    for (const id of [a, b]) {
      const [cambio] = await listarCambios(db, id);
      expect(cambio).toMatchObject({ autor: 'admin', campo: 'fin', antes: '30/09/2026', despues: '30/11/2026' });
    }
    // recálculo: el valor total no cambió, así que el acumulado de septiembre es el mismo, pero se recalculó con la vigencia nueva
    const [c] = await db.select().from(cargas).where(eq(cargas.contratoId, a));
    expect(c.acumulado).toBe(4009000 * 9);
    expect(c.pct).toBeCloseTo(1, 10);
  });

  it('cambia el inicio y el fin juntos', async () => {
    const [a] = await dos();
    const r = await actualizarLote(deps, { ids: [a], inicio: '2026-02-01', fin: '2026-12-30' });
    expect(r.aplicadas).toBe(1);
    expect(await campo(a)).toMatchObject({ inicio: '2026-02-01', fin: '2026-12-30' });
    expect((await listarCambios(db, a)).map((x) => x.campo).sort()).toEqual(['fin', 'inicio']);
  });

  it('si una falla, las demás se aplican y el resultado dice cuál y por qué', async () => {
    const a = await crearContratista(db, { nombre: 'Lote Prueba Uno', cedula: '1000001001', inicio: '2026-01-01' });
    const b = await crearContratista(db, { nombre: 'Lote Prueba Dos', cedula: '1000001002', inicio: '2026-07-16', fin: '2026-12-30' });
    const r = await actualizarLote(deps, { ids: [a, b], fin: '2026-07-01' });
    expect(r.aplicadas).toBe(1);
    expect(r.fallidas).toBe(1);
    expect(r.resultados[0]).toMatchObject({ id: a, ok: true });
    expect(r.resultados[1]).toMatchObject({ id: b, nombre: 'Lote Prueba Dos', ok: false });
    expect(r.resultados[1].error).toMatch(/fecha de fin no puede ser antes/);
    expect((await campo(a)).fin).toBe('2026-07-01');
    expect((await campo(b)).fin).toBe('2026-12-30'); // la que falló no cambió
    expect(await listarCambios(db, b)).toHaveLength(0);
  });

  it('un id que no existe o es una solicitud pendiente sale como fallo, sin romper el resto', async () => {
    const [a] = await dos();
    const [p] = await db.insert(contratos).values({ nombre: 'Pendiente Prueba', cedula: '1000009999', estado: 'pendiente', activo: false }).returning();
    const r = await actualizarLote(deps, { ids: [a, 999999, p.id], fin: '2026-10-30' });
    expect(r.aplicadas).toBe(1);
    expect(r.resultados[1]).toMatchObject({ id: 999999, ok: false, error: 'No encontramos a esa trabajadora.' });
    expect(r.resultados[2]).toMatchObject({ id: p.id, ok: false });
    expect((await campo(p.id)).fin).toBeNull();
  });

  it('repite ids sin aplicar dos veces', async () => {
    const [a] = await dos();
    const r = await actualizarLote(deps, { ids: [a, a, a], fin: '2026-10-30' });
    expect(r.resultados).toHaveLength(1);
    expect(await listarCambios(db, a)).toHaveLength(1);
  });

  it('validaciones: ids, fechas y que venga al menos una fecha', async () => {
    const [a] = await dos();
    expect((await validacion(actualizarLote(deps, { fin: '2026-10-30' }))).campos.ids).toMatch(/al menos una/);
    expect((await validacion(actualizarLote(deps, { ids: [], fin: '2026-10-30' }))).campos.ids).toMatch(/al menos una/);
    expect((await validacion(actualizarLote(deps, { ids: ['1'], fin: '2026-10-30' }))).campos.ids).toBeTruthy();
    expect((await validacion(actualizarLote(deps, { ids: [1.5], fin: '2026-10-30' }))).campos.ids).toBeTruthy();
    expect((await validacion(actualizarLote(deps, { ids: Array.from({ length: MAX_LOTE + 1 }, (_, i) => i + 1), fin: '2026-10-30' }))).campos.ids).toMatch(/hasta/);
    expect((await validacion(actualizarLote(deps, { ids: [a], fin: '30/10/2026' }))).campos.fin).toMatch(/AAAA-MM-DD/);
    expect((await validacion(actualizarLote(deps, { ids: [a], inicio: 'mañana' }))).campos.inicio).toMatch(/AAAA-MM-DD/);
    expect((await validacion(actualizarLote(deps, { ids: [a] }))).campos.fin).toMatch(/fecha de fin, la de inicio o las dos/);
    expect((await validacion(actualizarLote(deps, { ids: [a], fin: '', inicio: '' }))).campos.fin).toMatch(/fecha de fin, la de inicio o las dos/);
    expect((await validacion(actualizarLote(deps, { ids: [a], inicio: '2026-10-01', fin: '2026-09-01' }))).campos.fin).toMatch(/antes de la fecha de inicio/);
    // nada se tocó
    expect((await campo(a)).fin).toBe('2026-09-30');
    expect(await listarCambios(db, a)).toHaveLength(0);
  });

  it('solo mira inicio y fin: cualquier otro campo del cuerpo se ignora', async () => {
    const [a] = await dos();
    await actualizarLote(deps, { ids: [a], fin: '2026-10-30', honorario: 1, nombre: 'Otro Nombre', activo: false });
    expect(await campo(a)).toMatchObject({ fin: '2026-10-30', honorario: 4009000, nombre: 'Lote Prueba Uno', activo: true });
  });
});

// =================================================================== otrosí vs contrato nuevo
describe('otrosí y contrato nuevo (el mismo cambio del panel, distinto efecto en el acumulado)', () => {
  const HONORARIO = 4009000;
  let id: number;

  async function enviarMes(mes: string, numero = '1234567890') {
    const datos = { numero, periodo: mes, salud: 218900, pension: 280200, arl: 42700 };
    const l = await leerPlanilla(deps, id, { archivo: { bytes: bytesPdf(mes + numero), nombre: 'Planilla.pdf' }, texto: textoPlanilla({ ...datos }), mes });
    return enviar(deps, id, { mes, datos, tempId: l.tempId });
  }
  const cargaDe = async (mes: string) => (await db.select().from(cargas).where(eq(cargas.mes, mes)))[0];

  beforeEach(async () => {
    id = await crearContratista(db, { valorTotal: HONORARIO * 9 }); // ene-sep
    await enviarMes('2026-08');
    await enviarMes('2026-09');
  });

  it('otrosí: nueva fecha de fin y nuevo valor total; octubre sigue sumando desde el inicio del contrato', async () => {
    await actualizarContrato(deps, id, { fin: '2026-11-30', valorTotal: HONORARIO * 11 });
    await enviarMes('2026-10', '1234567891');
    const oct = await cargaDe('2026-10');
    expect(oct.acumulado).toBe(HONORARIO * 10);
    expect(oct.pct).toBeCloseTo(10 / 11, 10);
    expect((await campo(id)).inicio).toBe('2026-01-01');
    expect((await resumenDeSesion(deps, id)).meses).toHaveLength(11);
    const campos = (await listarCambios(db, id)).map((x) => x.campo).sort();
    expect(campos).toEqual(['fin', 'valorTotal']);
  });

  it('contrato nuevo: el acumulado arranca de cero en la nueva fecha de inicio y las cuentas viejas no cambian', async () => {
    const ago = await cargaDe('2026-08');
    const sep = await cargaDe('2026-09');
    expect(sep.acumulado).toBe(HONORARIO * 9);

    await actualizarContrato(deps, id, {
      numeroContrato: '2026CPS999-B',
      inicio: '2026-10-01',
      fin: '2026-12-30',
      honorario: HONORARIO,
      valorTotal: HONORARIO * 3,
      objeto: 'Objeto del contrato nuevo.',
    });

    // las cuentas ya enviadas: mismo acumulado, mismo %, misma foto del contrato y la misma factura
    for (const antes of [ago, sep]) {
      const despues = await cargaDe(antes.mes);
      expect(despues.acumulado).toBe(antes.acumulado);
      expect(despues.pct).toBe(antes.pct);
      expect(despues.contratoSnapshot).toEqual(antes.contratoSnapshot);
      expect(despues.contratoSnapshot).toMatchObject({ numeroContrato: '2026CPS999', inicio: '2026-01-01', fin: '2026-09-30' });
      const { datos } = await datosFactura(deps, despues.id, id);
      expect(datos.numeroContrato).toBe('2026CPS999');
      expect(datos.valorTotalContrato).toBe(HONORARIO * 9);
      expect(datos.objeto).toBe('Objeto ficticio de prueba.');
    }

    // octubre ya es del contrato nuevo: acumulado desde cero y % sobre el valor total nuevo
    await enviarMes('2026-10', '1234567891');
    const oct = await cargaDe('2026-10');
    expect(oct.acumulado).toBe(HONORARIO);
    expect(oct.pct).toBeCloseTo(1 / 3, 10);
    expect(oct.contratoSnapshot).toMatchObject({ numeroContrato: '2026CPS999-B', inicio: '2026-10-01', fin: '2026-12-30', valorTotal: HONORARIO * 3 });
    const { datos } = await datosFactura(deps, oct.id, id);
    expect(datos.objeto).toBe('Objeto del contrato nuevo.');
    expect(datos.acumulado).toBe(HONORARIO);

    // noviembre sigue sumando dentro del contrato nuevo
    await enviarMes('2026-11', '1234567892');
    expect((await cargaDe('2026-11')).acumulado).toBe(HONORARIO * 2);

    // la contratista ve solo los meses del contrato nuevo
    expect((await resumenDeSesion(deps, id)).meses.map((m) => m.key)).toEqual(['2026-10', '2026-11', '2026-12']);
    // y las cuentas viejas siguen intactas después de enviar más
    expect((await cargaDe('2026-09')).acumulado).toBe(HONORARIO * 9);

    const campos = (await listarCambios(db, id)).map((x) => x.campo);
    expect(campos).toEqual(expect.arrayContaining(['numeroContrato', 'inicio', 'fin', 'valorTotal', 'objeto']));
  });

  it('contrato nuevo con el fin antes del inicio no se guarda', async () => {
    const e = await validacion(actualizarContrato(deps, id, { inicio: '2026-12-01', fin: '2026-10-30' }));
    expect(e.campos.fin).toMatch(/antes de la fecha de inicio/);
    expect((await campo(id)).inicio).toBe('2026-01-01');
  });
});
