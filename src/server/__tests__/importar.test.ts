// Importación desde el Excel de control. Los .xlsx se CONSTRUYEN aquí con exceljs y datos INVENTADOS.
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importarExcel } from '../admin';
import type { Db } from '../db';
import { contratos } from '../db/schema';
import { ErrorAmable } from '../errores';
import {
  MAX_BYTES_IMPORTAR,
  MAX_FILAS_IMPORTAR,
  compactoEncabezado,
  leerCedula,
  leerHonorario,
  leerRiesgo,
  parsearExcelControl,
} from '../importar';
import type { Deps } from '../servicios';
import { BlobFalso, crearBase, crearContratista, crearDeps, vaciar } from './helpers';

// Mismo orden de columnas que el Excel de control: #Línea, Línea política pública, CEDULA, NOMBRE, CONTRATO 2026,
// HONORARIOS, varias columnas numéricas del cálculo mensual (se ignoran) y RIESGO ARL.
const ENCABEZADO = ['#Línea', 'Línea política pública', 'CEDULA', 'NOMBRE', 'CONTRATO 2026', 'HONORARIOS', 'DÍAS', 'IBC', 'SALUD', 'PENSIÓN', 'ARL', 'TOTAL SS', 'RIESGO ARL'];

type Celda = string | number | null | { formula: string; result: number } | { richText: Array<{ text: string }> };

function fila(n: number, linea: string, cedula: Celda, nombre: Celda, contrato: Celda, honorario: Celda, riesgo: Celda): Celda[] {
  return [n, linea, cedula, nombre, contrato, honorario, 30, 4009000, 218900, 280200, 42700, 541800, riesgo];
}

async function xlsx(filas: Celda[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Control');
  for (const f of filas) ws.addRow(f);
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

// =================================================================== piezas puras
describe('lectores de celdas', () => {
  it('encabezados sin tildes, mayúsculas ni signos', () => {
    expect(compactoEncabezado('  Cédula ')).toBe('cedula');
    expect(compactoEncabezado('#Línea')).toBe('linea');
    expect(compactoEncabezado('RIESGO   ARL')).toBe('riesgoarl');
    expect(compactoEncabezado({ richText: [{ text: 'Línea política ' }, { text: 'pública' }] })).toBe('lineapoliticapublica');
    expect(compactoEncabezado(null)).toBe('');
  });

  it('cédula: número o texto con puntos/espacios', () => {
    expect(leerCedula(1000001111)).toEqual({ ok: true, valor: '1000001111' });
    expect(leerCedula('1.000.001.111')).toEqual({ ok: true, valor: '1000001111' });
    expect(leerCedula(' 1 000 001 111 ')).toEqual({ ok: true, valor: '1000001111' });
    expect(leerCedula('43123456')).toEqual({ ok: true, valor: '43123456' });
    for (const mala of [null, '', '12345', '12345678901', '1000A01111', 1000001111.5, -1000001111]) {
      expect(leerCedula(mala as string).ok, String(mala)).toBe(false);
    }
  });

  it('honorario: número o texto "$ 7.174.000"', () => {
    expect(leerHonorario(7174000)).toEqual({ ok: true, valor: 7174000 });
    expect(leerHonorario('$ 7.174.000')).toEqual({ ok: true, valor: 7174000 });
    expect(leerHonorario('7174000')).toEqual({ ok: true, valor: 7174000 });
    expect(leerHonorario(7174000.4)).toEqual({ ok: true, valor: 7174000 });
    for (const malo of [0, -1, 'abc', '$ 0', 99_999_999_999]) expect(leerHonorario(malo).ok, String(malo)).toBe(false);
  });

  it('riesgo: 1-5 o I-V', () => {
    expect(leerRiesgo(3)).toEqual({ ok: true, valor: 'III' });
    expect(leerRiesgo('3')).toEqual({ ok: true, valor: 'III' });
    expect(leerRiesgo('iii')).toEqual({ ok: true, valor: 'III' });
    expect(leerRiesgo(' IV ')).toEqual({ ok: true, valor: 'IV' });
    expect(leerRiesgo('Riesgo 5')).toEqual({ ok: true, valor: 'V' });
    for (const malo of [0, 6, 2.5, 'VI', 'x', '']) expect(leerRiesgo(malo as string).ok, String(malo)).toBe(false);
  });
});

// =================================================================== parseo del archivo
describe('parsearExcelControl', () => {
  it('lee el formato de referencia (encabezados en la fila 1) e ignora las columnas de cálculo', async () => {
    const r = await parsearExcelControl(
      await xlsx([
        ENCABEZADO,
        fila(1, 'Línea de prueba A', 1000001111, 'María Prueba Uno', '2026CPS001', 7174000, 3),
        fila(2, 'Línea de prueba B', '1.000.002.222', 'Berta Prueba Dos', '2026CPS002', '$ 5.064.000', 'III'),
      ]),
    );
    expect(r.errores).toEqual([]);
    expect(r.filaEncabezados).toBe(1);
    expect(r.filas).toEqual([
      { fila: 2, cedula: '1000001111', nombre: 'María Prueba Uno', numeroContrato: '2026CPS001', honorario: 7174000, riesgo: 'III', linea: 'Línea de prueba A' },
      { fila: 3, cedula: '1000002222', nombre: 'Berta Prueba Dos', numeroContrato: '2026CPS002', honorario: 5064000, riesgo: 'III', linea: 'Línea de prueba B' },
    ]);
  });

  it('encuentra los encabezados aunque estén en la fila 3 (y usa la primera hoja)', async () => {
    const r = await parsearExcelControl(
      await xlsx([['CONTROL DE PRUEBA'], ['Observatorio de prueba, 2026'], ENCABEZADO, fila(1, 'L', 1000001111, 'María Prueba Uno', '2026CPS001', 7174000, 'II')]),
    );
    expect(r.filaEncabezados).toBe(3);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ fila: 4, riesgo: 'II' });
  });

  it('encabezados con tildes, mayúsculas y espacios raros; "CONTRATO …" cualquiera; sin columna de línea', async () => {
    const r = await parsearExcelControl(
      await xlsx([
        ['  cédula ', 'Nombre completo', 'Contrato 2027-B', ' Honorarios ', 'riesgo  ARL', 'IBC'],
        [1000001111, 'María Prueba Uno', '2027CPS9', 4009000, 'iv', 1],
      ]),
    );
    expect(r.filas).toEqual([{ fila: 2, cedula: '1000001111', nombre: 'María Prueba Uno', numeroContrato: '2027CPS9', honorario: 4009000, riesgo: 'IV' }]);
  });

  it('"#Línea" (consecutivo) no se confunde con "Línea política pública"', async () => {
    const r = await parsearExcelControl(await xlsx([['#Línea', 'CEDULA', 'NOMBRE'], [7, 1000001111, 'María Prueba Uno']]));
    expect(r.filas[0].linea).toBeUndefined();
  });

  it('celdas con fórmula o texto enriquecido; celdas vacías no se tocan (undefined)', async () => {
    const r = await parsearExcelControl(
      await xlsx([
        ENCABEZADO,
        fila(1, '', 1000001111, { richText: [{ text: 'María ' }, { text: 'Prueba Uno' }] }, null, { formula: '7174000', result: 7174000 }, null),
      ]),
    );
    expect(r.errores).toEqual([]);
    expect(r.filas[0]).toEqual({ fila: 2, cedula: '1000001111', nombre: 'María Prueba Uno', honorario: 7174000 });
  });

  it('errores por fila: sin cédula/nombre, cédula mala, honorario o riesgo malos, cédula repetida; filas vacías se saltan', async () => {
    const r = await parsearExcelControl(
      await xlsx([
        ENCABEZADO,
        fila(1, 'L', 1000001111, 'Buena Uno', 'C1', 4009000, 3), // fila 2: bien
        fila(2, 'L', 'abc', 'Cédula Mala', 'C2', 4009000, 3), // 3
        fila(3, 'L', 1000002222, null, 'C3', 4009000, 3), // 4: sin nombre
        fila(4, 'L', 1000003333, 'Honorario Malo', 'C4', 'mucho', 3), // 5
        fila(5, 'L', 1000004444, 'Riesgo Malo', 'C5', 4009000, 9), // 6
        fila(6, 'L', 1000001111, 'Repetida', 'C6', 4009000, 3), // 7
        [null, null, null, null, null, null, 30, 99, 99, 99, 99, 99, null], // 8: totales sin identificar
        fila(7, 'L', null, 'TOTAL', null, null, null), // 9: sin cédula
      ]),
    );
    expect(r.filas.map((f) => f.fila)).toEqual([2]);
    expect(r.errores.map((e) => e.fila)).toEqual([3, 4, 5, 6, 7, 9]);
    expect(r.errores.find((e) => e.fila === 3)!.mensaje).toMatch(/cédula/i);
    expect(r.errores.find((e) => e.fila === 4)!.mensaje).toMatch(/nombre/i);
    expect(r.errores.find((e) => e.fila === 5)!.mensaje).toMatch(/honorario/i);
    expect(r.errores.find((e) => e.fila === 6)!.mensaje).toMatch(/riesgo/i);
    expect(r.errores.find((e) => e.fila === 7)!.mensaje).toMatch(/repetida/i);
    // ningún mensaje trae cédulas
    expect(JSON.stringify(r.errores)).not.toMatch(/\d{6,}/);
  });

  it('sin CEDULA y NOMBRE en las primeras 10 filas -> error claro', async () => {
    const relleno: Celda[][] = Array.from({ length: 11 }, (_, i) => [`fila ${i}`]);
    await expect(parsearExcelControl(await xlsx([...relleno, ENCABEZADO]))).rejects.toThrowError(/CEDULA y NOMBRE/);
    await expect(parsearExcelControl(await xlsx([['solo', 'nombre']]))).rejects.toThrowError(/CEDULA y NOMBRE/);
  });

  it('archivo que no es .xlsx, vacío, muy grande o con más de 200 filas', async () => {
    const e1 = await parsearExcelControl(new Uint8Array(Buffer.from('esto no es un excel'))).catch((e) => e);
    expect(e1).toBeInstanceOf(ErrorAmable);
    expect(e1.estado).toBe(415);
    await expect(parsearExcelControl(new Uint8Array(0))).rejects.toBeInstanceOf(ErrorAmable);
    const grande = await parsearExcelControl(new Uint8Array(MAX_BYTES_IMPORTAR + 1)).catch((e) => e);
    expect(grande.estado).toBe(413);

    const muchas: Celda[][] = [ENCABEZADO];
    for (let i = 0; i <= MAX_FILAS_IMPORTAR; i++) muchas.push(fila(i, 'L', 1000000000 + i, `Persona Número ${i}`, 'C', 4009000, 3));
    const e2 = await parsearExcelControl(await xlsx(muchas)).catch((e) => e);
    expect(e2).toBeInstanceOf(ErrorAmable);
    expect(e2.message).toMatch(/200/);
    // exactamente 200 sí
    muchas.pop();
    expect((await parsearExcelControl(await xlsx(muchas))).filas).toHaveLength(MAX_FILAS_IMPORTAR);
  });
});

// =================================================================== vista previa vs aplicar
describe('importarExcel (vista previa y aplicar)', () => {
  let db: Db;
  let deps: Deps;

  beforeAll(async () => {
    db = await crearBase();
  });

  beforeEach(async () => {
    await vaciar(db);
    deps = crearDeps(db, new BlobFalso());
    await crearContratista(db, { nombre: 'María Prueba Uno', cedula: '1000001111', numeroContrato: '2026CPS001', honorario: 4009000, riesgo: 'III', linea: '', objeto: 'Objeto de María' });
    await crearContratista(db, { nombre: 'Berta Prueba Dos', cedula: '1000002222', numeroContrato: '2026CPS002', honorario: 5064000, riesgo: 'III', linea: 'Línea B' });
    await crearContratista(db, { nombre: 'Gloria Prueba Cinco', cedula: '1000005555', numeroContrato: '2026CPS005', honorario: 7174000, riesgo: 'II', linea: 'Línea G' });
  });

  async function archivo(): Promise<Uint8Array> {
    return xlsx([
      ['CONTROL DE PRUEBA'],
      ['Observatorio de prueba, 2026'],
      ENCABEZADO, // encabezados en la fila 3
      fila(1, 'Línea A nueva', 1000001111, 'María Prueba Uno', '2026CPS777', '$ 5.064.000', 2), // 4: 4 cambios
      fila(2, 'Línea B', '1.000.002.222', 'Berta Prueba Dos', '2026CPS002', 5064000, 'III'), // 5: sin cambios
      fila(3, 'Línea C', '1.000.003.333', 'Carla Prueba Tres', '2026CPS003', 4009000, 4), // 6: crear
      fila(4, 'Línea D', 1000004444, 'Diana Prueba Cuatro', '2026CPS004', 4009000, 9), // 7: error de riesgo
      fila(5, 'Línea E', 1000006666, 'BERTA  prueba dos', '2026CPS006', 4009000, 3), // 8: nombre ya existe
      fila(6, '', 1000005555, 'Gloria Prueba Cinco', null, null, null), // 9: celdas vacías no borran nada
      fila(7, 'Línea H', 1000007777, 'Elena Prueba Siete', null, null, null), // 10: crear sin datos extra
    ]);
  }

  function hayCedulaCompleta(json: string): boolean {
    return ['1000001111', '1000002222', '1000003333', '1000004444', '1000005555', '1000006666', '1000007777', '1.000.001.111', '1.000.003.333'].some((c) => json.includes(c));
  }

  it('vista previa: resume sin guardar nada y nunca devuelve la cédula completa', async () => {
    const antes = await db.select().from(contratos);
    const r = await importarExcel(deps, await archivo(), false);

    expect(r.crear).toEqual([
      { nombre: 'Carla Prueba Tres', cedulaFinal4: '…3333' },
      { nombre: 'Elena Prueba Siete', cedulaFinal4: '…7777' },
    ]);
    expect(r.actualizar).toHaveLength(1);
    const a = r.actualizar[0];
    expect(a.nombre).toBe('María Prueba Uno');
    expect(a.cambios).toEqual([
      { campo: 'numeroContrato', etiqueta: 'N.º de contrato', antes: '2026CPS001', despues: '2026CPS777' },
      { campo: 'honorario', etiqueta: 'Honorario', antes: 4009000, despues: 5064000 },
      { campo: 'riesgo', etiqueta: 'Riesgo ARL', antes: 'III', despues: 'II' },
      { campo: 'linea', etiqueta: 'Línea política pública', antes: '', despues: 'Línea A nueva' },
    ]);
    expect(r.sinCambios).toBe(2); // Berta y Gloria
    expect(r.errores.map((e) => e.fila)).toEqual([7, 8]);
    expect(r.errores[0].mensaje).toMatch(/riesgo/i);
    expect(r.errores[1].mensaje).toMatch(/Ya hay otra trabajadora con ese nombre/);
    expect(hayCedulaCompleta(JSON.stringify(r))).toBe(false);

    // la base quedó igual
    expect(await db.select().from(contratos)).toEqual(antes);
  });

  it('aplicar: crea, actualiza solo lo que cambió, salta las filas con error y devuelve el mismo resumen', async () => {
    const previa = await importarExcel(deps, await archivo(), false);
    const r = await importarExcel(deps, await archivo(), true);
    expect(r).toEqual(previa);
    expect(hayCedulaCompleta(JSON.stringify(r))).toBe(false);

    const todos = await db.select().from(contratos);
    expect(todos).toHaveLength(5);
    const por = (c: string) => todos.find((x) => x.cedula === c)!;

    const maria = por('1000001111');
    expect(maria).toMatchObject({ numeroContrato: '2026CPS777', honorario: 5064000, riesgo: 'II', linea: 'Línea A nueva', objeto: 'Objeto de María', activo: true });

    const carla = por('1000003333');
    expect(carla).toMatchObject({
      nombre: 'Carla Prueba Tres',
      numeroContrato: '2026CPS003',
      honorario: 4009000,
      riesgo: 'IV',
      linea: 'Línea C',
      activo: true,
      objeto: '',
      direccion: '',
      inicio: null,
      fin: null,
      valorTotal: null,
    });
    // sin riesgo/contrato en el archivo: lo que no hay queda vacío (riesgo por defecto I)
    expect(por('1000007777')).toMatchObject({ nombre: 'Elena Prueba Siete', numeroContrato: '', honorario: null, riesgo: 'I', linea: 'Línea H', activo: true });

    // Gloria: celdas vacías no borran sus datos
    expect(por('1000005555')).toMatchObject({ numeroContrato: '2026CPS005', honorario: 7174000, riesgo: 'II', linea: 'Línea G' });
    // filas con error: no se crearon
    expect(todos.some((x) => x.cedula === '1000004444' || x.cedula === '1000006666')).toBe(false);
  });

  it('aplicar dos veces: la segunda no cambia nada', async () => {
    await importarExcel(deps, await archivo(), true);
    const r = await importarExcel(deps, await archivo(), true);
    expect(r.crear).toEqual([]);
    expect(r.actualizar).toEqual([]);
    expect(r.sinCambios).toBe(5);
    expect(r.errores.map((e) => e.fila)).toEqual([7, 8]);
    expect(await db.select().from(contratos)).toHaveLength(5);
  });

  it('un cambio de nombre (misma cédula) se muestra como antes -> después, y el nombre viejo queda libre', async () => {
    const f = await xlsx([ENCABEZADO, fila(1, '', 1000001111, 'María Prueba Renombrada', null, null, null), fila(2, '', 1000009999, 'María Prueba Uno', null, null, null)]);
    const r = await importarExcel(deps, f, true);
    expect(r.actualizar).toEqual([
      {
        id: expect.any(Number),
        nombre: 'María Prueba Renombrada',
        cambios: [{ campo: 'nombre', etiqueta: 'Nombre', antes: 'María Prueba Uno', despues: 'María Prueba Renombrada' }],
      },
    ]);
    // el nombre viejo, ya libre, lo toma una persona nueva
    expect(r.crear).toEqual([{ nombre: 'María Prueba Uno', cedulaFinal4: '…9999' }]);
    expect(r.errores).toEqual([]);
    const [c] = await db.select().from(contratos).where(eq(contratos.cedula, '1000001111'));
    expect(c.nombre).toBe('María Prueba Renombrada');
  });

  it('dos filas nuevas con el mismo nombre: la segunda es error', async () => {
    const f = await xlsx([ENCABEZADO, fila(1, 'L', 1000008881, 'Nueva Prueba', null, null, null), fila(2, 'L', 1000008882, 'nueva  prueba', null, null, null)]);
    const r = await importarExcel(deps, f, true);
    expect(r.crear).toHaveLength(1);
    expect(r.errores).toEqual([{ fila: 3, mensaje: expect.stringMatching(/ese nombre/) }]);
  });

  it('rechaza archivos que no son xlsx o pesan demasiado', async () => {
    await expect(importarExcel(deps, new Uint8Array(Buffer.from('hola, esto es un csv\na,b,c\n')), false)).rejects.toMatchObject({ estado: 415 });
    await expect(importarExcel(deps, new Uint8Array(MAX_BYTES_IMPORTAR + 1), false)).rejects.toMatchObject({ estado: 413 });
  });
});
