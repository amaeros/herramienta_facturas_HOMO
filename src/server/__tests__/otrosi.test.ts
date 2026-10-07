// Otrosí (prórroga + adición): el supervisor edita el contrato (nuevo fin y nuevo valor total).
// Las cuentas ya enviadas no cambian. TODOS los datos son inventados.
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actualizarContrato } from '../admin';
import type { Db } from '../db';
import { cargas, contratos } from '../db/schema';
import { datosFactura, enviar, leerPlanilla, recalcularAcumulados, resumenDeSesion, type Deps } from '../servicios';
import { BlobFalso, bytesPdf, crearBase, crearCarga, crearContratista, crearDeps, textoPlanilla, vaciar } from './helpers';

let db: Db;
let deps: Deps;
let id: number;

const HONORARIO = 4009000;
const TOTAL_INICIAL = HONORARIO * 9; // 36.081.000 (ene-sep)
const TOTAL_OTROSI = HONORARIO * 11; // 44.099.000 (ene-nov)

beforeAll(async () => {
  db = await crearBase();
});

beforeEach(async () => {
  await vaciar(db);
  deps = crearDeps(db, new BlobFalso());
  id = await crearContratista(db, { valorTotal: TOTAL_INICIAL });
});

async function enviarMes(mes: string, numero = '1234567890') {
  const datos = { numero, periodo: mes, salud: 218900, pension: 280200, arl: 42700 };
  const l = await leerPlanilla(deps, id, {
    archivo: { bytes: bytesPdf(mes + numero), nombre: 'Planilla.pdf' },
    texto: textoPlanilla({ ...datos }),
    mes,
  });
  return enviar(deps, id, { mes, datos, tempId: l.tempId });
}

async function cargaDe(mes: string) {
  const [f] = await db.select().from(cargas).where(eq(cargas.mes, mes));
  return f;
}

/** Otrosí: prórroga hasta el 30 de noviembre + adición (valor total nuevo). El inicio no cambia. */
async function hacerOtrosi(extra: Record<string, unknown> = {}) {
  await actualizarContrato(deps, id, { fin: '2026-11-30', valorTotal: TOTAL_OTROSI, ...extra });
}

describe('otrosí: prórroga + adición del mismo contrato', () => {
  it('las cuentas de agosto y septiembre conservan su acumulado y su factura muestra el contrato viejo', async () => {
    await enviarMes('2026-08');
    await enviarMes('2026-09');
    const ago = await cargaDe('2026-08');
    const sep = await cargaDe('2026-09');
    expect(ago.acumulado).toBe(HONORARIO * 8);
    expect(sep.acumulado).toBe(TOTAL_INICIAL);

    await hacerOtrosi({ objeto: 'Objeto nuevo del otrosí.', numeroContrato: '2026CPS999-OTROSI' });

    const ago2 = await cargaDe('2026-08');
    const sep2 = await cargaDe('2026-09');
    expect(ago2.acumulado).toBe(ago.acumulado);
    expect(sep2.acumulado).toBe(sep.acumulado);
    // el % guardado sí sigue el valor total vigente (acumulado / valor total)
    expect(sep2.pct).toBeCloseTo(TOTAL_INICIAL / TOTAL_OTROSI, 10);

    // las facturas ya enviadas siguen mostrando el contrato de ese momento
    for (const c of [ago2, sep2]) {
      const { datos } = await datosFactura(deps, c.id, id);
      expect(datos.valorTotalContrato).toBe(TOTAL_INICIAL);
      expect(datos.numeroContrato).toBe('2026CPS999');
      expect(datos.objeto).toBe('Objeto ficticio de prueba.');
      expect(c.contratoSnapshot).toMatchObject({ inicio: '2026-01-01', fin: '2026-09-30', valorTotal: TOTAL_INICIAL, honorario: HONORARIO, riesgo: 'III' });
    }
    expect((await datosFactura(deps, sep2.id, id)).datos.acumulado).toBe(TOTAL_INICIAL);
  });

  it('octubre sigue sumando desde el inicio del contrato y el % es sobre el valor total nuevo', async () => {
    await enviarMes('2026-09');
    await hacerOtrosi();
    await enviarMes('2026-10', '1234567891');
    const oct = await cargaDe('2026-10');
    expect(oct.valor).toBe(HONORARIO);
    // ene-sep + oct = 10 meses (los meses sin carga cuentan con su valor esperado)
    expect(oct.acumulado).toBe(HONORARIO * 10);
    expect(oct.pct).toBeCloseTo(10 / 11, 10);
    const { datos } = await datosFactura(deps, oct.id, id);
    expect(datos.valorTotalContrato).toBe(TOTAL_OTROSI);
    expect(datos.acumulado).toBe(HONORARIO * 10);
    expect(oct.contratoSnapshot).toMatchObject({ inicio: '2026-01-01', fin: '2026-11-30', valorTotal: TOTAL_OTROSI });
  });

  it('reenviar octubre refresca la foto del contrato', async () => {
    await hacerOtrosi();
    await enviarMes('2026-10', '1234567891');
    const antes = await cargaDe('2026-10');
    expect(antes.contratoSnapshot?.objeto).toBe('Objeto ficticio de prueba.');
    await actualizarContrato(deps, id, { objeto: 'Objeto corregido.', cargo: 'Cargo nuevo' });
    // sin reenviar, la foto no cambia
    expect((await datosFactura(deps, antes.id, id)).datos.objeto).toBe('Objeto ficticio de prueba.');
    await enviarMes('2026-10', '1234567892');
    const despues = await cargaDe('2026-10');
    expect(despues.id).toBe(antes.id);
    expect(despues.contratoSnapshot).toMatchObject({ objeto: 'Objeto corregido.', cargo: 'Cargo nuevo' });
    const { datos } = await datosFactura(deps, despues.id, id);
    expect(datos.objeto).toBe('Objeto corregido.');
    expect(datos.cargo).toBe('Cargo nuevo');
  });

  it('el resumen de la contratista muestra los meses nuevos de la prórroga', async () => {
    await enviarMes('2026-09');
    await hacerOtrosi();
    const r = await resumenDeSesion(deps, id);
    expect(r.meses.map((m) => m.key).slice(-2)).toEqual(['2026-10', '2026-11']);
    expect(r.fin).toBe('2026-11-30');
    expect(r.meses.find((m) => m.key === '2026-09')?.enviado).toBeTruthy();
  });
});

describe('cargas viejas y recálculo acotado', () => {
  it('una carga vieja sin foto sigue generando la factura con el contrato actual', async () => {
    const cid = await crearCarga(db, id, '2026-09');
    expect((await cargaDe('2026-09')).contratoSnapshot).toBeNull();
    await db.update(contratos).set({ numeroContrato: '2026CPS999-B' }).where(eq(contratos.id, id));
    const { datos } = await datosFactura(deps, cid, id);
    expect(datos.numeroContrato).toBe('2026CPS999-B');
    expect(datos.valorTotalContrato).toBe(TOTAL_INICIAL);
    expect(datos.nombre).toBe('PRUEBA PÉREZ');
  });

  it('si el inicio se mueve hacia adelante, las cargas de meses anteriores no se tocan', async () => {
    await crearCarga(db, id, '2026-09', { acumulado: 123, pct: 0.5 });
    await crearCarga(db, id, '2026-10', { acumulado: 1, pct: 0 });
    const [c] = await db
      .update(contratos)
      .set({ inicio: '2026-10-01', fin: '2026-12-30', valorTotal: HONORARIO * 3 })
      .where(eq(contratos.id, id))
      .returning();
    await recalcularAcumulados(db, c);
    const sep = await cargaDe('2026-09');
    expect(sep.acumulado).toBe(123);
    expect(sep.pct).toBe(0.5);
    const oct = await cargaDe('2026-10');
    expect(oct.acumulado).toBe(HONORARIO);
    expect(oct.pct).toBeCloseTo(1 / 3, 10);
  });
});
