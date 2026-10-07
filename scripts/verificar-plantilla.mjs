// Verifica que un .xlsx (por defecto src/assets/plantilla_factura.xlsx) NO contenga datos personales.
// Carga del original (privado/) las cédulas, teléfonos, direcciones y nombres de la hoja CONTRATOS
// y los busca en TODO el contenido del zip. Solo imprime valores enmascarados.
//
// Uso:  node scripts/verificar-plantilla.mjs [archivo.xlsx]

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';

const ORIGEN = path.resolve('privado', 'Centro_Control_HOMO_Google.xlsx');
const OBJETIVO = path.resolve(process.argv[2] || path.join('src', 'assets', 'plantilla_factura.xlsx'));

const enmascarar = (s) => {
  const t = String(s);
  if (t.length <= 4) return '*'.repeat(t.length);
  return t.slice(0, 2) + '*'.repeat(t.length - 4) + t.slice(-2);
};

// --- Sensibles desde CONTRATOS ---
const zo = await JSZip.loadAsync(fs.readFileSync(ORIGEN));
for (const f of Object.keys(zo.files)) {
  if (/^xl\/(drawings|comments|media)\//.test(f) || /^xl\/worksheets\/_rels\//.test(f)) zo.remove(f);
}
for (const hoja of ['sheet2', 'sheet3']) {
  let x = await zo.file('xl/worksheets/' + hoja + '.xml').async('string');
  x = x.replace(new RegExp('<(drawing|legacyDrawing) [^>]*/>', 'g'), '');
  zo.file('xl/worksheets/' + hoja + '.xml', x);
}
const wbo = new ExcelJS.Workbook();
await wbo.xlsx.load(await zo.generateAsync({ type: 'nodebuffer' }));
const contratos = wbo.getWorksheet('CONTRATOS');

const sensibles = new Map(); // valor -> etiqueta
const conPuntos = (d) => d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
contratos.eachRow({ includeEmpty: false }, (row, r) => {
  if (r === 1) return;
  row.eachCell({ includeEmpty: false }, (c) => {
    let v = c.value;
    if (v && typeof v === 'object' && 'result' in v) v = v.result;
    if (v === null || v === undefined || v === '') return;
    const s = String(v).trim();
    const col = c.col;
    if (/^\d{7,}$/.test(s)) {
      sensibles.set(s, 'número fila ' + r + ' col ' + col);
      sensibles.set(conPuntos(s), 'número con puntos fila ' + r);
    } else if (typeof v === 'string' && col <= 5 && s.length >= 6) {
      sensibles.set(s, 'texto fila ' + r + ' col ' + col); // nombre, dirección, ciudad...
    }
  });
});
// Ciudades y textos muy comunes no cuentan como "dato personal" por sí solos.
for (const comun of ['Medellín', 'Medellin', 'Antioquia']) sensibles.delete(comun);

// --- Revisar el objetivo ---
const zt = await JSZip.loadAsync(fs.readFileSync(OBJETIVO));
const nombres = Object.keys(zt.files).filter((f) => !zt.files[f].dir);
console.log('Archivos en el zip: ' + nombres.join(', '));

let hallazgos = 0;
for (const f of nombres) {
  if (/\.(png|jpe?g|gif)$/i.test(f)) continue;
  const texto = await zt.file(f).async('string');
  for (const [valor, etiqueta] of sensibles) {
    if (texto.includes(valor)) {
      hallazgos++;
      console.log('  HALLAZGO en ' + f + ': ' + enmascarar(valor) + ' (' + etiqueta + ')');
    }
  }
}

const wbt = new ExcelJS.Workbook();
await wbt.xlsx.readFile(OBJETIVO);
console.log('Hojas: ' + wbt.worksheets.map((w) => w.name).join(', '));
const dn = (wbt.definedNames && wbt.definedNames.model) || [];
console.log('Nombres definidos: ' + JSON.stringify(dn));
const wbxml = await zt.file('xl/workbook.xml').async('string');
console.log('workbook.xml definedName: ' + (wbxml.match(/<definedName[\s\S]*?<\/definedName>/g) || []).join(' '));
const refs = ['PANEL', 'CARGA', 'CONTRATOS', 'PARAMETROS', '#REF!'].filter((n) => nombres.some((f) => false) || wbxml.includes(n));
console.log('Referencias a hojas borradas en workbook.xml: ' + (refs.length ? refs.join(', ') : 'ninguna'));
console.log('sharedStrings.xml: ' + (zt.file('xl/sharedStrings.xml') ? 'presente (revisado arriba)' : 'no existe'));
console.log('Valores sensibles buscados: ' + sensibles.size + ' (ej. ' + [...sensibles.keys()].slice(0, 3).map(enmascarar).join(', ') + ')');
console.log(hallazgos === 0 ? 'RESULTADO: LIMPIO, sin datos personales.' : 'RESULTADO: ' + hallazgos + ' HALLAZGOS.');
process.exit(hallazgos === 0 ? 0 : 1);
