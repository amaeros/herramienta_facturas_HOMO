/* eslint-disable */
/**
 * Prueba del lector de planillas contra PDFs REALES (fuera del repo).
 * Replica legacy/apps-script/test_pdfjs.js + fx_common.js:
 *   texto con pdf.js (build legacy de node) via src/lib/pdfText.ts  ->  parsePlanillaText  ->  tabla de esperados.
 *
 * Se ejecuta solo si existe FX_DIR (carpeta con subcarpetas ana/, laura/, erika/).
 *   PowerShell:  $env:FX_DIR="C:\Users\EQUIPO\Downloads\planillas_homo"; npx vitest run
 * Sin FX_DIR se omite (CI sin los PDFs). NUNCA copiar PDFs al repo ni imprimir cedulas / telefonos.
 *
 * Diferencia con el legacy: fx_common.js usaba `pdftotext` (poppler) para leer el n.º de los comprobantes
 * del banco; aqui se lee con el mismo texto de pdf.js.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parsePlanillaText } from '../parser';
import { extraerTextoPdf } from '../pdfText';

const ROOT = process.env.FX_DIR || '';
const require = createRequire(import.meta.url);

// ---------- archivos ----------
const NAME_RE = /planilla|seguridad|comprobante|certificado pago|soporte/i;
function walk(dir: string, out: string[]): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (NAME_RE.test(e.name)) out.push(p);
  }
  return out;
}
const all: string[] = ROOT && fs.existsSync(ROOT) ? walk(ROOT, []).sort() : [];
const pdfs = all.filter(f => /\.pdf$/i.test(f));

// ---------- texto con pdf.js (con cache) ----------
let pdfjsLib: any = null;
function getPdfjs() {
  if (!pdfjsLib) pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  return pdfjsLib;
}
const textCache = new Map<string, Promise<string>>();
function textoDe(f: string): Promise<string> {
  let p = textCache.get(f);
  if (!p) {
    const buf = fs.readFileSync(f);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    p = extraerTextoPdf(getPdfjs(), ab);
    textCache.set(f, p);
  }
  return p;
}

// ---------- expectativas (tabla de fx_common.js) ----------
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function monthOf(s: string): number | null {
  s = strip(s).replace(/setiembre/, 'septiembre');
  for (let i = 0; i < 12; i++) if (s.includes(MESES[i])) return i + 1;
  return null;
}
const rel = (f: string) => path.relative(ROOT, f);
const owner = (f: string) => rel(f).split(path.sep)[0];
const base = (f: string) => path.basename(f);
/** Nombre para mostrar: sin secuencias largas de digitos (n.º de planilla / referencias). */
const nombreSeguro = (f: string) => rel(f).replace(/\d{7,}/g, '#');

// numero de planilla leido de los comprobantes (independiente del parser): clave / numero de factura
function comprobanteNumero(text: string): string | null {
  const t = text.replace(/\s+/g, ' ');
  const m = t.match(/Clave planilla:\s*(\d{8,12})/i) || t.match(/con clave:?\s*(\d{8,12})/i) || t.match(/N[uú]mero de factura(?: Referencia \d)?\s*(\d{7,10})/i);
  return m ? m[1] : null;
}
const compCache = new Map<string, Promise<Array<{ file: string; num: string; month: number | null; ajuste: boolean }>>>();
function comprobanteNumeros(dir: string) {
  let p = compCache.get(dir);
  if (!p) {
    p = (async () => {
      const res: Array<{ file: string; num: string; month: number | null; ajuste: boolean }> = [];
      for (const f of pdfs) {
        if (path.dirname(f) !== dir) continue;
        if (!/^(comprobante|certificado|soporte)/i.test(base(f))) continue;
        const num = comprobanteNumero(await textoDe(f));
        if (num) res.push({ file: f, num, month: monthOf(base(f)), ajuste: /adicional|ajuste/i.test(base(f)) });
      }
      return res;
    })();
    compCache.set(dir, p);
  }
  return p;
}

// n.º de planilla de Laura por mes (confirmados por el usuario)
const LAURA_NUM: Record<number, string> = { 1: '83358879', 2: '83365278', 3: '84193613', 4: '84708107', 5: '85401370', 6: '86050187', 7: '86616708', 8: '87959084', 9: '87959091' };

interface Esperado {
  kind: 'planilla' | 'noplanilla' | 'multi' | 'correccion';
  op: string;
  periodo?: string | null;
  numSrc?: string;
  numero?: string;
  salud?: number; pension?: number; arl?: number; ccf?: number;
  hasValues?: boolean;
}

async function expected(f: string): Promise<Esperado> {
  const n = base(f), o = owner(f), r = rel(f);
  const e: Esperado = { kind: 'planilla', op: o };
  if (/^(comprobante|certificado|soporte)/i.test(n)) { e.kind = 'noplanilla'; return e; }
  if (/(resumidas|detalladas).*(correcciones|enero a abril)/i.test(n)) { e.kind = 'multi'; return e; }
  if (/ajuste arl/i.test(n)) { e.kind = 'correccion'; return e; }
  const dirFolder = path.basename(path.dirname(f));
  const m = monthOf(n) || monthOf(dirFolder);
  let year = 2026;
  if (o === 'ana' && /\/2025\//.test('/' + r.replace(/\\/g, '/'))) year = 2025;
  if (o === 'erika' && (m as number) >= 10) year = 2025;
  e.periodo = m ? `${year}-${String(m).padStart(2, '0')}` : null;
  e.numSrc = 'formato';
  const mm = m as number;
  if (o === 'ana' && year === 2026) {
    e.salud = 358700; e.pension = 459200; e.arl = mm <= 5 ? 15000 : 70000; e.ccf = mm <= 5 ? 0 : 17300;
    if (mm === 9) { e.numero = '9509633245'; e.numSrc = 'usuario'; }
  } else if (o === 'laura') {
    e.numero = LAURA_NUM[mm]; e.numSrc = 'usuario';
    if (mm === 1) { e.salud = 218900; e.pension = 280200; e.arl = 9200; }   // IBC 1.750.905 (valores impresos en el PDF)
    else { e.salud = 358700; e.pension = 459200; e.arl = mm <= 4 ? 15000 : 70000; }
    e.ccf = 0;
  } else if (o === 'erika' && year === 2026 && mm >= 2) {
    e.salud = 253200; e.pension = 324100; e.arl = mm <= 5 ? 10600 : 49400; e.ccf = 0;
    if (mm === 2) { e.numero = '9498601607'; e.numSrc = 'usuario'; }
    if (mm === 9) { e.numero = '9510068982'; e.numSrc = 'usuario'; }
  }
  if (!e.numero && (o === 'ana' || o === 'erika')) {
    // numero verificado con el comprobante de la misma carpeta y mismo mes
    const cands = (await comprobanteNumeros(path.dirname(f))).filter(c => (c.month === m || c.month === null) && c.ajuste === false);
    if (cands.length === 1) { e.numero = cands[0].num; e.numSrc = 'comprobante'; }
  }
  e.hasValues = e.salud !== undefined;
  return e;
}

// ---------- evaluacion ----------
const fmt = (v: unknown) => v === null || v === undefined ? '-' : String(v);
function evaluate(exp: Esperado, r: any, hasText: boolean): { res: string; why: string } {
  if (!hasText) return { res: 'SIN TEXTO', why: '' };
  const NP = 'no parece una planilla PILA';
  if (exp.kind === 'noplanilla') {
    const ok = r.confianza === 'baja' && r.notas.some((x: string) => x.indexOf(NP) >= 0);
    return { res: ok ? 'OK' : 'FALLA', why: ok ? '' : 'debia ser baja + "' + NP + '" (conf=' + r.confianza + ')' };
  }
  if (exp.kind === 'multi' || exp.kind === 'correccion') {
    let ok = r.confianza === 'baja' && r.tipo === 'planilla';
    let why = ok ? '' : 'correccion: debia ser baja (conf=' + r.confianza + ', tipo=' + r.tipo + ')';
    if (exp.kind === 'multi') {   // 4 planillas de correccion (enero a abril) en un solo PDF
      const nums = (r.planillas || []).map((p: any) => p.numero).join(',');
      if (nums !== '86361409,86361436,86361473,86361514') { ok = false; why += ' planillas detectadas: [' + nums + '] (esperadas 4: 86361409,86361436,86361473,86361514)'; }
    }
    return { res: ok ? 'OK(corr)' : 'FALLA', why };
  }
  const why: string[] = [];
  if (r.tipo !== 'planilla') why.push('tipo=' + r.tipo);
  if (exp.periodo && r.periodo !== exp.periodo) why.push(`periodo ${fmt(r.periodo)}!=${exp.periodo}`);
  if (exp.numero) { if (r.numero !== exp.numero) why.push(`numero ${fmt(r.numero)}!=${exp.numero}`); }
  else if (!(r.numero && /^\d{8,10}$/.test(r.numero))) why.push('numero ' + fmt(r.numero));
  if (exp.hasValues) {
    for (const k of ['salud', 'pension', 'arl'] as const) if (r[k] !== exp[k]) why.push(`${k} ${fmt(r[k])}!=${exp[k]}`);
    if (r.ccf !== exp.ccf) why.push(`(ccf ${fmt(r.ccf)}!=${exp.ccf})`);
  } else {
    for (const k of ['salud', 'pension', 'arl']) if (r[k] === null) why.push(k + ' nulo');
  }
  if (why.length) return { res: 'FALLA', why: why.join('; ') };
  if (!exp.hasValues) return { res: 'S/E', why: '' };
  if (r.confianza === 'baja') return { res: 'FALLA', why: 'valores correctos pero confianza baja' };
  return { res: 'OK', why: '' };
}

// ---------- pruebas ----------
interface Fila { f: string; exp: Esperado; ev: { res: string; why: string }; hasText: boolean }
const filas = new Map<string, Fila>();

async function procesar(f: string): Promise<Fila> {
  const cached = filas.get(f);
  if (cached) return cached;
  const texto = await textoDe(f);
  const hasText = texto.replace(/[^A-Za-z0-9]/g, '').length >= 40;
  const exp = await expected(f);
  const r = parsePlanillaText(texto);
  const fila = { f, exp, ev: evaluate(exp, r, hasText), hasText };
  filas.set(f, fila);
  return fila;
}

describe.skipIf(!ROOT || pdfs.length === 0)('lector de planillas con PDFs reales (FX_DIR, pdf.js)', () => {
  const TIMEOUT = 60_000;

  it('pdf.js legacy build es la version 3.11.174 (la misma del navegador)', () => {
    expect(getPdfjs().version).toBe('3.11.174');
  });

  for (const f of pdfs) {
    it(nombreSeguro(f), async () => {
      const fila = await procesar(f);
      if (!fila.hasText) return;   // escaneado: iria a OCR; el legacy no lo cuenta como falla
      expect(fila.ev.why, fila.ev.res).toBe('');
      expect(['OK', 'OK(corr)', 'S/E']).toContain(fila.ev.res);
    }, TIMEOUT);
  }

  it('resumen: planillas con texto y valores esperados', async () => {
    const rows: Fila[] = [];
    for (const f of pdfs) rows.push(await procesar(f));
    const grupos: Record<string, string> = { 'Aportes en Linea (Ana)': 'ana', 'Enlace Operativo (Laura)': 'laura', 'Aportes en Linea (Erika)': 'erika' };
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
      console.log(`  ${g}: con esperado ${ok}/${conValores.length} | sin esperado ${sinEspOk}/${sinEsp.length} | comprobantes->baja ${npOk}/${np.length} | correcciones->baja ${coOk}/${co.length} | sin texto ${st}`);
      expect(ok).toBe(conValores.length);
      expect(sinEspOk).toBe(sinEsp.length);
      expect(npOk).toBe(np.length);
      expect(coOk).toBe(co.length);
    }
    console.log(`  TOTAL planillas con texto y valores esperados: ${totOk}/${totN}`);
    expect(totOk).toBe(totN);
    expect(totN).toBeGreaterThan(0);
  }, 300_000);
});
