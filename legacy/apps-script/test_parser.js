#!/usr/bin/env node
/**
 * test_parser.js - Prueba de Parser.gs contra los PDF reales de /home/claude/fx
 *
 * Uso:
 *   node test_parser.js            tabla completa + resumen
 *   node test_parser.js --fail     solo filas que fallan (+ resumen)
 *   node test_parser.js --extra    ademas, variantes de texto (una linea, un token por linea, espacios ruidosos)
 *   node test_parser.js --ocr      ademas, prueba 2 PDF escaneados con pdftoppm + tesseract
 *
 * Carga Parser.gs con vm (sin require/import dentro del parser), extrae el texto de cada PDF con
 * `pdftotext -raw` y `pdftotext -layout`, y compara con los valores esperados cuando se conocen.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { ROOT, parse, pdfs, others, pdftotext, expected, evaluate, rel, base, fmt } = require('./fx_common');

const args = process.argv.slice(2);
const ONLY_FAIL = args.includes('--fail');
const EXTRA = args.includes('--extra');
const OCR = args.includes('--ocr');

// ---------- variantes de texto ----------
const VARIANTS = {
  raw: t => t,
  layout: t => t,
};
const EXTRA_VARIANTS = {
  'una-linea': t => t.replace(/\s+/g, ' '),
  'token-por-linea': t => t.split(/\s+/).join('\n'),
  'ruidoso': t => t.replace(/ /g, '  ').replace(/\n/g, '\n\n').replace(/\$ ?/g, '$ '),
  'sin-saltos-de-pagina': t => t.replace(/\f/g, '\n'),
  'miles-con-punto': t => t.replace(/(?<=\d),(?=\d{3})/g, '.'),
  'crlf-tabs': t => t.replace(/\n/g, '\r\n').replace(/ (?=\$)/g, '\t'),
};

// ---------- casos limite ----------
(function edgeCases() {
  const bad = [];
  const chk = (name, cond) => { if (!cond) bad.push(name); };
  for (const v of ['', null, undefined, '   \n  ', 'hola', 42]) {
    const r = parse(v);
    chk('entrada ' + JSON.stringify(v) + ' -> baja', r && r.confianza === 'baja' && Array.isArray(r.notas) && r.notas.length > 0 && r.salud === null);
  }
  const r = parse('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore');
  chk('texto cualquiera -> baja', r.confianza === 'baja' && r.tipo === 'otro');
  // texto REAL que devolvio el OCR de Google en produccion (numeros partidos, columnas mezcladas):
  // no debe dar confianza alta ni tomar el telefono (3006644433) como numero de planilla
  try {
    const g = parse(fs.readFileSync(path.join(__dirname, 'work', 'ocr_google_real.txt'), 'utf8'));
    chk('ocr_google_real -> confianza baja (conf=' + g.confianza + ')', g.confianza === 'baja');
    chk('ocr_google_real -> numero null (numero=' + g.numero + ')', g.numero === null);
  } catch (e) { bad.push('ocr_google_real: no se pudo leer work/ocr_google_real.txt (' + e.message + ')'); }
  for (const t of ['AUTOLIQUIDACION CONSOLIDADA\nDETALLE DEL APORTANTE\nTelefono\n3006644433\nseptiembre de 2026 Periodo Cotizacion:',
    'DETALLE DEL APORTANTE Telefono 3216549870 Direccion CL 1 AUTOLIQUIDACION CONSOLIDADA septiembre de 2026']) {
    chk('telefono nunca es numero de planilla', parse(t).numero !== '3006644433' && parse(t).numero !== '3216549870');
  }
  console.log('Casos limite: ' + (bad.length ? 'FALLAN ' + bad.join('; ') : 'OK (entradas vacias/nulas/ajenas devuelven baja sin lanzar error)'));
})();

// ---------- ejecucion ----------
const pad = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length); };
const rows = [];
const cache = new Map();
function getText(f, mode) {
  const k = f + '|' + mode;
  if (!cache.has(k)) cache.set(k, pdftotext(f, mode));
  return cache.get(k);
}

function run(variantName, transform, src) {
  const out = [];
  for (const f of pdfs) {
    const text = transform(getText(f, src));
    const hasText = text.replace(/[^A-Za-z0-9]/g, '').length >= 40;
    const exp = expected(f);
    const t0 = Date.now();
    const r = parse(text);
    const ms = Date.now() - t0;
    const ev = evaluate(exp, r, hasText);
    out.push({ f, mode: variantName, exp, r, ev, hasText, ms });
  }
  return out;
}

const results = [];
results.push(...run('raw', VARIANTS.raw, 'raw'));
results.push(...run('layout', VARIANTS.layout, 'layout'));

console.log('Archivos PDF: ' + pdfs.length + (others.length ? ' (imagenes omitidas: ' + others.map(rel).join(', ') + ')' : ''));
console.log(pad('archivo', 52) + pad('modo', 7) + pad('tipo', 12) + pad('numero', 11) + pad('periodo', 8) + pad('salud', 8) + pad('pension', 8) + pad('arl', 7) + pad('ccf', 7) + pad('conf', 6) + 'resultado');
console.log('-'.repeat(150));
for (const x of results) {
  if (ONLY_FAIL && !(x.ev.res === 'FALLA')) continue;
  const r = x.r;
  const tipo = x.hasText ? r.tipo : 'sin texto';
  console.log(pad(rel(x.f).replace('GESTION DE PAGO/', ''), 52) + pad(x.mode, 7) + pad(tipo, 12) + pad(fmt(r.numero), 11) + pad(fmt(r.periodo), 8) +
    pad(fmt(r.salud), 8) + pad(fmt(r.pension), 8) + pad(fmt(r.arl), 7) + pad(fmt(r.ccf), 7) + pad(x.hasText ? r.confianza : '-', 6) +
    x.ev.res + (x.ev.why ? '  <- ' + x.ev.why : ''));
}

// ---------- resumen ----------
function summarize(list, title) {
  const groups = {
    'Aportes en Linea (Ana)': x => x.exp.op === 'ana',
    'Enlace Operativo (Laura)': x => x.exp.op === 'laura',
    'Aportes en Linea (Erika)': x => x.exp.op === 'erika',
  };
  console.log('\n===== ' + title + ' =====');
  for (const mode of [...new Set(list.map(x => x.mode))]) {
    const L = list.filter(x => x.mode === mode);
    console.log('-- modo ' + mode);
    for (const [gname, gf] of Object.entries(groups)) {
      const G = L.filter(gf);
      const pl = G.filter(x => x.exp.kind === 'planilla' && x.hasText);
      const withExp = pl.filter(x => x.exp.hasValues);
      const okExp = withExp.filter(x => x.ev.res === 'OK').length;
      const se = pl.filter(x => !x.exp.hasValues);
      const seOk = se.filter(x => x.ev.res === 'S/E').length;
      const np = G.filter(x => x.exp.kind === 'noplanilla' && x.hasText);
      const npOk = np.filter(x => x.ev.res === 'OK').length;
      const co = G.filter(x => (x.exp.kind === 'correccion' || x.exp.kind === 'multi') && x.hasText);
      const coOk = co.filter(x => x.ev.res.startsWith('OK')).length;
      const st = G.filter(x => !x.hasText).length;
      console.log('  ' + pad(gname, 26) + `planillas con esperado: ${okExp}/${withExp.length}` +
        `  | sin valor esperado (lectura completa y coherente): ${seOk}/${se.length}` +
        `  | comprobantes/certificados -> baja: ${npOk}/${np.length}` +
        `  | correcciones/multiples -> baja: ${coOk}/${co.length}` + `  | sin texto: ${st}`);
    }
    const src = {};
    L.filter(x => x.exp.kind === 'planilla' && x.hasText).forEach(x => { const k = x.exp.numero ? x.exp.numSrc : 'solo formato'; src[k] = (src[k] || 0) + 1; });
    console.log('  numero de planilla verificado contra: ' + Object.entries(src).map(([k, v]) => k + '=' + v).join(', '));
    const allPl = L.filter(x => x.exp.kind === 'planilla' && x.hasText && x.exp.hasValues);
    const okAll = allPl.filter(x => x.ev.res === 'OK').length;
    console.log('  TOTAL planillas con texto y valores esperados: ' + okAll + '/' + allPl.length + ' (' + (allPl.length ? (100 * okAll / allPl.length).toFixed(1) : '-') + ' %)');
  }
  const fails = list.filter(x => x.ev.res === 'FALLA');
  if (fails.length) {
    console.log('-- FALLAS (' + fails.length + ')');
    for (const x of fails) console.log('  [' + x.mode + '] ' + rel(x.f) + '  <- ' + x.ev.why);
  } else console.log('-- sin fallas');
}
summarize(results, 'RESUMEN pdftotext -raw / -layout');

// ambos modos coinciden?
let diffs = 0;
for (const f of pdfs) {
  const a = results.find(x => x.f === f && x.mode === 'raw').r, b = results.find(x => x.f === f && x.mode === 'layout').r;
  const keys = ['numero', 'periodo', 'salud', 'pension', 'arl', 'ccf', 'mora', 'total', 'ibc', 'dias', 'tarifaArl', 'confianza', 'tipo'];
  const d = keys.filter(k => a[k] !== b[k]);
  if (d.length) { diffs++; console.log('DIFERENCIA raw vs layout: ' + rel(f) + ' -> ' + d.map(k => `${k}: ${fmt(a[k])} | ${fmt(b[k])}`).join('; ')); }
}
console.log('Archivos con diferencias entre raw y layout: ' + diffs);

// campos extra: ibc, dias, tarifa, mora (solo planillas con texto)
console.log('\n===== Campos extra (layout): ibc / dias / tarifaArl / mora / total =====');
for (const x of results.filter(x => x.mode === 'layout' && x.hasText && x.r.tipo === 'planilla')) {
  console.log(pad(rel(x.f).replace('GESTION DE PAGO/', ''), 62) + ' ibc=' + pad(fmt(x.r.ibc), 9) + ' dias=' + pad(fmt(x.r.dias), 4) + ' tarifa=' + pad(fmt(x.r.tarifaArl), 8) + ' mora=' + pad(fmt(x.r.mora), 6) + ' total=' + pad(fmt(x.r.total), 8) + ' conf=' + x.r.confianza);
}

// ---------- variantes adicionales ----------
if (EXTRA) {
  const ex = [];
  for (const [name, fn] of Object.entries(EXTRA_VARIANTS)) {
    ex.push(...run(name, fn, 'raw'));
    ex.push(...run(name + '+layout', fn, 'layout'));
  }
  summarize(ex, 'VARIANTES DE TEXTO (robustez ante OCR)');
}

// ---------- OCR aproximado de 2 PDF escaneados ----------
if (OCR) {
  console.log('\n===== OCR aproximado (pdftoppm -r 200 + tesseract -l eng) =====');
  const scanned = results.filter(x => x.mode === 'raw' && !x.hasText).map(x => x.f)
    .filter(f => /planilla/i.test(base(f))).slice(0, 2);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
  for (const f of scanned) {
    try {
      const prefix = path.join(tmp, 'p' + Math.abs(Buffer.from(f).reduce((a, b) => a + b, 0)));
      execFileSync('pdftoppm', ['-r', '200', '-png', f, prefix]);
      const pngs = fs.readdirSync(tmp).filter(n => n.startsWith(path.basename(prefix)) && n.endsWith('.png')).sort();
      let text = '';
      for (const p of pngs) {
        const img = path.join(tmp, p);
        // orientacion (algunos escaneos vienen girados): tesseract --psm 0 -> Rotate: N
        try {
          const osd = execFileSync('tesseract', [img, 'stdout', '--psm', '0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          const rot = (osd.match(/Rotate:\s*(\d+)/) || [])[1];
          if (rot && rot !== '0') execFileSync('convert', [img, '-rotate', rot, img]);
        } catch (e) { /* sin OSD: se lee tal cual */ }
        text += execFileSync('tesseract', [img, 'stdout', '-l', 'eng', '--psm', '6'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) + '\f';
      }
      const r = parse(text);
      console.log(rel(f));
      console.log('  -> tipo=' + r.tipo + ' numero=' + fmt(r.numero) + ' periodo=' + fmt(r.periodo) + ' salud=' + fmt(r.salud) + ' pension=' + fmt(r.pension) + ' arl=' + fmt(r.arl) + ' ccf=' + fmt(r.ccf) + ' conf=' + r.confianza);
      console.log('  notas: ' + r.notas.join(' | '));
      fs.writeFileSync(path.join(os.tmpdir(), 'ocr_' + path.basename(f, '.pdf').replace(/\W+/g, '_') + '.txt'), text);
    } catch (e) { console.log(rel(f) + ' -> error OCR: ' + e.message); }
  }
}
