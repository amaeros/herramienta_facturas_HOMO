import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarCarga,
  actualizarContrato,
  borrarContrato,
  crearContrato,
  guardarParametros,
  leerParametros,
  listarCargas,
  listarContratos,
  mesPorDefecto,
  planillaParaVer,
} from '../admin';
import type { Db } from '../db';
import { cargas, contratos, lecturas, parametros } from '../db/schema';
import { PARAMETROS_POR_DEFECTO } from '../db/seed';
import { ErrorAmable, ErrorValidacion } from '../errores';
import type { Deps } from '../servicios';
import { AHORA, BlobFalso, bytesPdf, crearBase, crearCarga, crearDeps, vaciar } from './helpers';

let db: Db;
let blob: BlobFalso;
let deps: Deps;

beforeAll(async () => {
  db = await crearBase();
});

beforeEach(async () => {
  await vaciar(db);
  await db.update(parametros).set({ ...PARAMETROS_POR_DEFECTO, arl: { ...PARAMETROS_POR_DEFECTO.arl } }).where(eq(parametros.id, 1));
  blob = new BlobFalso();
  deps = crearDeps(db, blob);
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

async function amable(p: Promise<unknown>): Promise<ErrorAmable> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorAmable);
    return e as ErrorAmable;
  }
  throw new Error('debía fallar');
}

const BASE = {
  nombre: 'MARÍA PRUEBA UNO',
  cedula: '1000001111',
  honorario: 4009000,
  valorTotal: 36081000,
  riesgo: 'III',
  inicio: '2026-01-01',
  fin: '2026-09-30',
};

// =================================================================== crear
describe('crear trabajadora', () => {
  it('guarda limpiando cédula con puntos, honorario con $ y nombre con espacios', async () => {
    const c = await crearContrato(deps, {
      ...BASE,
      nombre: '  María Prueba Uno  ',
      cedula: '1.000.001.111',
      honorario: '$ 4.009.000',
      valorTotal: '36081000',
      linea: ' Línea de prueba ',
      correo: 'maria@ejemplo.com',
    });
    expect(c.nombre).toBe('María Prueba Uno');
    expect(c.cedula).toBe('1000001111');
    expect(c.honorario).toBe(4009000);
    expect(c.valorTotal).toBe(36081000);
    expect(c.linea).toBe('Línea de prueba');
    expect(c.activo).toBe(true);
    expect(c.cargas).toBe(0);
    expect(c.riesgoNuevo).toBe('');
    expect(c.riesgoDesde).toBeNull();
  });

  it('acepta alias snake_case, riesgo en número y contrato "por completar" (fechas y montos vacíos)', async () => {
    const c = await crearContrato(deps, { nombre: 'Sin Completar', cedula: '1000002222', riesgo: '3', valor_total: '', numero_contrato: '2026CPS000' });
    expect(c.riesgo).toBe('III');
    expect(c.inicio).toBeNull();
    expect(c.fin).toBeNull();
    expect(c.honorario).toBeNull();
    expect(c.valorTotal).toBeNull();
    expect(c.numeroContrato).toBe('2026CPS000');
  });

  it('riesgo nuevo con fecha del día 1 se guarda; sin riesgo nuevo la fecha se descarta', async () => {
    const a = await crearContrato(deps, { ...BASE, riesgoNuevo: 'IV', riesgoDesde: '2026-06-01' });
    expect(a.riesgoNuevo).toBe('IV');
    expect(a.riesgoDesde).toBe('2026-06-01');
    const b = await crearContrato(deps, { ...BASE, nombre: 'Otra Persona', cedula: '1000003333', riesgoNuevo: '', riesgoDesde: '2026-06-01' });
    expect(b.riesgoDesde).toBeNull();
  });
});

describe('validaciones (mensaje junto al campo)', () => {
  it('nombre obligatorio y único sin tildes / mayúsculas / espacios repetidos', async () => {
    expect((await validacion(crearContrato(deps, { ...BASE, nombre: '   ' }))).campos.nombre).toMatch(/nombre/);
    await crearContrato(deps, BASE);
    for (const repetido of ['maria prueba uno', 'MARÍA   PRUEBA    UNO', ' María Prueba Uno ']) {
      const e = await validacion(crearContrato(deps, { ...BASE, nombre: repetido, cedula: '1000009999' }));
      expect(e.campos.nombre).toMatch(/Ya hay otra trabajadora con ese nombre/);
      expect(e.estado).toBe(400);
    }
  });

  it('cédula obligatoria, solo dígitos 6-10 y única', async () => {
    expect((await validacion(crearContrato(deps, { ...BASE, cedula: '' }))).campos.cedula).toMatch(/cédula/);
    for (const mala of ['12345', '12345678901', '10000A1111', '1000-0011']) {
      expect((await validacion(crearContrato(deps, { ...BASE, cedula: mala }))).campos.cedula).toMatch(/entre 6 y 10/);
    }
    await crearContrato(deps, BASE);
    const e = await validacion(crearContrato(deps, { ...BASE, nombre: 'Otra Distinta', cedula: '1.000.001.111' }));
    expect(e.campos.cedula).toMatch(/misma|esa cédula/);
  });

  it('riesgo, riesgo nuevo y fecha "desde"', async () => {
    expect((await validacion(crearContrato(deps, { ...BASE, riesgo: 'VI' }))).campos.riesgo).toMatch(/I, II, III, IV o V/);
    expect((await validacion(crearContrato(deps, { ...BASE, riesgoNuevo: '9' }))).campos.riesgoNuevo).toMatch(/riesgo nuevo/);
    expect((await validacion(crearContrato(deps, { ...BASE, riesgoNuevo: 'IV' }))).campos.riesgoDesde).toMatch(/desde cuándo/);
    expect((await validacion(crearContrato(deps, { ...BASE, riesgoNuevo: 'IV', riesgoDesde: '2026-06-15' }))).campos.riesgoDesde).toMatch(/día 1/);
    expect((await validacion(crearContrato(deps, { ...BASE, riesgoNuevo: 'IV', riesgoDesde: 'junio' }))).campos.riesgoDesde).toMatch(/no es válida/);
  });

  it('fechas válidas y fin >= inicio', async () => {
    expect((await validacion(crearContrato(deps, { ...BASE, inicio: '2026-02-30' }))).campos.inicio).toMatch(/inicio/);
    expect((await validacion(crearContrato(deps, { ...BASE, fin: '30/09/2026' }))).campos.fin).toMatch(/fin/);
    expect((await validacion(crearContrato(deps, { ...BASE, inicio: '2026-09-30', fin: '2026-01-01' }))).campos.fin).toMatch(/antes/);
    // fin == inicio sí se permite
    await expect(crearContrato(deps, { ...BASE, inicio: '2026-03-01', fin: '2026-03-01' })).resolves.toBeTruthy();
  });

  it('honorario y valor total', async () => {
    for (const malo of [0, -5, 'abc', '$ 12abc']) {
      expect((await validacion(crearContrato(deps, { ...BASE, honorario: malo }))).campos.honorario).toMatch(/honorario/i);
    }
    expect((await validacion(crearContrato(deps, { ...BASE, honorario: 9_999_999_999 }))).campos.honorario).toBeTruthy();
    expect((await validacion(crearContrato(deps, { ...BASE, valorTotal: 'mucho' }))).campos.valorTotal).toMatch(/valor total/i);
    const e = await validacion(crearContrato(deps, { ...BASE, honorario: 4009000, valorTotal: 1000000 }));
    expect(e.campos.valorTotal).toMatch(/menor que el honorario/);
    // valor total == honorario sí
    await expect(crearContrato(deps, { ...BASE, valorTotal: 4009000 })).resolves.toBeTruthy();
  });

  it('correo con formato válido o vacío', async () => {
    expect((await validacion(crearContrato(deps, { ...BASE, correo: 'no-es-correo' }))).campos.correo).toMatch(/correo/);
    await expect(crearContrato(deps, { ...BASE, correo: '' })).resolves.toBeTruthy();
  });

  it('junta todos los errores a la vez; el mensaje principal es el primero', async () => {
    const e = await validacion(crearContrato(deps, { nombre: '', cedula: '1', riesgo: 'Z', honorario: 'x', correo: 'q' }));
    expect(Object.keys(e.campos)).toEqual(expect.arrayContaining(['nombre', 'cedula', 'riesgo', 'honorario', 'correo']));
    expect(e.message).toBe(e.campos.nombre);
    expect(await db.select().from(contratos)).toHaveLength(0); // no se guardó nada
  });
});

// =================================================================== editar
describe('editar trabajadora', () => {
  it('PUT conserva lo que no viene, permite su propio nombre/cédula y devuelve las cuentas', async () => {
    const c = await crearContrato(deps, BASE);
    await crearCarga(db, c.id, '2026-01');
    const r = await actualizarContrato(deps, c.id, { nombre: 'MARIA PRUEBA UNO', ciudad: 'Medellín' });
    expect(r.nombre).toBe('MARIA PRUEBA UNO'); // cambia solo tildes de ella misma: permitido
    expect(r.cedula).toBe('1000001111');
    expect(r.honorario).toBe(4009000);
    expect(r.ciudad).toBe('Medellín');
    expect(r.cargas).toBe(1);
    const off = await actualizarContrato(deps, c.id, { activo: false });
    expect(off.activo).toBe(false);
  });

  it('PUT valida igual que POST (contra las demás) y da 404 si no existe', async () => {
    const a = await crearContrato(deps, BASE);
    const b = await crearContrato(deps, { ...BASE, nombre: 'Otra Mujer', cedula: '1000002222' });
    expect((await validacion(actualizarContrato(deps, b.id, { nombre: 'maría prueba uno' }))).campos.nombre).toBeTruthy();
    expect((await validacion(actualizarContrato(deps, b.id, { cedula: '1000001111' }))).campos.cedula).toBeTruthy();
    expect((await validacion(actualizarContrato(deps, a.id, { fin: '2025-01-01' }))).campos.fin).toMatch(/antes/); // contra el inicio guardado
    expect((await validacion(actualizarContrato(deps, a.id, { valorTotal: 1000 }))).campos.valorTotal).toMatch(/menor/); // contra el honorario guardado
    expect((await amable(actualizarContrato(deps, 99999, { ciudad: 'x' }))).estado).toBe(404);
  });

  it('al cambiar valor_total se recalculan acumulado y pct de sus cargas, sin re-evaluar el valor de cada mes', async () => {
    const c = await crearContrato(deps, BASE); // 36.081.000
    await crearCarga(db, c.id, '2026-01', { valor: 4009000, acumulado: 0, pct: 0, estado: 'REVISAR', mensaje: 'texto original' });
    await crearCarga(db, c.id, '2026-02', { valor: 4009000, acumulado: 0, pct: 0 });
    const otra = await crearContrato(deps, { ...BASE, nombre: 'Otra Mujer', cedula: '1000002222' });
    const ajena = await crearCarga(db, otra.id, '2026-01', { acumulado: 123, pct: 0.5 });

    await actualizarContrato(deps, c.id, { valorTotal: '40.090.000' });
    const filas = await db.select().from(cargas).where(eq(cargas.contratoId, c.id)).orderBy(cargas.mes);
    expect(filas.map((f) => f.acumulado)).toEqual([4009000, 8018000]);
    expect(filas[0].pct).toBeCloseTo(0.1, 10);
    expect(filas[1].pct).toBeCloseTo(0.2, 10);
    expect(filas.map((f) => f.valor)).toEqual([4009000, 4009000]);
    expect(filas[0].estado).toBe('REVISAR');
    expect(filas[0].mensaje).toBe('texto original');
    // las cuentas de otra trabajadora no se tocan
    const [aj] = await db.select().from(cargas).where(eq(cargas.id, ajena));
    expect(aj.acumulado).toBe(123);
    expect(aj.pct).toBe(0.5);

    // contrato por completar con cargas: no se rompe ni escribe NaN
    await actualizarContrato(deps, c.id, { inicio: '', fin: '', honorario: '', valorTotal: '' });
    const despues = await db.select().from(cargas).where(eq(cargas.contratoId, c.id));
    expect(despues.every((f) => Number.isFinite(f.acumulado))).toBe(true);
  });
});

describe('listar trabajadoras', () => {
  it('orden por nombre sin tildes y con el número de cuentas', async () => {
    const a = await crearContrato(deps, { ...BASE, nombre: 'Zoila Prueba', cedula: '1000002222' });
    const b = await crearContrato(deps, { ...BASE, nombre: 'Álvaro Prueba', cedula: '1000003333' });
    const c = await crearContrato(deps, { ...BASE, nombre: 'Beatriz Prueba', cedula: '1000004444' });
    await crearCarga(db, a.id, '2026-01');
    await crearCarga(db, a.id, '2026-02');
    await crearCarga(db, c.id, '2026-01');
    const lista = await listarContratos(deps);
    expect(lista.map((x) => x.nombre)).toEqual(['Álvaro Prueba', 'Beatriz Prueba', 'Zoila Prueba']);
    expect(lista.map((x) => x.cargas)).toEqual([0, 1, 2]);
    expect(b.id).toBe(lista[0].id);
  });
});

// =================================================================== borrar
describe('borrar trabajadora', () => {
  it('sin cuentas se borra directo (y sus planillas subidas sin enviar)', async () => {
    const c = await crearContrato(deps, BASE);
    await blob.put('planillas/x/subida.pdf', Buffer.from('a'), 'application/pdf');
    await db.insert(lecturas).values({
      tempId: '11111111-1111-4111-8111-111111111111',
      contratoId: c.id,
      archivo: 'planillas/x/subida.pdf',
      tipo: 'pdf',
      lectura: { numero: '1', periodo: '2026-01', salud: 1, pension: 1, arl: 1 },
    });
    await borrarContrato(deps, c.id);
    expect(await db.select().from(contratos)).toHaveLength(0);
    expect(await db.select().from(lecturas)).toHaveLength(0);
    expect(blob.archivos.size).toBe(0);
  });

  it('404 si no existe', async () => {
    expect((await amable(borrarContrato(deps, 12345))).estado).toBe(404);
  });

  it('con cuentas exige escribir el nombre; no borra nada si no coincide', async () => {
    const c = await crearContrato(deps, BASE);
    await crearCarga(db, c.id, '2026-01');
    await crearCarga(db, c.id, '2026-02');
    for (const mal of [undefined, '', 'otra persona', 'María']) {
      const e = await amable(borrarContrato(deps, c.id, mal));
      expect(e.message).toBe(
        'Para borrar a MARÍA PRUEBA UNO con 2 cuentas enviadas, escribe su nombre completo. Si solo quieres que no aparezca en el celular, desactívala.',
      );
    }
    expect(await db.select().from(contratos)).toHaveLength(1);
    expect(await db.select().from(cargas)).toHaveLength(2);
  });

  it('con el nombre correcto (sin tildes/mayúsculas) borra cargas, lecturas, contrato y TODOS sus archivos de Blob', async () => {
    const c = await crearContrato(deps, BASE);
    const otra = await crearContrato(deps, { ...BASE, nombre: 'Otra Mujer', cedula: '1000002222' });
    const put = (p: string) => blob.put(p, Buffer.from(p), 'application/pdf');
    for (const p of ['planillas/a/principal-1.pdf', 'planillas/a/adic-1.pdf', 'planillas/a/adic-2.pdf', 'planillas/a/principal-2.pdf', 'planillas/a/subida.pdf', 'planillas/b/otra.pdf']) {
      await put(p);
    }
    await crearCarga(db, c.id, '2026-01', {
      archivoPlanilla: 'planillas/a/principal-1.pdf',
      adicionales: [
        { numero: '1', mes: '2026-01', valor: 10, archivo: 'planillas/a/adic-1.pdf' },
        { numero: '2', mes: '2026-01', valor: 20, archivo: 'planillas/a/adic-2.pdf' },
        { numero: '3', mes: '2026-01', valor: 30, archivo: '' },
      ],
    });
    await crearCarga(db, c.id, '2026-02', { archivoPlanilla: 'planillas/a/principal-2.pdf' });
    await crearCarga(db, otra.id, '2026-01', { archivoPlanilla: 'planillas/b/otra.pdf' });
    await db.insert(lecturas).values({
      tempId: '22222222-2222-4222-8222-222222222222',
      contratoId: c.id,
      archivo: 'planillas/a/subida.pdf',
      tipo: 'pdf',
      lectura: { numero: '1', periodo: '2026-01', salud: 1, pension: 1, arl: 1 },
    });

    await borrarContrato(deps, c.id, '  maria   PRUEBA uno ');

    expect((await db.select().from(contratos)).map((x) => x.id)).toEqual([otra.id]);
    expect((await db.select().from(cargas)).map((x) => x.contratoId)).toEqual([otra.id]);
    expect(await db.select().from(lecturas)).toHaveLength(0);
    expect([...blob.archivos.keys()]).toEqual(['planillas/b/otra.pdf']);
  });

  it('si Blob falla no se borra nada (se puede reintentar)', async () => {
    const c = await crearContrato(deps, BASE);
    await crearCarga(db, c.id, '2026-01', { archivoPlanilla: 'planillas/a/p.pdf' });
    blob.del = async () => {
      throw new Error('blob caído (simulado)');
    };
    const e = await amable(borrarContrato(deps, c.id, 'maria prueba uno'));
    expect(e.message).toMatch(/No se borró nada/);
    expect(await db.select().from(contratos)).toHaveLength(1);
    expect(await db.select().from(cargas)).toHaveLength(1);
  });
});

// =================================================================== cuentas del mes
describe('cuentas del mes', () => {
  it('el mes por defecto es el anterior al actual en Bogotá (también al cruzar de año)', () => {
    expect(mesPorDefecto(AHORA)).toBe('2026-08');
    expect(mesPorDefecto(new Date('2027-01-10T15:00:00Z'))).toBe('2026-12');
    // 1 de octubre 02:00 en Bogotá = 07:00Z; 30 de sept 23:00 en Bogotá = 04:00Z del 1 de oct: todavía septiembre
    expect(mesPorDefecto(new Date('2026-10-01T04:00:00Z'))).toBe('2026-08');
    expect(mesPorDefecto(new Date('2026-10-01T05:00:00Z'))).toBe('2026-09');
  });

  it('lista las cuentas del mes y `faltan` = activas cuyo contrato cubre el mes y no enviaron', async () => {
    const envio = await crearContrato(deps, { ...BASE, nombre: 'Zoila Envió', cedula: '1000002222' });
    const falta1 = await crearContrato(deps, { ...BASE, nombre: 'Úrsula Falta', cedula: '1000003333' });
    const falta2 = await crearContrato(deps, { ...BASE, nombre: 'Berta Falta', cedula: '1000004444' });
    await crearContrato(deps, { ...BASE, nombre: 'Inactiva Falta', cedula: '1000005555', activo: false });
    await crearContrato(deps, { ...BASE, nombre: 'Terminó Antes', cedula: '1000006666', fin: '2026-06-30' });
    await crearContrato(deps, { ...BASE, nombre: 'Empieza Después', cedula: '1000007777', inicio: '2026-09-01' });
    await crearContrato(deps, { ...BASE, nombre: 'Sin Fechas', cedula: '1000008888', inicio: '', fin: '' });
    const carga = await crearCarga(db, envio.id, '2026-08', {
      valor: 4009000,
      estado: 'REVISAR',
      mensaje: 'Algo para mirar',
      archivoPlanilla: 'planillas/1/2026-08/secreta.pdf',
      adicionales: [
        { numero: '99', mes: '2026-08', valor: 5000, archivo: 'planillas/1/2026-08/adic.pdf' },
        { numero: '98', mes: '', valor: 6000, archivo: '' },
      ],
    });
    await crearCarga(db, falta1.id, '2026-07'); // otro mes: no cuenta como enviada en agosto

    const r = await listarCargas(deps); // sin mes: agosto 2026
    expect(r.mes).toBe('2026-08');
    expect(r.cargas).toHaveLength(1);
    const c = r.cargas[0];
    expect(c).toMatchObject({
      id: carga,
      contratoId: envio.id,
      nombre: 'Zoila Envió',
      mes: '2026-08',
      estado: 'REVISAR',
      emoji: '🟡',
      mensaje: 'Algo para mirar',
      docNum: 202608,
      tienePlanilla: true,
      aprobado: false,
      observacion: '',
      lectura: 'auto',
    });
    expect(c.adicionales).toEqual([
      { numero: '99', mes: '2026-08', valor: 5000, tieneArchivo: true },
      { numero: '98', mes: '', valor: 6000, tieneArchivo: false },
    ]);
    expect(JSON.stringify(r)).not.toContain('planillas/'); // nunca sale la ruta del archivo
    expect(r.faltan).toEqual([
      { contratoId: falta2.id, nombre: 'Berta Falta' },
      { contratoId: falta1.id, nombre: 'Úrsula Falta' },
    ]);

    // otro mes explícito
    const jul = await listarCargas(deps, '2026-07');
    expect(jul.cargas.map((x) => x.nombre)).toEqual(['Úrsula Falta']);
    expect(jul.faltan.map((x) => x.nombre)).toContain('Zoila Envió');
    expect(jul.faltan.map((x) => x.nombre)).not.toContain('Empieza Después');

    // mes malo
    expect((await amable(listarCargas(deps, '2026-13'))).message).toMatch(/mes/);
    expect((await listarCargas(deps, '')).mes).toBe('2026-08');
  });

  it('PATCH: aprobar y observación (recortada); valida tipos; no toca `actualizado`', async () => {
    const c = await crearContrato(deps, BASE);
    const id = await crearCarga(db, c.id, '2026-08');
    const [antes] = await db.select().from(cargas).where(eq(cargas.id, id));

    const a = await actualizarCarga(deps, id, { aprobado: true });
    expect(a.aprobado).toBe(true);
    expect(a.nombre).toBe(BASE.nombre);
    const b = await actualizarCarga(deps, id, { observacion: '  Falta el soporte de ARL  ' });
    expect(b.observacion).toBe('Falta el soporte de ARL');
    expect(b.aprobado).toBe(true); // lo anterior se conserva
    const d = await actualizarCarga(deps, id, { aprobado: false, observacion: '' });
    expect(d).toMatchObject({ aprobado: false, observacion: '' });

    expect((await validacion(actualizarCarga(deps, id, { aprobado: 'si' }))).campos.aprobado).toBeTruthy();
    expect((await validacion(actualizarCarga(deps, id, { observacion: 5 }))).campos.observacion).toBeTruthy();
    expect((await validacion(actualizarCarga(deps, id, { observacion: 'x'.repeat(1001) }))).campos.observacion).toMatch(/larga/);
    expect((await amable(actualizarCarga(deps, id, {}))).message).toMatch(/nada que guardar/);
    expect((await amable(actualizarCarga(deps, 99999, { aprobado: true }))).estado).toBe(404);

    const [despues] = await db.select().from(cargas).where(eq(cargas.id, id));
    expect(despues.actualizado.getTime()).toBe(antes.actualizado.getTime());
  });
});

// =================================================================== ver planilla
describe('ver planilla (Blob privado)', () => {
  async function leer(s: ReadableStream<Uint8Array>): Promise<Buffer> {
    return Buffer.from(await new Response(s).arrayBuffer());
  }

  it('principal (n=0) y adicionales (n=1..3) con tipo correcto y nombre de archivo', async () => {
    const c = await crearContrato(deps, BASE);
    await blob.put('planillas/1/2026-08/u1-principal.pdf', Buffer.from(bytesPdf('principal')), 'application/pdf');
    await blob.put('planillas/1/2026-08/u2-adicional.png', Buffer.from('imagen-falsa'), 'image/png');
    const id = await crearCarga(db, c.id, '2026-08', {
      archivoPlanilla: 'planillas/1/2026-08/u1-principal.pdf',
      adicionales: [
        { numero: '1', mes: '2026-08', valor: 1, archivo: 'planillas/1/2026-08/u2-adicional.png' },
        { numero: '2', mes: '2026-08', valor: 2, archivo: '' },
      ],
    });
    const p = await planillaParaVer(deps, id, 0);
    expect(p.mime).toBe('application/pdf');
    expect(p.nombreArchivo).toBe('Planilla-2026-08-MARIA-PRUEBA-UNO.pdf');
    expect((await leer(p.stream)).toString()).toContain('%PDF-1.4');
    const a = await planillaParaVer(deps, id, 1);
    expect(a.mime).toBe('image/png');
    expect(a.nombreArchivo).toBe('Planilla-2026-08-MARIA-PRUEBA-UNO-adicional-1.png');
    expect((await leer(a.stream)).toString()).toBe('imagen-falsa');
  });

  it('404 si no hay archivo, n fuera de rango, carga inexistente o el blob ya no existe', async () => {
    const c = await crearContrato(deps, BASE);
    const id = await crearCarga(db, c.id, '2026-08', {
      archivoPlanilla: 'planillas/1/2026-08/borrado.pdf',
      adicionales: [{ numero: '2', mes: '', valor: 2, archivo: '' }],
    });
    expect((await amable(planillaParaVer(deps, id, 0))).estado).toBe(404); // blob ausente
    expect((await amable(planillaParaVer(deps, id, 1))).estado).toBe(404); // adicional sin archivo
    expect((await amable(planillaParaVer(deps, id, 3))).estado).toBe(404);
    expect((await amable(planillaParaVer(deps, id, 4))).estado).toBe(404);
    expect((await amable(planillaParaVer(deps, id, -1))).estado).toBe(404);
    expect((await amable(planillaParaVer(deps, 999999, 0))).estado).toBe(404);
  });

  it('no sirve extensiones raras aunque estén en la ruta', async () => {
    const c = await crearContrato(deps, BASE);
    await blob.put('planillas/1/2026-08/x.html', Buffer.from('<script>1</script>'), 'text/html');
    const id = await crearCarga(db, c.id, '2026-08', { archivoPlanilla: 'planillas/1/2026-08/x.html' });
    expect((await amable(planillaParaVer(deps, id, 0))).estado).toBe(415);
  });
});

// =================================================================== parámetros
describe('parámetros', () => {
  it('GET devuelve la fila con los valores por defecto', async () => {
    const p = await leerParametros(deps);
    expect(p).toMatchObject({ id: 1, pctIbc: 0.4, salud: 0.125, pension: 0.16, smmlv: 1750905, toleranciaSs: 100, enviarCorreo: false });
    expect(p.arl.III).toBe(0.02436);
  });

  it('PUT guarda cambios parciales y acepta "0,125" y "1.800.000"', async () => {
    const p = await guardarParametros(deps, {
      smmlv: '1.800.000',
      salud: '0,13',
      arl: { III: 0.025, I: '0,005' },
      correoSupervisor: 'supervisor@ejemplo.com',
      enviarCorreo: true,
      toleranciaSs: 200,
      ibc_techo_mult: 20,
    });
    expect(p.smmlv).toBe(1800000);
    expect(p.salud).toBe(0.13);
    expect(p.pension).toBe(0.16); // lo que no viene se conserva
    expect(p.arl).toMatchObject({ I: 0.005, II: 0.01044, III: 0.025, IV: 0.0435, V: 0.0696 });
    expect(p.correoSupervisor).toBe('supervisor@ejemplo.com');
    expect(p.enviarCorreo).toBe(true);
    expect(p.toleranciaSs).toBe(200);
    expect(p.ibcTechoMult).toBe(20);
    expect((await leerParametros(deps)).smmlv).toBe(1800000);
    // correo vacío es válido
    expect((await guardarParametros(deps, { correoSupervisor: '' })).correoSupervisor).toBe('');
    // tolerancia 0 es válida
    expect((await guardarParametros(deps, { toleranciaSs: 0 })).toleranciaSs).toBe(0);
  });

  it('valida cada campo y no guarda nada si hay un error', async () => {
    const casos: Array<[Record<string, unknown>, string]> = [
      [{ pctIbc: 1.5 }, 'pctIbc'],
      [{ salud: -0.1 }, 'salud'],
      [{ pension: 'mucho' }, 'pension'],
      [{ smmlv: 0 }, 'smmlv'],
      [{ smmlv: 'abc' }, 'smmlv'],
      [{ ibcPisoMult: 0 }, 'ibcPisoMult'],
      [{ ibcTechoMult: -3 }, 'ibcTechoMult'],
      [{ ibcPisoMult: 30, ibcTechoMult: 25 }, 'ibcTechoMult'],
      [{ arl: { III: 0.5 } }, 'arl.III'],
      [{ arl: { II: -0.01 } }, 'arl.II'],
      [{ arl: 'x' }, 'arl'],
      [{ correoSupervisor: 'no-es-correo' }, 'correoSupervisor'],
      [{ toleranciaSs: -1 }, 'toleranciaSs'],
      [{ enviarCorreo: 'si' }, 'enviarCorreo'],
    ];
    for (const [entrada, campo] of casos) {
      const e = await validacion(guardarParametros(deps, { smmlv: 1900000, ...entrada }));
      expect(Object.keys(e.campos), JSON.stringify(entrada)).toContain(campo);
    }
    // ni siquiera el campo válido (smmlv 1.900.000) se guardó
    expect((await leerParametros(deps)).smmlv).toBe(1750905);
  });
});
