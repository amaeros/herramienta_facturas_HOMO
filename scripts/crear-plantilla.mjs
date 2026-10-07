// Genera src/assets/plantilla_factura.xlsx a partir de la plantilla original (privado/, ignorada por git).
//
// Qué hace:
//   - Deja SOLO la hoja FACTURA (formato oficial GJ-CO-FR-15 v02).
//   - Vacía todas las celdas variables (fórmulas y datos) y el contenido de las columnas P/Q (celdas auxiliares).
//   - Conserva estilos, combinaciones de celdas, anchos, alturas, configuración de impresión y las 2 imágenes.
//
// Nota técnica: el Excel original (hecho con openpyxl) trae rutas absolutas en sus relaciones y un
// dibujo sin prefijo de espacio de nombres, y ExcelJS no logra leerlo. Por eso se pre-procesa el zip:
// se quitan los dibujos/comentarios, se leen las imágenes y sus anclas a mano y se vuelven a agregar
// con workbook.addImage en las mismas posiciones.
//
// Uso:  node scripts/crear-plantilla.mjs

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';

const ORIGEN = path.resolve('privado', 'Centro_Control_HOMO_Google.xlsx');
const DESTINO = path.resolve('src', 'assets', 'plantilla_factura.xlsx');

// Celdas variables que se llenan al generar la factura (se dejan vacías en la plantilla).
const CELDAS_VARIABLES = [
  'B8', 'B10', 'B12', 'B14', 'B16', 'H8', 'H11', 'H14',
  'G21', 'L21', 'G22', 'L22', 'B25', 'K25', 'L25',
  'B28', 'G28', 'L28',
  'B38', 'B39', 'C42', 'G42', 'M42', 'C43', 'G43', 'M43',
];

if (!fs.existsSync(ORIGEN)) {
  console.error('No encuentro ' + ORIGEN);
  process.exit(1);
}

const zip = await JSZip.loadAsync(fs.readFileSync(ORIGEN));

// 1) Leer anclas e imágenes del dibujo de FACTURA (hoja 3) antes de quitarlo.
const dibujoXml = await zip.file('xl/drawings/drawing1.xml').async('string');
const imagenes = [];
for (const m of dibujoXml.matchAll(/<twoCellAnchor[^>]*>([\s\S]*?)<\/twoCellAnchor>/g)) {
  const bloque = m[1];
  const num = (tag, sub) => Number(new RegExp('<' + tag + '>[\\s\\S]*?<' + sub + '>(\\d+)</' + sub + '>').exec(bloque)[1]);
  const from = { nativeCol: num('from', 'col'), nativeColOff: num('from', 'colOff'), nativeRow: num('from', 'row'), nativeRowOff: num('from', 'rowOff') };
  const to = { nativeCol: num('to', 'col'), nativeColOff: num('to', 'colOff'), nativeRow: num('to', 'row'), nativeRowOff: num('to', 'rowOff') };
  const rid = /r:embed="(rId\d+)"/.exec(bloque)[1];
  imagenes.push({ rid, from, to });
}
const relsXml = await zip.file('xl/drawings/_rels/drawing1.xml.rels').async('string');
const objetivoPorRid = {};
for (const m of relsXml.matchAll(/Target="([^"]+)"\s+Id="(rId\d+)"/g)) objetivoPorRid[m[2]] = m[1].replace(/^\//, '');
const medios = [];
for (const im of imagenes) {
  const archivo = objetivoPorRid[im.rid];
  medios.push({ ...im, buffer: await zip.file(archivo).async('nodebuffer'), ext: path.extname(archivo).slice(1) });
}

// 2) Quitar del zip todo lo que ExcelJS no sabe leer (dibujos, comentarios) y los medios (se re-agregan).
let hoja3 = await zip.file('xl/worksheets/sheet3.xml').async('string');
hoja3 = hoja3.replace(new RegExp('<drawing [^>]*/>'), '');
zip.file('xl/worksheets/sheet3.xml', hoja3);
let hoja2 = await zip.file('xl/worksheets/sheet2.xml').async('string');
hoja2 = hoja2.replace(new RegExp('<legacyDrawing [^>]*/>'), '');
zip.file('xl/worksheets/sheet2.xml', hoja2);
for (const f of Object.keys(zip.files)) {
  if (/^xl\/(drawings|comments|media)\//.test(f) || /^xl\/worksheets\/_rels\//.test(f)) zip.remove(f);
}
const preparado = await zip.generateAsync({ type: 'nodebuffer' });

// 3) Cargar con ExcelJS, quedarse solo con FACTURA y limpiarla.
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(preparado);
for (const ws of [...wb.worksheets]) {
  if (ws.name !== 'FACTURA') wb.removeWorksheet(ws.id);
}
const ws = wb.getWorksheet('FACTURA');

for (const dir of CELDAS_VARIABLES) ws.getCell(dir).value = null;

// Columnas auxiliares (O en adelante, usadas en P/Q): fuera valores, fórmulas y celdas.
ws.eachRow({ includeEmpty: false }, (row) => {
  if (row.cellCount > 0 && row.actualCellCount > 0) row.splice(15, 50);
});

// Reglas de formato condicional rotas (#REF!) del original: se quitan.
ws.conditionalFormattings = ws.conditionalFormattings
  .map((cf) => ({ ...cf, rules: cf.rules.filter((r) => !(r.formulae || []).some((f) => String(f).includes('#REF!'))) }))
  .filter((cf) => cf.rules.length > 0);

// Que no quede ninguna fórmula en la hoja.
let formulas = 0;
ws.eachRow({ includeEmpty: false }, (row) =>
  row.eachCell({ includeEmpty: false }, (c) => {
    if (c.type === ExcelJS.ValueType.Formula) formulas++;
  }),
);
if (formulas > 0) {
  console.error('Quedaron ' + formulas + ' fórmulas en la hoja');
  process.exit(1);
}

// ExcelJS antepone "$" a cada extremo; con "A$1:N$48" queda $A$1:$N$48 (referencia absoluta completa).
ws.pageSetup.printArea = 'A$1:N$48';

// 4) Imágenes en las mismas posiciones del original.
for (const m of medios) {
  const id = wb.addImage({ buffer: m.buffer, extension: m.ext });
  ws.addImage(id, { tl: m.from, br: m.to, editAs: 'oneCell' });
}

wb.creator = 'Cuentas de cobro HOMO';
wb.lastModifiedBy = 'Cuentas de cobro HOMO';
wb.created = new Date(Date.UTC(2026, 0, 1));
wb.modified = new Date(Date.UTC(2026, 0, 1));
wb.title = 'Documento equivalente a la factura GJ-CO-FR-15 v02';

fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
await wb.xlsx.writeFile(DESTINO);
console.log('Plantilla escrita en ' + DESTINO + ' (' + fs.statSync(DESTINO).size + ' bytes, ' + medios.length + ' imágenes)');
