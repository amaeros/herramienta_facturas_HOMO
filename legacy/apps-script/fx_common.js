'use strict';
/**
 * fx_common.js - Piezas compartidas por test_parser.js y test_pdfjs.js:
 * carga de Parser.gs, selección de los PDF de /home/claude/fx, tabla de valores esperados y evaluación.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = process.env.FX_DIR || '/home/claude/fx';
// ---------- carga del parser ----------
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'Parser.gs'), 'utf8'), ctx, { filename: 'Parser.gs' });
const parse = vm.runInContext('parsePlanillaText', ctx);

// ---------- archivos ----------
const NAME_RE = /planilla|seguridad|comprobante|certificado pago|soporte/i;
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (NAME_RE.test(e.name)) out.push(p);
  }
  return out;
}
const all = walk(ROOT, []).sort();
const pdfs = all.filter(f => /\.pdf$/i.test(f));
const others = all.filter(f => !/\.pdf$/i.test(f));

function pdftotext(file, mode) {
  try { return execFileSync('pdftotext', ['-' + mode, file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }); }
  catch (e) { return ''; }
}

// ---------- expectativas ----------
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function monthOf(s) {
  s = strip(s).replace(/setiembre/, 'septiembre');
  for (let i = 0; i < 12; i++) if (s.includes(MESES[i])) return i + 1;
  return null;
}
const rel = f => path.relative(ROOT, f);
const owner = f => rel(f).split(path.sep)[0];
const base = f => path.basename(f);

// numero de planilla leido de los comprobantes (independiente del parser): clave / numero de factura
function comprobanteNumero(text) {
  const t = text.replace(/\s+/g, ' ');
  let m = t.match(/Clave planilla:\s*(\d{8,12})/i) || t.match(/con clave:?\s*(\d{8,12})/i) || t.match(/N[uú]mero de factura(?: Referencia \d)?\s*(\d{7,10})/i);
  return m ? m[1] : null;
}
const compCache = {};
function comprobanteNumeros(dir) {
  if (compCache[dir]) return compCache[dir];
  const res = [];
  for (const f of pdfs) {
    if (path.dirname(f) !== dir) continue;
    if (!/^(comprobante|certificado|soporte)/i.test(base(f))) continue;
    const num = comprobanteNumero(pdftotext(f, 'raw'));
    if (num) res.push({ file: f, num, month: monthOf(base(f)), ajuste: /adicional|ajuste/i.test(base(f)) });
  }
  return (compCache[dir] = res);
}

const LAURA_NUM = { 1: '83358879', 2: '83365278', 3: '84193613', 4: '84708107', 5: '85401370', 6: '86050187', 7: '86616708', 8: '87959084', 9: '87959091' };

function expected(f) {
  const n = base(f), o = owner(f), r = rel(f);
  const e = { kind: 'planilla', op: o };
  if (/^(comprobante|certificado|soporte)/i.test(n)) { e.kind = 'noplanilla'; return e; }
  if (/(resumidas|detalladas).*(correcciones|enero a abril)/i.test(n)) { e.kind = 'multi'; return e; }
  if (/ajuste arl/i.test(n)) { e.kind = 'correccion'; return e; }
  const dirFolder = path.basename(path.dirname(f));
  const m = monthOf(n) || monthOf(dirFolder);
  let year = 2026;
  if (o === 'ana' && /\/2025\//.test('/' + r)) year = 2025;
  if (o === 'erika' && m >= 10) year = 2025;
  e.periodo = m ? `${year}-${String(m).padStart(2, '0')}` : null;
  e.numSrc = 'formato';
  if (o === 'ana' && year === 2026) {
    e.salud = 358700; e.pension = 459200; e.arl = m <= 5 ? 15000 : 70000; e.ccf = m <= 5 ? 0 : 17300;
    if (m === 9) { e.numero = '9509633245'; e.numSrc = 'usuario'; }
  } else if (o === 'laura') {
    e.numero = LAURA_NUM[m]; e.numSrc = 'usuario';
    if (m === 1) { e.salud = 218900; e.pension = 280200; e.arl = 9200; }   // IBC 1.750.905 (valores impresos en el PDF)
    else { e.salud = 358700; e.pension = 459200; e.arl = m <= 4 ? 15000 : 70000; }
    e.ccf = 0;
  } else if (o === 'erika' && year === 2026 && m >= 2) {
    e.salud = 253200; e.pension = 324100; e.arl = m <= 5 ? 10600 : 49400; e.ccf = 0;
    if (m === 2) { e.numero = '9498601607'; e.numSrc = 'usuario'; }
    if (m === 9) { e.numero = '9510068982'; e.numSrc = 'usuario'; }
  }
  if (!e.numero && (o === 'ana' || o === 'erika')) {
    // numero verificado con el comprobante de la misma carpeta y mismo mes
    const cands = comprobanteNumeros(path.dirname(f)).filter(c => (c.month === m || c.month === null) && c.ajuste === false);
    if (cands.length === 1) { e.numero = cands[0].num; e.numSrc = 'comprobante'; }
  }
  e.hasValues = e.salud !== undefined;
  return e;
}

// ---------- evaluacion ----------
function fmt(v) { return v === null || v === undefined ? '-' : String(v); }
function evaluate(exp, r, hasText) {
  if (!hasText) return { res: 'SIN TEXTO', why: '' };
  const NP = 'no parece una planilla PILA';
  if (exp.kind === 'noplanilla') {
    const ok = r.confianza === 'baja' && r.notas.some(x => x.indexOf(NP) >= 0);
    return { res: ok ? 'OK' : 'FALLA', why: ok ? '' : 'debia ser baja + "' + NP + '" (conf=' + r.confianza + ')' };
  }
  if (exp.kind === 'multi' || exp.kind === 'correccion') {
    let ok = r.confianza === 'baja' && r.tipo === 'planilla';
    let why = ok ? '' : 'correccion: debia ser baja (conf=' + r.confianza + ', tipo=' + r.tipo + ')';
    if (exp.kind === 'multi') {   // 4 planillas de correccion (enero a abril) en un solo PDF
      const nums = (r.planillas || []).map(p => p.numero).join(',');
      if (nums !== '86361409,86361436,86361473,86361514') { ok = false; why += ' planillas detectadas: [' + nums + '] (esperadas 4: 86361409,86361436,86361473,86361514)'; }
    }
    return { res: ok ? 'OK(corr)' : 'FALLA', why };
  }
  const why = [];
  if (r.tipo !== 'planilla') why.push('tipo=' + r.tipo);
  if (exp.periodo && r.periodo !== exp.periodo) why.push(`periodo ${fmt(r.periodo)}!=${exp.periodo}`);
  if (exp.numero) { if (r.numero !== exp.numero) why.push(`numero ${fmt(r.numero)}!=${exp.numero}`); }
  else if (!(r.numero && /^\d{8,10}$/.test(r.numero))) why.push('numero ' + fmt(r.numero));
  if (exp.hasValues) {
    for (const k of ['salud', 'pension', 'arl']) if (r[k] !== exp[k]) why.push(`${k} ${fmt(r[k])}!=${exp[k]}`);
    if (r.ccf !== exp.ccf) why.push(`(ccf ${fmt(r.ccf)}!=${exp.ccf})`);
  } else {
    for (const k of ['salud', 'pension', 'arl']) if (r[k] === null) why.push(k + ' nulo');
  }
  const hard = why.filter(x => !x.startsWith('(ccf'));
  if (hard.length) return { res: 'FALLA', why: why.join('; ') };
  if (why.length) return { res: 'FALLA', why: why.join('; ') };
  if (!exp.hasValues) return { res: 'S/E', why: '' };
  if (r.confianza === 'baja') return { res: 'FALLA', why: 'valores correctos pero confianza baja' };
  return { res: 'OK', why: '' };
}

module.exports = { ROOT, parse, pdfs, others, pdftotext, expected, evaluate, rel, base, owner, fmt, monthOf };
