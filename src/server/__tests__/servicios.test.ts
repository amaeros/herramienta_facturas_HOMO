import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generarFacturaXlsx } from '../../lib/factura';
import type { Db } from '../db';
import { cargas, contratos, lecturas } from '../db/schema';
import { asegurarParametros } from '../db/seed';
import { ErrorAmable } from '../errores';
import { contentDispositionAdjunto } from '../http';
import {
  datosFactura,
  enviar,
  evaluar,
  leerPlanilla,
  listarContratistas,
  login,
  resumen,
  resumenDeSesion,
  cargarParametros,
  type Deps,
} from '../servicios';
import { AHORA, BlobFalso, bytesPdf, crearBase, crearContratista, crearDeps, textoPlanilla, vaciar } from './helpers';

let db: Db;
let blob: BlobFalso;
let deps: Deps;
let id: number;

beforeAll(async () => {
  db = await crearBase();
});

beforeEach(async () => {
  await vaciar(db);
  blob = new BlobFalso();
  deps = crearDeps(db, blob);
  id = await crearContratista(db);
});

async function fallo(p: Promise<unknown>): Promise<ErrorAmable> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorAmable);
    return e as ErrorAmable;
  }
  throw new Error('debía fallar');
}

const OK = { numero: '1234567890', periodo: '2026-09', salud: 218900, pension: 280200, arl: 42700 };

/** Sube una planilla sintética (PDF) para `mes` y devuelve la respuesta. */
async function subir(mes: string, o: Parameters<typeof textoPlanilla>[0] = {}, contratoId = id, adicional = false) {
  return leerPlanilla(deps, contratoId, {
    archivo: { bytes: bytesPdf(mes + (o.numero ?? '')), nombre: 'Planilla Sept.pdf' },
    texto: textoPlanilla({ periodo: mes, ...o }),
    mes,
    adicional,
  });
}

async function enviarMes(mes: string, datos: object = { ...OK, periodo: mes }, extra: object = {}, contratoId = id) {
  const l = await subir(mes, { periodo: mes, ...(datos as object) }, contratoId);
  return enviar(deps, contratoId, { mes, datos, tempId: l.tempId, ...extra });
}

describe('parámetros y contratistas', () => {
  it('la migración trae los parámetros por defecto y asegurarParametros es idempotente', async () => {
    const p = await cargarParametros(db);
    expect(p).toMatchObject({ pctIbc: 0.4, salud: 0.125, pension: 0.16, smmlv: 1750905, ibcPisoMult: 1, ibcTechoMult: 25, toleranciaSs: 100 });
    expect(p.arl).toEqual({ I: 0.00522, II: 0.01044, III: 0.02436, IV: 0.0435, V: 0.0696 });
    await asegurarParametros(db);
    await db.delete((await import('../db/schema')).parametros);
    expect((await cargarParametros(db)).smmlv).toBe(1750905); // se repone sola
  });

  it('lista solo nombres de activas, sin tildes en el orden', async () => {
    await crearContratista(db, { nombre: 'ÁNGELA PRUEBA', cedula: '1000000111' });
    await crearContratista(db, { nombre: 'BEATRIZ PRUEBA', cedula: '1000000222', activo: false });
    await crearContratista(db, { nombre: 'ANA PRUEBA', cedula: '1000000333' });
    expect(await listarContratistas(deps)).toEqual(['ANA PRUEBA', 'ÁNGELA PRUEBA', 'PRUEBA PÉREZ']);
  });
});

describe('resumen', () => {
  it('meses de la vigencia con periodo, días y valor; mes por defecto = mes actual', async () => {
    const r = await login(deps, 'prueba perez', '0879');
    expect(r.contratoId).toBe(id);
    const c = r.resumen;
    expect(c).toMatchObject({ nombre: 'PRUEBA PÉREZ', numeroContrato: '2026CPS999', honorario: 4009000, riesgo: 'III', mesDefault: '2026-09' });
    expect(c.meses).toHaveLength(9);
    expect(c.meses[0]).toMatchObject({ key: '2026-01', label: 'Enero 2026', inicio: '2026-01-01', corte: '2026-01-30', dias: 30, valor: 4009000, enviado: '' });
    expect(c.meses[1]).toMatchObject({ key: '2026-02', corte: '2026-02-28', dias: 30 });
    expect(c.meses[8]).toMatchObject({ key: '2026-09', corte: '2026-09-30' });
  });

  it('mes parcial por inicio tardío y mes por defecto fuera de vigencia', async () => {
    const otra = await crearContratista(db, { nombre: 'OTRA PRUEBA', cedula: '1000000123', inicio: '2026-01-16', riesgoNuevo: 'IV', riesgoDesde: '2026-05-01' });
    const [fila] = await db.select().from(contratos).where(eq(contratos.id, otra));
    const futuro = crearDeps(db, blob, () => new Date('2027-03-01T15:00:00Z'));
    const r = await resumen(futuro, fila);
    expect(r.meses[0]).toMatchObject({ key: '2026-01', inicio: '2026-01-16', dias: 15, valor: Math.round((4009000 * 15) / 30) });
    expect(r.mesDefault).toBe('2026-09'); // ya pasó el contrato: el último mes
    expect(r.riesgo).toBe('IV'); // riesgo vigente en el mes por defecto
    const antes = crearDeps(db, blob, () => new Date('2025-12-01T15:00:00Z'));
    expect((await resumen(antes, fila)).mesDefault).toBe('2026-01');
  });

  it('un contrato sin fechas o sin honorario no entra', async () => {
    const o = await crearContratista(db, { nombre: 'SIN FECHAS', cedula: '1000000444', inicio: null });
    expect((await fallo(login(deps, 'SIN FECHAS', '0444'))).message).toMatch(/fechas o el honorario/);
    await db.update(contratos).set({ activo: false }).where(eq(contratos.id, o));
    expect((await fallo(resumenDeSesion(deps, o))).estado).toBe(401); // sesión de un contrato inactivo
  });

  it('el estado enviado aparece después de enviar', async () => {
    await enviarMes('2026-08');
    const r = (await resumenDeSesion(deps, id)).meses;
    expect(r.find((m) => m.key === '2026-08')!.enviado).toBe('✅ OK');
    expect(r.find((m) => m.key === '2026-07')!.enviado).toBe('');
  });
});

describe('evaluar', () => {
  it('SS esperada de 4.009.000 en riesgo III: 218.900 + 280.200 + 42.700', async () => {
    const ev = await evaluar(deps, id, { mes: '2026-09', datos: OK });
    expect(ev.estado).toBe('OK');
    expect(ev.ss).toMatchObject({ salud: 218900, pension: 280200, arl: 42700, total: 541800 });
    expect(ev.bloquea).toBe(false);
  });

  it('cotizó menos: 🔴 pero no bloquea; cotizó más: 🟡; acepta montos escritos con puntos', async () => {
    const menos = await evaluar(deps, id, { mes: '2026-09', datos: { ...OK, salud: '100.000' } });
    expect(menos).toMatchObject({ estado: 'ERROR', bloquea: false });
    const mas = await evaluar(deps, id, { mes: '2026-09', datos: { ...OK, salud: '$ 300.000' } });
    expect(mas).toMatchObject({ estado: 'REVISAR', bloquea: false });
  });

  it('bloquea si falta el n.º de planilla o el mes está fuera de vigencia', async () => {
    expect((await evaluar(deps, id, { mes: '2026-09', datos: { ...OK, numero: '' } })).bloquea).toBe(true);
    expect((await evaluar(deps, id, { mes: '2027-01', datos: OK })).bloquea).toBe(true);
    expect((await fallo(evaluar(deps, id, { mes: 'septiembre', datos: OK }))).message).toMatch(/Escoge el mes/);
  });

  it('días a mano con motivo: 🟡 y valor proporcional', async () => {
    const ev = await evaluar(deps, id, { mes: '2026-09', datos: OK, diasManual: { dias: 15, motivo: 'licencia' } });
    expect(ev).toMatchObject({ estado: 'REVISAR', dias: 15, valor: Math.round((4009000 * 15) / 30), diasManual: true });
  });
});

describe('leerPlanilla', () => {
  it('lee la planilla con el texto del navegador, la guarda privada y evalúa', async () => {
    const r = await subir('2026-09');
    expect(r).toMatchObject({ leyo: true, confianza: 'alta', fuente: 'navegador', tipoDoc: 'planilla' });
    expect(r.lectura).toEqual({ numero: '1234567890', periodo: '2026-09', salud: 218900, pension: 280200, arl: 42700 });
    expect(r.evaluacion).toMatchObject({ estado: 'OK' });
    expect(r.valor).toBeNull();
    const rutas = [...blob.archivos.keys()];
    expect(rutas).toHaveLength(1);
    expect(rutas[0]).toMatch(new RegExp(`^planillas/${id}/2026-09/[0-9a-f-]{36}-Planilla-Sept\\.pdf$`));
    expect(blob.archivos.get(rutas[0])!.contentType).toBe('application/pdf');
    const [l] = await db.select().from(lecturas).where(eq(lecturas.tempId, r.tempId));
    expect(l).toMatchObject({ contratoId: id, archivo: rutas[0], tipo: 'pdf', leyo: true });
  });

  it('sin texto útil (escaneado o foto): no hay OCR, lectura en blanco y fuente "ninguna"', async () => {
    const r = await leerPlanilla(deps, id, { archivo: { bytes: bytesPdf(), nombre: 'scan.pdf' }, texto: 'poco', mes: '2026-09' });
    expect(r).toMatchObject({ leyo: false, fuente: 'ninguna', confianza: 'baja', evaluacion: null });
    expect(r.lectura).toEqual({ numero: '', periodo: '', salud: null, pension: null, arl: null });
    expect(r.notas.join(' ')).toMatch(/No pudimos leer/);
    expect(blob.archivos.size).toBe(1); // el archivo igual queda guardado para el envío manual
  });

  it('confianza baja: lectura en blanco aunque el texto sea largo', async () => {
    const basura = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore '.repeat(4);
    const r = await leerPlanilla(deps, id, { archivo: { bytes: bytesPdf(), nombre: 'x.pdf' }, texto: basura, mes: '2026-09' });
    expect(r).toMatchObject({ leyo: false, confianza: 'baja', fuente: 'navegador', evaluacion: null });
    expect(r.lectura.numero).toBe('');
  });

  it('imágenes: se aceptan por sus primeros bytes y no se usa el texto', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const r = await leerPlanilla(deps, id, { archivo: { bytes: png, nombre: 'foto.PNG' }, texto: textoPlanilla(), mes: '2026-09' });
    expect(r).toMatchObject({ leyo: false, fuente: 'ninguna' });
    expect([...blob.archivos.keys()][0]).toMatch(/\.png$/);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 1]);
    const j = await leerPlanilla(deps, id, { archivo: { bytes: jpg, nombre: 'foto.jpg' }, mes: '2026-09' });
    expect(j.leyo).toBe(false);
    expect(blob.archivos.size).toBe(2);
  });

  it('rechaza archivos de otro tipo (aunque se llamen .pdf), vacíos o de más de 4 MB', async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4]);
    expect((await fallo(leerPlanilla(deps, id, { archivo: { bytes: exe, nombre: 'a.pdf' }, mes: '2026-09' }))).estado).toBe(415);
    expect((await fallo(leerPlanilla(deps, id, { archivo: { bytes: new Uint8Array(), nombre: 'a.pdf' }, mes: '2026-09' }))).message).toMatch(/No recibimos/);
    const grande = new Uint8Array(4 * 1024 * 1024 + 1);
    grande.set([0x25, 0x50, 0x44, 0x46]);
    expect((await fallo(leerPlanilla(deps, id, { archivo: { bytes: grande, nombre: 'a.pdf' }, mes: '2026-09' }))).estado).toBe(413);
    expect(blob.archivos.size).toBe(0);
    expect((await fallo(leerPlanilla(deps, id, { archivo: { bytes: bytesPdf(), nombre: 'a.pdf' }, mes: '' }))).message).toMatch(/Escoge el mes/);
  });

  it('planilla adicional: no se evalúa, propone la suma salud + pensión + ARL', async () => {
    const r = await subir('2026-09', { numero: '9999999999', salud: 1000, pension: 2000, arl: 300 }, id, true);
    expect(r).toMatchObject({ leyo: true, evaluacion: null, valor: 3300 });
  });

  it('las planillas subidas y no enviadas caducan a las 6 h (y se borran sus archivos)', async () => {
    const viejo = await subir('2026-09');
    expect(blob.archivos.size).toBe(1);
    const luego = crearDeps(db, blob, () => new Date(AHORA.getTime() + 7 * 3600 * 1000));
    await leerPlanilla(luego, id, { archivo: { bytes: bytesPdf('otra'), nombre: 'b.pdf' }, texto: '', mes: '2026-09' });
    expect(blob.archivos.size).toBe(1); // la vieja se limpió, la nueva se guardó
    expect(await db.select().from(lecturas).where(eq(lecturas.tempId, viejo.tempId))).toHaveLength(0);
    // y no se puede enviar con una lectura vencida
    const l2 = await subir('2026-08');
    const tarde = crearDeps(db, blob, () => new Date(AHORA.getTime() + 7 * 3600 * 1000));
    expect((await fallo(enviar(tarde, id, { mes: '2026-08', datos: { ...OK, periodo: '2026-08' }, tempId: l2.tempId }))).message).toMatch(/pudo vencerse/);
  });
});

describe('enviar', () => {
  it('guarda la carga completa y devuelve el link de la factura', async () => {
    const r = await enviarMes('2026-09');
    expect(r).toMatchObject({ estado: 'OK', estadoTexto: '✅ OK', emoji: '✅' });
    expect(r.factura.nombre).toBe('202609 - PRUEBA PÉREZ - Cuenta de cobro.xlsx');
    const [g] = await db.select().from(cargas);
    expect(r.factura.url).toBe(`/api/factura/${g.id}`);
    expect(g).toMatchObject({
      contratoId: id, mes: '2026-09', fechaInicio: '2026-09-01', fechaCorte: '2026-09-30', planillaNumero: '1234567890',
      planillaMes: '2026-09', ssDeclarada: 541800, ssEsperada: 541800, docNum: 202609, dias: 30, valor: 4009000,
      acumulado: 36081000, pct: 1, estado: 'OK', lectura: 'auto', aprobado: false, diasManual: null, adicionales: [],
    });
    expect(g.desglose).toMatch(/salud 218\.900 \+ pensión 280\.200 \+ ARL 42\.700 \(riesgo III\)/);
    expect(g.archivoPlanilla).toMatch(/^planillas\//);
    expect(blob.archivos.has(g.archivoPlanilla)).toBe(true);
    expect(await db.select().from(lecturas)).toHaveLength(0); // la lectura se consumió
  });

  it('lectura: auto / corregido / manual', async () => {
    await enviarMes('2026-07');
    const corr = await subir('2026-08');
    await enviar(deps, id, { mes: '2026-08', datos: { ...OK, periodo: '2026-08', salud: 218000 }, tempId: corr.tempId });
    const man = await leerPlanilla(deps, id, { archivo: { bytes: bytesPdf('m'), nombre: 'm.pdf' }, texto: '', mes: '2026-09' });
    await enviar(deps, id, { mes: '2026-09', datos: OK, tempId: man.tempId });
    const filas = await db.select().from(cargas);
    const por = Object.fromEntries(filas.map((f) => [f.mes, f.lectura]));
    expect(por).toEqual({ '2026-07': 'auto', '2026-08': 'corregido', '2026-09': 'manual' });
  });

  it('reenviar el mismo mes REEMPLAZA la fila, borra el aprobado y el archivo anterior', async () => {
    await enviarMes('2026-09');
    const [antes] = await db.select().from(cargas);
    await db.update(cargas).set({ aprobado: true, observacion: 'ok supervisor' }).where(eq(cargas.id, antes.id));
    const l2 = await subir('2026-09', { numero: '5555555555' });
    expect(blob.archivos.size).toBe(2);
    const r2 = await enviar(deps, id, { mes: '2026-09', datos: { ...OK, numero: '5555555555' }, tempId: l2.tempId });
    const filas = await db.select().from(cargas);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: antes.id, planillaNumero: '5555555555', aprobado: false, observacion: 'ok supervisor' });
    expect(r2.factura.url).toBe(`/api/factura/${antes.id}`);
    expect(blob.archivos.has(antes.archivoPlanilla)).toBe(false);
    expect(blob.archivos.has(filas[0].archivoPlanilla)).toBe(true);
    expect(blob.archivos.size).toBe(1);
  });

  it('acumulado y % se recalculan en todas las cargas (dos meses con días a mano)', async () => {
    await enviarMes('2026-09');
    let [sep] = await db.select().from(cargas).where(eq(cargas.mes, '2026-09'));
    expect(sep.acumulado).toBe(9 * 4009000);
    // agosto con 15 días por licencia: el acumulado de septiembre baja
    const r = await enviarMes('2026-08', { ...OK, periodo: '2026-08' }, { diasManual: { dias: 15, motivo: 'licencia no remunerada' } });
    expect(r.estado).toBe('REVISAR');
    const filas = await db.select().from(cargas);
    const ago = filas.find((f) => f.mes === '2026-08')!;
    sep = filas.find((f) => f.mes === '2026-09')!;
    const valorAgo = Math.round((4009000 * 15) / 30);
    expect(ago).toMatchObject({ dias: 15, valor: valorAgo, diasManual: 15, motivoNovedad: 'licencia no remunerada' });
    expect(ago.acumulado).toBe(7 * 4009000 + valorAgo);
    expect(ago.pct).toBeCloseTo((7 * 4009000 + valorAgo) / 36081000, 12);
    expect(sep.acumulado).toBe(8 * 4009000 + valorAgo);
    expect(sep.pct).toBeCloseTo((8 * 4009000 + valorAgo) / 36081000, 12);
  });

  it('el servidor re-evalúa: bloquea si falta un dato obligatorio o el mes está fuera de vigencia', async () => {
    const l = await subir('2026-09');
    const sinNum = await fallo(enviar(deps, id, { mes: '2026-09', datos: { ...OK, numero: '' }, tempId: l.tempId }));
    expect(sinNum.message).toMatch(/Falta el n\.º de la planilla/);
    expect((await fallo(enviar(deps, id, { mes: '2027-02', datos: OK, tempId: l.tempId }))).message).toMatch(/vigencia/);
    expect(await db.select().from(cargas)).toHaveLength(0);
  });

  it('las alertas no bloquean: cotizó menos igual se guarda con 🔴', async () => {
    const r = await enviarMes('2026-09', { ...OK, salud: 100000 });
    expect(r).toMatchObject({ estado: 'ERROR', estadoTexto: '🔴 ERROR', emoji: '🔴' });
    const [g] = await db.select().from(cargas);
    expect(g).toMatchObject({ estado: 'ERROR', ssDeclarada: 100000 + 280200 + 42700, lectura: 'auto' });
  });

  it('exige una planilla subida válida y propia', async () => {
    expect((await fallo(enviar(deps, id, { mes: '2026-09', datos: OK }))).message).toMatch(/No encontramos la planilla/);
    expect((await fallo(enviar(deps, id, { mes: '2026-09', datos: OK, tempId: 'no-es-uuid' }))).message).toMatch(/No encontramos la planilla/);
    const otra = await crearContratista(db, { nombre: 'OTRA PRUEBA', cedula: '1000000123' });
    const ajena = await subir('2026-09', {}, otra);
    expect((await fallo(enviar(deps, id, { mes: '2026-09', datos: OK, tempId: ajena.tempId }))).message).toMatch(/No encontramos la planilla/);
  });

  it('planillas adicionales: se guardan con su archivo (máx. 3); al reenviar sin ellas se borran sus archivos', async () => {
    const a1 = await subir('2026-08', { numero: '7777777771', salud: 1000, pension: 2000, arl: 300 }, id, true);
    const a2 = await subir('2026-07', { numero: '7777777772', salud: 500, pension: 600, arl: 70 }, id, true);
    const l = await subir('2026-09');
    const adicionales = [
      { numero: '7777777771', periodo: '2026-08', valor: '3.300', tempId: a1.tempId },
      { numero: '7777777772', periodo: '2026-07', valor: 1170, tempId: a2.tempId },
    ];
    await enviar(deps, id, { mes: '2026-09', datos: OK, tempId: l.tempId, adicionales });
    const [g] = await db.select().from(cargas);
    expect(g.adicionales).toHaveLength(2);
    expect(g.adicionales[0]).toMatchObject({ numero: '7777777771', mes: '2026-08', valor: 3300 });
    expect(g.adicionales[0].archivo).toMatch(/^planillas\//);
    expect(blob.archivos.size).toBe(3);

    // reenvío sin adicionales: sus archivos se borran
    const l2 = await subir('2026-09', { numero: '1234567899' });
    await enviar(deps, id, { mes: '2026-09', datos: { ...OK, numero: '1234567899' }, tempId: l2.tempId });
    const [g2] = await db.select().from(cargas);
    expect(g2.adicionales).toEqual([]);
    expect(blob.archivos.size).toBe(1);

    // 4 adicionales: bloquea
    const l3 = await subir('2026-09', { numero: '1234567811' });
    const cuatro = [1, 2, 3, 4].map((n) => ({ numero: '888888888' + n, periodo: '2026-08', valor: 1000 }));
    expect((await fallo(enviar(deps, id, { mes: '2026-09', datos: { ...OK, numero: '1234567811' }, tempId: l3.tempId, adicionales: cuatro }))).message).toMatch(/Máximo 3/);
  });

  it('planilla repetida: avisa 🟡 y no bloquea (mismo mes de otra contratista y de otro mes propio)', async () => {
    await enviarMes('2026-08', { ...OK, periodo: '2026-08' }); // usa el n.º 1234567890
    const otra = await crearContratista(db, { nombre: 'OTRA PRUEBA', cedula: '1000000123' });
    const r = await enviarMes('2026-09', OK, {}, otra); // mismo n.º en otra contratista
    expect(r.estado).toBe('REVISAR');
    expect(r.mensaje).toMatch(/planilla n\.º 1234567890 ya se usó para otra cuenta de cobro/);
    // la propia contratista en otro mes
    const propia = await enviarMes('2026-09');
    expect(propia.mensaje).toMatch(/ya se usó en tu cuenta de cobro de Agosto 2026/);
    // evaluar en el mismo mes NO se cuenta contra sí misma
    const ev = await evaluar(deps, id, { mes: '2026-08', datos: { ...OK, periodo: '2026-08' } });
    expect(ev.avisos.join(' ')).toMatch(/otra cuenta de cobro/); // la de la otra contratista sigue contando
  });
});

describe('factura', () => {
  it('datosFactura arma DatosFactura y el .xlsx es válido', async () => {
    const a = await subir('2026-08', { numero: '7777777771', salud: 1000, pension: 2000, arl: 300 }, id, true);
    const l = await subir('2026-09');
    await enviar(deps, id, {
      mes: '2026-09', datos: OK, tempId: l.tempId,
      adicionales: [{ numero: '7777777771', periodo: '2026-08', valor: 3300, tempId: a.tempId }],
    });
    const [g] = await db.select().from(cargas);
    const { datos, contratoId } = await datosFactura(deps, g.id, id);
    expect(contratoId).toBe(id);
    expect(datos).toMatchObject({
      nombre: 'PRUEBA PÉREZ', cedula: '1000000879', numeroContrato: '2026CPS999', valorTotalContrato: 36081000, docNum: '202609',
      fechaInicio: '2026-09-01', fechaCorte: '2026-09-30', valorPeriodo: 4009000, acumulado: 36081000, ssDeclarada: 541800,
      planillaNumero: '1234567890', planillaMes: '2026-09', revisoNombre: 'Revisora de Prueba',
      adicionales: [{ numero: '7777777771', mes: '2026-08', valor: 3300 }],
    });
    const buf = await generarFacturaXlsx(datos);
    expect(buf.subarray(0, 2).toString()).toBe('PK'); // zip = xlsx
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('FACTURA')!;
    expect(ws.getCell('B8').value).toBe('PRUEBA PÉREZ');
    expect(ws.getCell('G22').value).toBe(4009000);
    expect(ws.getCell('B28').value).toBe(541800);
    expect(ws.getCell('G29').value).toBe('7777777771');
  });

  it('una contratista no puede pedir la factura de otra (ni una que no existe)', async () => {
    await enviarMes('2026-09');
    const [g] = await db.select().from(cargas);
    const otra = await crearContratista(db, { nombre: 'OTRA PRUEBA', cedula: '1000000123' });
    expect((await fallo(datosFactura(deps, g.id, otra))).estado).toBe(404);
    expect((await fallo(datosFactura(deps, 99999, id))).estado).toBe(404);
  });

  it('Content-Disposition con filename* para tildes', () => {
    const h = contentDispositionAdjunto('202609 - PRUEBA PÉREZ - Cuenta de cobro.xlsx');
    expect(h).toBe(
      `attachment; filename="202609 - PRUEBA PEREZ - Cuenta de cobro.xlsx"; filename*=UTF-8''202609%20-%20PRUEBA%20P%C3%89REZ%20-%20Cuenta%20de%20cobro.xlsx`,
    );
  });
});
