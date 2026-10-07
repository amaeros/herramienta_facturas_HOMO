#!/usr/bin/env node
/**
 * check_syntax.js - Revisiones estáticas del proyecto (sin Google):
 *  1) node --check de Code.gs, Calc.gs y Parser.gs (copiados como .js) y del <script> de Index.html.
 *  2) Nombres globales repetidos entre archivos .gs (en Apps Script todos comparten el mismo ámbito).
 *  3) Sintaxis prohibida/dudosa para el runtime V8 de Apps Script (import/require/export, top-level await).
 *  4) HTML: etiquetas balanceadas, ids únicos, ids usados por el JS que existen, funciones api_* que existen en Code.gs.
 *  5) appsscript.json: campos obligatorios.
 * Uso: node check_syntax.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const D = __dirname;
let malas = 0;
function ok(nombre, cond, extra) { if (!cond) malas++; console.log((cond ? 'OK    ' : 'FALLA ') + nombre + (cond ? '' : '  -> ' + extra)); }

function checkJs(nombre, codigo) {
  const tmp = path.join(os.tmpdir(), 'chk_' + process.pid + '_' + nombre.replace(/\W/g, '_') + '.js');
  fs.writeFileSync(tmp, codigo);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  ok('node --check ' + nombre, r.status === 0, (r.stderr || '').split('\n').slice(0, 6).join(' | '));
}

const gs = ['Code.gs', 'Calc.gs', 'Parser.gs'];
const fuentes = {};
gs.forEach(f => { fuentes[f] = fs.readFileSync(path.join(D, f), 'utf8'); checkJs(f, fuentes[f]); });

// --- Index.html: JS embebido
const html = fs.readFileSync(path.join(D, 'Index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
ok('Index.html tiene un <script> en línea', scripts.length === 1, scripts.length);
checkJs('Index.html (script)', scripts[0] || '');

// --- nombres globales repetidos
const globales = {};
gs.forEach(f => {
  const re = /^(?:function\s+([A-Za-z_$][\w$]*)|var\s+([A-Za-z_$][\w$]*))/gm;
  let m;
  while ((m = re.exec(fuentes[f]))) { const n = m[1] || m[2]; (globales[n] = globales[n] || []).push(f); }
});
const dup = Object.keys(globales).filter(n => globales[n].length > 1);
ok('Sin nombres globales repetidos entre Code.gs, Calc.gs y Parser.gs (' + Object.keys(globales).length + ' nombres)', dup.length === 0, dup.map(n => n + ' en ' + globales[n].join(',')).join('; '));

// --- sintaxis no permitida en Apps Script
gs.forEach(f => {
  const limpio = fuentes[f].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const malo = /^\s*(import\s.+from|export\s|const\s+\w+\s*=\s*require\()|\brequire\(/m.test(limpio);
  ok(f + ': sin import/export/require', !malo, 'usa módulos de node');
});
ok('Code.gs y Calc.gs: sin ?. ni ?? (por compatibilidad)', !/\?\.[A-Za-z_(\[]|\?\?/.test(fuentes['Code.gs'].replace(/'[^']*'|"[^"]*"/g, '')) && !/\?\.[A-Za-z_(\[]|\?\?/.test(fuentes['Calc.gs'].replace(/'[^']*'|"[^"]*"/g, '')), 'hay ?. o ??');

// --- funciones que la página llama
const llamadas = [...scripts.join('\n').matchAll(/servidor\('([A-Za-z_]+)'/g)].map(m => m[1]);
const unicas = [...new Set(llamadas)];
unicas.forEach(n => ok('Index.html llama a ' + n + ' y existe en Code.gs (pública, sin "_" al final)', new RegExp('^function\\s+' + n + '\\s*\\(', 'm').test(fuentes['Code.gs']) && !/_$/.test(n), 'no existe'));
ok('doGet existe', /^function\s+doGet\s*\(/m.test(fuentes['Code.gs']));
['onOpen', 'configuracionInicial', 'regenerarFacturaFilaSeleccionada', 'recalcularTodo', 'abrirLinkApp'].forEach(n =>
  ok('Función de menú ' + n + ' existe y es pública', new RegExp('^function\\s+' + n + '\\s*\\(', 'm').test(fuentes['Code.gs'])));

// --- HTML
const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'base', 'col', 'area', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line']);
const cuerpo = html.replace(/<script>[\s\S]*?<\/script>/g, '<script></script>').replace(/<style>[\s\S]*?<\/style>/g, '<style></style>').replace(/<!--[\s\S]*?-->/g, '');
const pila = []; let malaEtiqueta = '';
const tagRe = /<\/?([a-zA-Z][\w-]*)\b([^>]*)>/g; let t;
while ((t = tagRe.exec(cuerpo))) {
  const nombre = t[1].toLowerCase(), cierra = t[0][1] === '/', autoCierra = /\/\s*>$/.test(t[0]);
  if (cierra) { const ult = pila.pop(); if (ult !== nombre) { malaEtiqueta = 'se esperaba </' + ult + '> y aparece </' + nombre + '>'; break; } }
  else if (!VOID.has(nombre) && !autoCierra) pila.push(nombre);
}
ok('HTML: etiquetas balanceadas', !malaEtiqueta && pila.length === 0, malaEtiqueta || 'sin cerrar: ' + pila.join(','));
ok('HTML: empieza con <!DOCTYPE html>, lang="es", charset y viewport', /^<!DOCTYPE html>/i.test(html) && /<html lang="es">/.test(html) && /charset="utf-8"/i.test(html) && /name="viewport"/.test(html));
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const repetidos = ids.filter((x, i) => ids.indexOf(x) !== i);
ok('HTML: ids únicos (' + ids.length + ')', repetidos.length === 0, repetidos.join(','));
const usados = [...new Set([...scripts.join('\n').matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))];
const faltan = usados.filter(i => ids.indexOf(i) < 0);
ok('El JS solo usa ids que existen en el HTML (' + usados.length + ')', faltan.length === 0, faltan.join(','));
const labelsFor = [...html.matchAll(/for="([^"]+)"/g)].map(m => m[1]).filter(i => ids.indexOf(i) < 0);
ok('Todos los <label for> apuntan a un id existente', labelsFor.length === 0, labelsFor.join(','));
// única librería externa permitida: pdf.js 3.11.174 desde cdnjs (dos <script async>); si no carga, el servidor usa OCR
const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
ok('Solo se cargan 2 scripts externos: pdf.js y su worker (cdnjs 3.11.174)',
  srcs.length === 2 && srcs.includes(PDFJS_BASE + 'pdf.min.js') && srcs.includes(PDFJS_BASE + 'pdf.worker.min.js'), srcs);
ok('Los scripts de pdf.js son async (si cdnjs falla la página sigue funcionando)',
  [...html.matchAll(/<script[^>]+src=[^>]*>/gi)].every(m => /\basync\b/.test(m[0])));
ok('Sin otros recursos externos (<link href> remoto)', !/<link[^>]+href=["']https?:/i.test(html));
ok('workerSrc de pdf.js apunta al mismo worker', html.includes("GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL") && html.includes("PDFJS_WORKER_URL = '" + PDFJS_BASE + "pdf.worker.min.js'"));
ok('Colores institucionales #0b5640 y #018d38 presentes', /#0b5640/i.test(html) && /#018d38/i.test(html));
ok('Inputs de archivo: accept PDF e imágenes y capture', /accept="application\/pdf,image\/\*"/.test(html) && /capture="environment"/.test(html));
ok('Sin uso de innerHTML con datos del servidor (solo textContent)', !/innerHTML\s*=\s*[^'"]*\b(r|resp|ev|S)\./.test(scripts.join('\n')));

// --- manifiesto
let man = null;
try { man = JSON.parse(fs.readFileSync(path.join(D, 'appsscript.json'), 'utf8')); } catch (e) { /* abajo */ }
ok('appsscript.json es JSON válido', !!man);
if (man) {
  ok('timeZone America/Bogota, V8, webapp USER_DEPLOYING + ANYONE_ANONYMOUS', man.timeZone === 'America/Bogota' && man.runtimeVersion === 'V8' && man.webapp.executeAs === 'USER_DEPLOYING' && man.webapp.access === 'ANYONE_ANONYMOUS');
  ok('Drive v3 como servicio avanzado', man.dependencies.enabledAdvancedServices.some(s => s.serviceId === 'drive' && s.version === 'v3' && s.userSymbol === 'Drive'));
  const necesarios = ['spreadsheets', 'drive', 'documents', 'script.external_request', 'script.send_mail', 'script.container.ui'].map(s => 'https://www.googleapis.com/auth/' + s);
  ok('Permisos (oauthScopes) completos', necesarios.every(s => man.oauthScopes.indexOf(s) >= 0), necesarios.filter(s => man.oauthScopes.indexOf(s) < 0));
}

console.log(malas ? '\n' + malas + ' revisión(es) fallida(s).' : '\nTodas las revisiones estáticas pasaron.');
process.exit(malas ? 1 : 0);
