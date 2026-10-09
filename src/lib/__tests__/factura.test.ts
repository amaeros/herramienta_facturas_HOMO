// Pruebas del generador de la cuenta de cobro. TODOS los datos son inventados.
import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { generarFacturaXlsx, nombreArchivoFactura, type DatosFactura } from '../factura';

const base: DatosFactura = {
  nombre: 'PRUEBA PÉREZ DE LA TORRE',
  cedula: '1000000001',
  direccion: 'Calle 1 # 2-3 Apto 4',
  telefono: '3000000000',
  ciudad: 'Medellín',
  cargo: 'Profesional Universitaria',
  numeroContrato: '2026CPSP999',
  objeto: 'Prestar servicios profesionales de prueba para el observatorio ficticio.',
  valorTotalContrato: 64566000,
  revisoNombre: 'Revisora de Prueba',
  revisoCargo: 'Apoyo Técnico',
  docNum: '202609',
  fechaInicio: '2026-09-01',
  fechaCorte: '2026-09-30',
  valorPeriodo: 7174000,
  acumulado: 64566000,
  ssDeclarada: 887900,
  planillaNumero: '1234567890',
  planillaMes: '2026-09',
  adicionales: [],
};

const adic2 = [
  { numero: '1111111111', mes: '2026-08', valor: 15000 },
  { numero: '2222222222', mes: '2026-07', valor: 22000 },
];

async function leer(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

const carpetaMuestras = path.join(process.cwd(), 'privado', 'muestras');
let buf0: Buffer;
let buf2: Buffer;

beforeAll(async () => {
  buf0 = await generarFacturaXlsx(base);
  buf2 = await generarFacturaXlsx({ ...base, adicionales: adic2 });
  fs.mkdirSync(carpetaMuestras, { recursive: true });
  fs.writeFileSync(path.join(carpetaMuestras, 'factura_sin_adicionales.xlsx'), buf0);
  fs.writeFileSync(path.join(carpetaMuestras, 'factura_con_2_adicionales.xlsx'), buf2);
  const buf3 = await generarFacturaXlsx({
    ...base,
    adicionales: [...adic2, { numero: '3333333333', mes: '2026-06', valor: 9000 }],
    valorPeriodo: 3586999, ssDeclarada: 443950, fechaInicio: '2026-09-16',
  });
  fs.writeFileSync(path.join(carpetaMuestras, 'factura_con_3_adicionales.xlsx'), buf3);
});

describe('generarFacturaXlsx sin adicionales', () => {
  it('llena las celdas clave', async () => {
    const ws = (await leer(buf0)).getWorksheet('FACTURA')!;
    expect(ws.getCell('B8').value).toBe('PRUEBA PÉREZ DE LA TORRE');
    expect(ws.getCell('B10').value).toBe('1.000.000.001'); // la cédula siempre con puntos
    expect(ws.getCell('B12').value).toBe('Calle 1 # 2-3 Apto 4');
    expect(ws.getCell('B14').value).toBe(3000000000);
    expect(ws.getCell('B16').value).toBe('Medellín');
    expect(ws.getCell('H8').value).toBe(202609);
    expect(ws.getCell('H11').value).toBe('30 de septiembre de 2026');
    expect(ws.getCell('H14').value).toBe('2026CPSP999');
    expect((ws.getCell('G21').value as Date).toISOString().slice(0, 10)).toBe('2026-09-01');
    expect((ws.getCell('L21').value as Date).toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(ws.getCell('G22').value).toBe(7174000);
    expect(ws.getCell('L22').value).toBe(64566000);
    expect(ws.getCell('L25').value).toBe(64566000);
    expect(ws.getCell('K25').value).toBeCloseTo(1, 10);
    expect(ws.getCell('K25').numFmt).toBe('0.00%');
    expect(ws.getCell('B25').value).toContain('observatorio ficticio');
    expect(ws.getCell('B28').value).toBe(887900);
    expect(ws.getCell('B28').numFmt).toBe('"$ "#,##0');
    expect(ws.getCell('C28').value).toBe('planilla pila #.');
    expect(ws.getCell('G28').value).toBe('1234567890');
    expect(ws.getCell('K28').value).toBe(', mes cotizado.');
    expect(ws.getCell('L28').value).toBe('Septiembre');
    expect(ws.getCell('M28').value).toBe('; adicionalmente ');
    expect(ws.getCell('B38').value).toBe('PRUEBA PÉREZ DE LA TORRE');
    expect(ws.getCell('B39').value).toBe('C.C: 1.000.000.001');
    expect(ws.getCell('C42').value).toBe('Prueba Pérez de la Torre');
    expect(ws.getCell('G42').value).toBe('Profesional Universitaria');
    expect(ws.getCell('M42').value).toBe('30 de septiembre de 2026');
    expect(ws.getCell('M43').value).toBe('30 de septiembre de 2026');
    expect(ws.getCell('C43').value).toBe('Revisora de Prueba');
    expect(ws.getCell('G43').value).toBe('Apoyo Técnico');
  });

  it('conserva texto fijo, área de impresión, una sola hoja y las 2 imágenes', async () => {
    const wb = await leer(buf0);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['FACTURA']);
    const ws = wb.getWorksheet('FACTURA')!;
    expect(ws.getCell('G2').value).toBe('DOCUMENTO EQUIVALENTE A LA FACTURA');
    expect(ws.getCell('B47').value).toContain('GJ-CO-FR-15');
    expect(ws.pageSetup.printArea).toBe('A1:N48');
    expect(ws.pageSetup.fitToPage).toBe(true);
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.fitToHeight).toBe(1);
    expect(ws.pageSetup.orientation).toBe('portrait');
    expect(ws.pageSetup.paperSize).toBe(1);
    expect(ws.getImages().length).toBe(2);
    expect((ws.model.merges as string[]).includes('B47:M48')).toBe(true);
    expect((ws.model.merges as string[]).length).toBe(62);
  });

  it('no deja valores en las columnas O en adelante (P/Q)', async () => {
    const ws = (await leer(buf0)).getWorksheet('FACTURA')!;
    let con = 0;
    ws.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (c) => {
        if (Number(c.col) > 14&& c.value !== null && c.value !== '') con++;
      }),
    );
    expect(con).toBe(0);
  });

  it('no deja fórmulas en la hoja', async () => {
    const ws = (await leer(buf0)).getWorksheet('FACTURA')!;
    let formulas = 0;
    ws.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (c) => {
        if (c.type === ExcelJS.ValueType.Formula) formulas++;
      }),
    );
    expect(formulas).toBe(0);
  });

  it('el zip lleva 2 imágenes y una sola hoja', async () => {
    const zip = await JSZip.loadAsync(buf0);
    expect(Object.keys(zip.files).filter((f) => /^xl\/media\/.+\.png$/.test(f)).length).toBe(2);
    expect(Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).length).toBe(1);
  });
});

describe('generarFacturaXlsx con 2 adicionales', () => {
  it('escribe las filas extra debajo de la 28', async () => {
    const ws = (await leer(buf2)).getWorksheet('FACTURA')!;
    expect(ws.getCell('B28').value).toBe(887900);
    expect(ws.getCell('M28').value).toBe('; adicionalmente ');
    expect(ws.getCell('B29').value).toBe(15000);
    expect(ws.getCell('B29').numFmt).toBe('"$ "#,##0');
    expect(ws.getCell('C29').value).toBe('planilla pila #.');
    expect(ws.getCell('G29').value).toBe('1111111111');
    expect(ws.getCell('K29').value).toBe(', mes cotizado.');
    expect(ws.getCell('L29').value).toBe('Agosto');
    expect(ws.getCell('M29').value).toBeNull();
    expect(ws.getCell('B30').value).toBe(22000);
    expect(ws.getCell('G30').value).toBe('2222222222');
    expect(ws.getCell('L30').value).toBe('Julio');
    expect(ws.getRow(29).height).toBe(ws.getRow(28).height);
    expect(ws.getRow(30).height).toBe(ws.getRow(28).height);
  });

  it('combina C:F y G:J en las filas extra y desplaza el resto', async () => {
    const ws = (await leer(buf2)).getWorksheet('FACTURA')!;
    const m = ws.model.merges as string[];
    for (const r of [28, 29, 30]) {
      expect(m).toContain(`C${r}:F${r}`);
      expect(m).toContain(`G${r}:J${r}`);
    }
    // lo que estaba en 29 ("certifico...") ahora está en 31
    expect(ws.getCell('B31').value).toBe('certifico que estos aportes');
    expect(ws.getCell('F31').value).toBe('NO');
    expect(m).toContain('B31:E31');
    expect(m).toContain('G31:M31');
    expect(m).not.toContain('G29:M29');
    // la caja del código se movió 2 filas
    expect(m).toContain('B49:M50');
    expect(m).not.toContain('B47:M48');
    expect(String(ws.getCell('B49').value)).toContain('GJ-CO-FR-15');
    expect(m.length).toBe(62 + 2 * 2);
    // pie de página
    expect(ws.getCell('B40').value).toBe('PRUEBA PÉREZ DE LA TORRE');
    expect(ws.getCell('B41').value).toBe('C.C: 1.000.000.001');
    expect(ws.getCell('C44').value).toBe('Prueba Pérez de la Torre');
    expect(ws.getCell('G44').value).toBe('Profesional Universitaria');
    expect(ws.getCell('M44').value).toBe('30 de septiembre de 2026');
    expect(ws.getCell('M45').value).toBe('30 de septiembre de 2026');
    expect(ws.getCell('C45').value).toBe('Revisora de Prueba');
    expect(ws.getCell('G45').value).toBe('Apoyo Técnico');
    // las celdas viejas ya no tienen el pie
    expect(ws.getCell('B38').value).toBe('Este documento se asimila para todos sus efectos a un titulo valor según art- 772 del COdigo de Comercio');
    expect(ws.getCell('C42').value).toBeNull();
    // alturas desplazadas
    expect(ws.getRow(39).height).toBe(57.75); // antes fila 37
  });

  it('área de impresión extendida, una hoja, 2 imágenes y sin P/Q', async () => {
    const wb = await leer(buf2);
    expect(wb.worksheets.length).toBe(1);
    const ws = wb.getWorksheet('FACTURA')!;
    expect(ws.pageSetup.printArea).toBe('A1:N50');
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.fitToHeight).toBe(1);
    expect(ws.getImages().length).toBe(2);
    let con = 0;
    ws.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (c) => {
        if (Number(c.col) > 14&& c.value !== null && c.value !== '') con++;
      }),
    );
    expect(con).toBe(0);
  });

  it('rechaza más de 3 adicionales', async () => {
    const cuatro = [...adic2, ...adic2];
    await expect(generarFacturaXlsx({ ...base, adicionales: cuatro })).rejects.toThrow(/Máximo 3/);
  });
});

describe('casos de borde', () => {
  it('valor total 0 deja el % en 0 y fechas con febrero', async () => {
    const buf = await generarFacturaXlsx({ ...base, valorTotalContrato: 0, fechaCorte: '2026-02-28', fechaInicio: '2026-02-01', planillaMes: '2026-02' });
    const ws = (await leer(buf)).getWorksheet('FACTURA')!;
    expect(ws.getCell('K25').value).toBe(0);
    expect(ws.getCell('H11').value).toBe('28 de febrero de 2026');
    expect(ws.getCell('L28').value).toBe('Febrero');
  });
});

describe('compatibilidad con Excel', () => {
  // Excel exige dentro de <sheetPr> el orden tabColor, outlinePr, pageSetUpPr. ExcelJS escribe pageSetUpPr antes
  // de outlinePr y Excel pide "reparar" el archivo. Se valida con 0 y 3 adicionales.
  for (const adicionales of [[], [...adic2, { numero: '3333333333', mes: '2026-06', valor: 9000 }]]) {
    it(`sheetPr en el orden del esquema (${adicionales.length} adicionales)`, async () => {
      const zip = await JSZip.loadAsync(await generarFacturaXlsx({ ...base, adicionales }));
      const hoja = Object.keys(zip.files).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))!;
      const xml = await zip.file(hoja)!.async('string');
      const sheetPr = xml.match(/<sheetPr>[\s\S]*?<\/sheetPr>/)?.[0] ?? '';
      const orden = [...sheetPr.matchAll(/<(tabColor|outlinePr|pageSetUpPr)\b/g)].map((m) => m[1]);
      const esperado = ['tabColor', 'outlinePr', 'pageSetUpPr'].filter((t) => orden.includes(t));
      expect(orden).toEqual(esperado);
      expect(orden).toContain('pageSetUpPr'); // ajustar a 1 página sigue activo
    });
  }
});

describe('sin resaltados de la hoja de trabajo', () => {
  it('no deja rellenos lila ni verde (tampoco en las filas adicionales) ni formatos condicionales', async () => {
    for (const adicionales of [[], adic2]) {
      const ws = (await leer(await generarFacturaXlsx({ ...base, adicionales }))).getWorksheet('FACTURA')!;
      const pintadas: string[] = [];
      ws.eachRow({ includeEmpty: true }, (row) => row.eachCell({ includeEmpty: true }, (c) => {
        const f = c.fill as ExcelJS.FillPattern | undefined;
        const argb = f?.type === 'pattern' ? f.fgColor?.argb?.toUpperCase() : undefined;
        if (argb === 'FFCCCCFF' || argb === 'FF00FF00') pintadas.push(c.address);
      }));
      expect(pintadas).toEqual([]);
      expect((ws as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings ?? []).toHaveLength(0);
    }
  });
});

describe('nombreArchivoFactura', () => {
  it('arma el nombre y quita caracteres prohibidos', () => {
    expect(nombreArchivoFactura('202609', 'PRUEBA PÉREZ DE LA TORRE')).toBe('202609 - PRUEBA PÉREZ DE LA TORRE - Cuenta de cobro.xlsx');
    expect(nombreArchivoFactura('202609', 'A/B\\C:D*E?F"G<H>I|J#K%L')).toBe('202609 - ABCDEFGHIJKL - Cuenta de cobro.xlsx');
  });
});
