#!/usr/bin/env node
/**
 * test_pdfjs.js - Prueba la extracción de texto con pdf.js (la misma lógica que corre en el navegador, Index.html)
 * sobre TODOS los PDF de planillas de /home/claude/fx y pasa el texto por parsePlanillaText.
 *
 * Instalación (una vez, NO en la raíz del proyecto):   cd work && npm i pdfjs-dist@3.11.174
 * Uso:   node test_pdfjs.js           resumen por operador + fallas
 *        node test_pdfjs.js --all     además, tabla completa
 *        node test_pdfjs.js --dump    guarda el texto de pdf.js de cada PDF en work/pdfjs_txt/
 *
 * Fidelidad: las funciones unirItemsPdf y extraerTextoPdf NO se reescriben aquí: se extrae del Index.html el bloque
 * entre "// BEGIN-PDFJS" y "// END-PDFJS" y se ejecuta tal cual, con el build "legacy" de pdf.js para node.
 * Criterio de aciertos: idéntico a test_parser.js (tabla de esperados en fx_common.js) y se compara con pdftotext.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parse, pdfs, others, pdftotext, expected, evaluate, rel, fmt } = require('./fx_common');

const args = process.argv.slice(2);
const SHOW_ALL = args.includes('--all');
const DUMP = args.includes('--dump');

let pdfjsLib;
// PDFJS_MODULES: carpeta node_modules fuera del proyecto (útil si el proyecto está en OneDrive y no se quiere sincronizar node_modules)
try { pdfjsLib = require(path.join(process.env.PDFJS_MODULES || path.join(__dirname, 'work', 'node_modules'), 'pdfjs-dist', 'legacy', 'build', 'pdf.js')); }
catch (e) {
  console.log('FALLA: falta pdfjs-dist. Instala con:  cd ' + path.join(__dirname, 'work') + ' && npm i pdfjs-dist@3.11.174');
  process.exit(1);
}
if (pdfjsLib.version !== '3.11.174') console.log('AVISO: pdfjs-dist ' + pdfjsLib.version + ' (en el navegador se usa 3.11.174)');

// --- código REAL del navegador ---
const html = fs.readFileSync(path.join(__dirname, 'Index.html'), 'utf8');
const bm = /\/\/ BEGIN-PDFJS[^\n]*\n([\s\S]*?)\/\/ END-PDFJS/.exec(html);
if (!bm) { console.log('FALLA: no se encontró el bloque BEGIN-PDFJS / END-PDFJS en Index.html'); process.exit(1); }
const factory = new Function('pdfjsLib', bm[1] + '\nreturn { unirItemsPdf: unirItemsPdf, extraerTextoPdf: extraerTextoPdf };');
const { extraerTextoPdf } = factory(pdfjsLib);

const pad = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length); };
const KEYS = ['numero', 'periodo', 'salud', 'pension', 'arl', 'ccf', 'tipo', 'confianza'];

(async function main() {
  if (DUMP) fs.mkdirSync(path.join(__dirname, 'work', 'pdfjs_txt'), { recursive: true });
  const rows = [];
  for (const f of pdfs) {
    const buf = fs.readFileSync(f);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const t0 = Date.now();
    const texto = await extraerTextoPdf(ab);
    const ms = Date.now() - t0;
    if (DUMP) fs.writeFileSync(path.join(__dirname, 'work', 'pdfjs_txt', rel(f).replace(/[\/ ]+/g, '_') + '.txt'), texto);
    const hasText = texto.replace(/[^A-Za-z0-9]/g, '').length >= 40;
    const exp = expected(f);
    const r = parse(texto);
    const ev = evaluate(exp, r, hasText);
    const ref = parse(pdftotext(f, 'layout'));
    const dif = hasText ? KEYS.filter(k => r[k] !== ref[k]) : [];
    rows.push({ f, exp, r, ev, hasText, ms, dif, ref, len: texto.length });
  }

  console.log('PDF probados: ' + pdfs.length + (others.length ? ' (imágenes omitidas: ' + others.length + ')' : '') + '  | pdfjs-dist ' + pdfjsLib.version);
  if (SHOW_ALL) {
    console.log(pad('archivo', 52) + pad('tipo', 12) + pad('numero', 11) + pad('periodo', 8) + pad('salud', 8) + pad('pension', 8) + pad('arl', 7) + pad('conf', 6) + pad('ms', 6) + 'resultado');
    console.log('-'.repeat(140));
    for (const x of rows) {
      const r = x.r;
      console.log(pad(rel(x.f).replace('GESTION DE PAGO/', ''), 52) + pad(x.hasText ? r.tipo : 'sin texto', 12) + pad(fmt(r.numero), 11) + pad(fmt(r.periodo), 8) +
        pad(fmt(r.salud), 8) + pad(fmt(r.pension), 8) + pad(fmt(r.arl), 7) + pad(x.hasText ? r.confianza : '-', 6) + pad(x.ms, 6) + x.ev.res + (x.ev.why ? '  <- ' + x.ev.why : ''));
    }
  }

  // --- resumen por operador ---
  const grupos = { 'Aportes en Línea (Ana)': 'ana', 'Enlace Operativo (Laura)': 'laura', 'Aportes en Línea (Erika)': 'erika' };
  console.log('\n===== RESUMEN pdf.js =====');
  let totOk = 0, totN = 0;
  for (const [g, op] of Object.entries(grupos)) {
    const G = rows.filter(x => x.exp.op === op);
    const conValores = G.filter(x => x.exp.kind === 'planilla' && x.hasText && x.exp.hasValues);
    const ok = conValores.filter(x => x.ev.res === 'OK').length;
    const sinEsp = G.filter(x => x.exp.kind === 'planilla' && x.hasText && !x.exp.hasValues);
    const sinEspOk = sinEsp.filter(x => x.ev.res === 'S/E').length;
    const np = G.filter(x => x.exp.kind === 'noplanilla' && x.hasText);
    const npOk = np.filter(x => x.ev.res === 'OK').length;
    const co = G.filter(x => (x.exp.kind === 'correccion' || x.exp.kind === 'multi') && x.hasText);
    const coOk = co.filter(x => x.ev.res.startsWith('OK')).length;
    const st = G.filter(x => !x.hasText).length;
    totOk += ok; totN += conValores.length;
    console.log('  ' + pad(g, 26) + 'con esperado ' + ok + '/' + conValores.length + ' | sin esperado (lectura coherente) ' + sinEspOk + '/' + sinEsp.length +
      ' | comprobantes->baja ' + npOk + '/' + np.length + ' | correcciones->baja ' + coOk + '/' + co.length + ' | sin texto ' + st);
  }
  console.log('  TOTAL planillas con texto y valores esperados: ' + totOk + '/' + totN + ' (' + (totN ? (100 * totOk / totN).toFixed(1) : '-') + ' %)');

  // --- fallas y diferencias contra pdftotext -layout ---
  const fails = rows.filter(x => x.ev.res === 'FALLA');
  console.log(fails.length ? '-- FALLAS (' + fails.length + ')' : '-- sin fallas');
  fails.forEach(x => console.log('  ' + rel(x.f) + '  <- ' + x.ev.why));
  const difs = rows.filter(x => x.dif.length);
  console.log('Archivos con resultado distinto al de pdftotext -layout: ' + difs.length);
  difs.forEach(x => console.log('  ' + rel(x.f) + ' -> ' + x.dif.map(k => k + ': pdfjs=' + fmt(x.r[k]) + ' | pdftotext=' + fmt(x.ref[k])).join('; ')));
  const vacios = rows.filter(x => !x.hasText);
  console.log('PDF sin capa de texto (escaneados, irían a OCR): ' + vacios.length + (vacios.length ? '  [' + vacios.map(x => path.basename(x.f)).join(', ') + ']' : ''));
  console.log('Tiempo medio por PDF: ' + Math.round(rows.reduce((a, x) => a + x.ms, 0) / rows.length) + ' ms');

  const mal = fails.length + (totOk === totN ? 0 : 1);
  console.log(mal ? '\nResultado: HAY FALLAS' : '\nResultado: todas correctas (' + totOk + '/' + totN + ' con valores esperados, mismo criterio que test_parser.js)');
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error('Error inesperado: ' + (e && e.stack || e)); process.exit(2); });
