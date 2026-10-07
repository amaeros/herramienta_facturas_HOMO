#!/usr/bin/env node
/**
 * test_e2e.js - Prueba de extremo a extremo SIMULADA: Index.html (en jsdom) conectada a Code.gs (con mocks).
 * Uso:  npm install jsdom   (una vez, en cualquier carpeta)  y luego
 *       JSDOM_PATH=/ruta/a/node_modules/jsdom node test_e2e.js      (o solo `node test_e2e.js` si jsdom se resuelve)
 * google.script.run se reemplaza por un puente que llama las funciones api_* de Code.gs dentro del contexto vm.
 * No prueba: cámara/selector de archivos reales, compresión de fotos (jsdom no tiene canvas), ni el sandbox real de Apps Script.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFileSync } = require('child_process');

let JSDOM;
try { ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom')); }
catch (e) { console.log('jsdom no está instalado: se omite test_e2e.js (npm install jsdom).'); process.exit(0); }

const D = __dirname;
const PDF_LAURA = (process.env.FX_DIR || '/home/claude/fx') + '/laura/GESTION DE PAGO/SEPTIEMBRE/Planilla resumida Laura Avila agosto.pdf';

function hostOcr(bytes) {
  const tmp = path.join(os.tmpdir(), 'gapp_e2e_' + process.pid + '.pdf');
  fs.writeFileSync(tmp, Buffer.from(bytes.map(b => b & 0xFF)));
  try { return execFileSync('pdftotext', ['-layout', tmp, '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return ''; }
}
const sandbox = { console, __Buffer: Buffer, __hostOcr: hostOcr, __fixture: fs.readFileSync(path.join(D, 'test_fixture.json'), 'utf8') };
const ctx = vm.createContext(sandbox);
['Parser.gs', 'Calc.gs', 'mocks_gas.js', 'Code.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(D, f), 'utf8'), ctx, { filename: f }));
vm.runInContext('actualizarHojaV3()', ctx);     // el supervisor ya ejecutó la migración v3 (si no, la pantalla oculta lo nuevo)
vm.runInContext('__log = { alerts: [], mails: [], fetches: [], ocrCalls: [], sleeps: 0, driveCreates: [], removed: [] };', ctx);

let pasan = 0, fallan = 0;
function ok(nombre, cond, extra) {
  if (cond) pasan++; else fallan++;
  console.log((cond ? 'OK    ' : 'FALLA ') + nombre + (cond ? '' : '  -> ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const llamadas = [];   // todo lo que la página le pidió al servidor (para revisar qué se envió)
function puente() {
  function runner(ok_, fail_) {
    return new Proxy({}, {
      get(_, prop) {
        if (prop === 'withSuccessHandler') return f => runner(f, fail_);
        if (prop === 'withFailureHandler') return f => runner(ok_, f);
        return (...args) => setTimeout(() => {
          llamadas.push({ fn: String(prop), args: JSON.parse(JSON.stringify(args)) });
          try {
            const fn = vm.runInContext(String(prop), ctx);
            const res = fn(...args.map(a => a === undefined ? undefined : JSON.parse(JSON.stringify(a))));
            ok_ && ok_(JSON.parse(JSON.stringify(res)));
          } catch (e) { fail_ && fail_(e); }
        }, 5);
      }
    });
  }
  return { run: runner(null, null) };
}

(async () => {
  const html = fs.readFileSync(path.join(D, 'Index.html'), 'utf8');
  const errores = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://script.google.com/macros/s/X/exec',
    beforeParse(w) {
      w.google = { script: puente() };
      w.scrollTo = () => {};
      w.URL.createObjectURL = (b) => { w.__ultimoBlob = b; return 'blob:prueba'; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () { w.__descarga = { href: this.href, nombre: this.download }; };
      w.addEventListener('error', e => errores.push(e.message));
    }
  });
  const w = dom.window, d = w.document;
  const $ = id => d.getElementById(id);
  const visible = id => !$(id).hidden;
  async function esperar(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(20); } return false; }
  function ev(el, tipo) { el.dispatchEvent(new w.Event(tipo, { bubbles: true })); }
  function subir(inputId, buffer, nombre, tipo) {
    const input = $(inputId), file = new w.File([buffer], nombre, { type: tipo });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    ev(input, 'change');
  }
  const S_adic = () => d.querySelectorAll('#adic-lista li');
  function pantalla() { return ['p-login', 'p-datos', 'p-cargando', 'p-verificar', 'p-final'].filter(visible).join(','); }

  // ------------------------------------------------------------ pantalla 1
  ok('Carga sin errores de JavaScript', errores.length === 0, errores);
  ok('Se muestra solo la pantalla de entrada', pantalla() === 'p-login', pantalla());
  ok('La lista de nombres se llena desde el servidor (7 + opción vacía)', await esperar(() => $('nombre').options.length === 8), $('nombre').options.length);
  ok('Los nombres se muestran en formato legible', [...$('nombre').options].some(o => o.textContent === 'Laura Avila Roa'), [...$('nombre').options].map(o => o.textContent));
  $('btn-entrar').click();
  ok('Entrar sin escoger nombre: mensaje', !$('banner').hidden && /Escoge tu nombre/.test($('banner').textContent), $('banner').textContent);
  $('nombre').value = 'LAURA AVILA ROA'; $('pin').value = '12a3'; ev($('pin'), 'input');
  ok('El campo PIN solo deja números', $('pin').value === '123', $('pin').value);
  $('btn-entrar').click();
  ok('PIN de menos de 4 números: mensaje', /4 números/.test($('banner').textContent), $('banner').textContent);
  $('pin').value = '9999'; $('btn-entrar').click();
  ok('PIN incorrecto: el servidor responde con mensaje amable', await esperar(() => /no son correctos/.test($('banner').textContent)), $('banner').textContent);
  ok('Sigue en la pantalla 1', pantalla() === 'p-login');
  $('pin').value = '1503'; $('btn-entrar').click();
  ok('PIN correcto: pasa a la pantalla 2', await esperar(() => pantalla() === 'p-datos'), pantalla());
  ok('Saludo con nombre', $('saludo').textContent === 'Hola, Laura Avila', $('saludo').textContent);
  ok('Contrato y honorario', $('d-contrato').textContent === '2026CPSP187' && $('d-honorario').textContent === '$7.174.000', [$('d-contrato').textContent, $('d-honorario').textContent]);
  ok('Selector de mes con 9 meses', $('mes').options.length === 9);
  ok('Septiembre está marcado como ya enviado', /ya enviada ✅/.test($('mes').options[8].textContent), $('mes').options[8].textContent);

  // ------------------------------------------------------------ pantalla 2
  $('mes').value = '2026-01'; ev($('mes'), 'change');
  ok('Enero: fechas de lectura 16/01/2026 al 30/01/2026', $('d-inicio').textContent === '16/01/2026' && $('d-corte').textContent === '30/01/2026', [$('d-inicio').textContent, $('d-corte').textContent]);
  ok('Enero: 15 días y $3.587.000', $('d-valor').textContent === '15 días · $3.587.000', $('d-valor').textContent);
  $('btn-cambiar-fechas').click();
  ok('"Cambiar fechas" habilita los campos de fecha', visible('periodo-edicion') && !visible('periodo-lectura') && $('f-inicio').value === '2026-01-16');
  $('btn-restaurar-fechas').click();
  ok('"Volver a las fechas normales" las deja en solo lectura', visible('periodo-lectura') && !visible('periodo-edicion'));
  $('mes').value = '2026-09'; ev($('mes'), 'change');
  ok('Septiembre: aviso de que reemplaza el envío anterior', visible('ya-enviado'));
  ok('El input de archivo acepta PDF e imágenes', $('archivo').accept === 'application/pdf,image/*' && $('archivo-cam').getAttribute('capture') === 'environment');

  // ------------------------------------------------------------ subir PDF real (pdf.js simulado: texto real con la lógica real de Index.html)
  // pdfjsLib falso que entrega el texto de la planilla (pdftotext) línea por línea, como items de pdf.js; unirItemsPdf y
  // extraerTextoPdf son los de Index.html. (La carga real de cdnjs no se prueba aquí: jsdom no descarga scripts.)
  const lineasPdf = hostOcr([...fs.readFileSync(PDF_LAURA)]).split('\n').filter(l => l.trim());
  w.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.resolve({
      numPages: 1, destroy() {},
      getPage: async () => ({ cleanup() {}, getTextContent: async () => ({ items: lineasPdf.map((l, i) => ({ str: l, hasEOL: true, height: 10, transform: [1, 0, 0, 1, 0, 800 - 12 * i] })) }) })
    }) })
  };
  w.pdfjsWorker = {};
  const ocrAntes = vm.runInContext('__log.driveCreates.length', ctx);
  subir('archivo', fs.readFileSync(PDF_LAURA), 'planilla.pdf', 'application/pdf');
  ok('Muestra la pantalla de lectura mientras trabaja el servidor', pantalla() === 'p-cargando', pantalla());
  ok('Pasa a la pantalla de verificación', await esperar(() => pantalla() === 'p-verificar'), pantalla() + ' | ' + $('banner').textContent);
  ok('Muestra lo leído: n.º, mes, salud, pensión, ARL', $('v-numero').textContent === '87959084' && $('v-periodo').textContent === 'Agosto 2026' && $('v-salud').textContent === '$358.700' && $('v-pension').textContent === '$459.200' && $('v-arl').textContent === '$70.000',
    ['v-numero', 'v-periodo', 'v-salud', 'v-pension', 'v-arl'].map(i => $(i).textContent));
  ok('Semáforo verde con el mensaje', $('semaforo').classList.contains('ok') && /Todo en orden/.test($('semaforo').textContent) && /Agosto 2026 coincide/.test($('semaforo').textContent), $('semaforo').textContent);
  ok('Los campos están en solo lectura y el botón Enviar está activo', !visible('lectura-edicion') && !$('btn-enviar').disabled);
  const envio1 = llamadas.filter(c => c.fn === 'api_leerPlanilla').pop();
  ok('La página manda el texto de pdf.js junto con el archivo (base64 sigue yendo)', envio1 && typeof envio1.args[0].texto === 'string' && envio1.args[0].texto.length >= 150 && /87959084/.test(envio1.args[0].texto) && !!envio1.args[0].archivo.base64, envio1 && envio1.args[0].texto && envio1.args[0].texto.slice(0, 80));
  ok('Con el texto del navegador el servidor no llamó al OCR de Drive', vm.runInContext('__log.driveCreates.length', ctx) === ocrAntes, vm.runInContext('__log.driveCreates.length', ctx) - ocrAntes);

  // corregir: ARL mal -> 🔴 -> corregir -> ✅
  $('btn-corregir').click();
  ok('"Corregir" muestra los campos editables con lo leído', visible('lectura-edicion') && $('i-numero').value === '87959084' && $('i-salud').value === '358.700' && $('i-mes').value === '08' && $('i-anio').value === '2026', [$('i-numero').value, $('i-salud').value, $('i-mes').value, $('i-anio').value]);
  $('i-arl').value = '15.000'; ev($('i-arl'), 'input');
  ok('Al cambiar un dato se pide "Revisar de nuevo" y se bloquea Enviar', /Revisar de nuevo/.test($('semaforo').textContent) && $('btn-enviar').disabled);
  $('btn-revisar').click();
  ok('Revisar de nuevo: semáforo rojo con el mensaje de ARL menor a lo esperado', await esperar(() => $('semaforo').classList.contains('err')) && /Cotizaste \$832\.900 y para este contrato debe ser al menos \$887\.900/.test($('semaforo').textContent) && /ARL \(cotizaste \$15\.000, debe ser \$70\.000\)/.test($('semaforo').textContent), $('semaforo').textContent);
  ok('En rojo NO se bloquea: el botón sigue activo, con el texto normal, y el título dice que la cuenta se genera igual', !$('btn-enviar').disabled && $('btn-enviar').textContent === 'Enviar y generar mi cuenta de cobro' && /se genera igual/.test($('semaforo').textContent) && !/no se creará/.test(d.body.textContent), $('btn-enviar').textContent);
  $('i-arl').value = '70000'; ev($('i-arl'), 'input'); $('btn-revisar').click();
  ok('Corregida la ARL: vuelve a verde', await esperar(() => $('semaforo').classList.contains('ok')), $('semaforo').className);
  ok('Botón Enviar con el texto normal y activo', $('btn-enviar').textContent === 'Enviar y generar mi cuenta de cobro' && !$('btn-enviar').disabled);

  // enviar
  $('btn-enviar').click();
  ok('Pantalla de "generando"', pantalla() === 'p-cargando', pantalla());
  ok('Pantalla final', await esperar(() => pantalla() === 'p-final', 8000), pantalla() + ' | ' + $('banner').textContent);
  ok('Final: semáforo verde y botón de descarga', $('semaforo-final').classList.contains('ok') && visible('final-descarga'));
  ok('Final: recordatorio de firmar y entregar con el informe de actividades', /firma la cuenta de cobro y entrégala con tu informe de actividades/i.test($('final-descarga').textContent));
  ok('Como el envío corrigió un dato, la lectura quedó como "corregido"... (o auto si es igual)', ['auto', 'corregido'].indexOf(vm.runInContext('__sheets.CARGA._get(3,22)', ctx)) >= 0, vm.runInContext('__sheets.CARGA._get(3,22)', ctx));
  ok('Final: dos botones, "Descargar cuenta de cobro (Excel)" (principal) y "Descargar en PDF", con la nota de cuál se entrega', visible('btn-descargar') && visible('btn-descargar-pdf') && $('btn-descargar').textContent === 'Descargar cuenta de cobro (Excel)' && $('btn-descargar-pdf').textContent === 'Descargar en PDF' && /El Excel es el que entregas/.test($('final-descarga').textContent) && !$('btn-descargar').classList.contains('sec') && $('btn-descargar-pdf').classList.contains('sec'));
  $('btn-descargar').click();
  ok('Descargar (Excel) genera el .xlsx con el nombre correcto y el tipo de Excel', w.__descarga && w.__descarga.nombre === '202609 - LAURA AVILA ROA - Cuenta de cobro.xlsx' && /spreadsheetml/.test(w.__ultimoBlob.type), [w.__descarga, w.__ultimoBlob && w.__ultimoBlob.type]);
  ok('Aparece el enlace de respaldo "Abrir el archivo"', visible('btn-abrir') || !$('btn-abrir').hidden);
  $('btn-descargar-pdf').click();
  ok('Descargar en PDF genera el .pdf con su nombre y tipo', w.__descarga && w.__descarga.nombre === '202609 - LAURA AVILA ROA - Cuenta de cobro.pdf' && w.__ultimoBlob.type === 'application/pdf', [w.__descarga, w.__ultimoBlob && w.__ultimoBlob.type]);

  // ------------------------------------------------------------ otro mes, lectura manual
  $('btn-otro-mes').click();
  ok('"Enviar otro mes" vuelve a la pantalla 2', await esperar(() => pantalla() === 'p-datos'), pantalla());
  $('mes').value = '2026-08'; ev($('mes'), 'change');
  // cdnjs no responde: los <script> de pdf.js disparan "error" -> la página sigue funcionando y manda texto vacío (el servidor usa OCR)
  w.pdfjsLib = undefined; w.pdfjsWorker = undefined;
  d.querySelectorAll('script[src*="pdf.js"]').forEach(sc => sc.dispatchEvent(new w.Event('error')));
  ok('Los dos <script> de pdf.js están en la página y su fallo se detecta', d.querySelectorAll('script[src*="pdf.js"]').length === 2 && w.pdfjsFalla === true);
  subir('archivo', Buffer.from('%PDF-1.4\nno es una planilla\n%%EOF'), 'rara.pdf', 'application/pdf');
  ok('PDF ilegible: pasa a la verificación en modo manual', await esperar(() => pantalla() === 'p-verificar'), pantalla() + ' | ' + $('banner').textContent);
  const envio2 = llamadas.filter(c => c.fn === 'api_leerPlanilla').pop();
  ok('Sin pdf.js (cdnjs caído): la app sigue, manda texto vacío y el servidor usa OCR', envio2 && envio2.args[0].texto === '' && !!envio2.args[0].archivo.base64 && vm.runInContext('__log.driveCreates.length', ctx) > ocrAntes);
  ok('Modo manual: aviso, campos vacíos editables y ayuda visual abierta', visible('lectura-edicion') && $('i-numero').value === '' && $('ver-nota').hidden === false && $('ayuda-donde').open === true && /No pudimos leer/.test($('ver-nota').textContent), $('ver-nota').textContent);
  ok('Modo manual: campos faltantes resaltados y Enviar bloqueado', $('c-numero').classList.contains('falta') && $('btn-enviar').disabled);
  ok('El dibujo de ayuda (SVG) está en la página', !!d.querySelector('#ayuda-donde svg'));
  $('i-numero').value = '87959084'; ev($('i-numero'), 'input');
  $('i-mes').value = '08'; $('i-anio').value = '2026'; ev($('i-mes'), 'change');
  $('i-salud').value = '358700'; $('i-pension').value = '459200'; $('i-arl').value = '70000';
  ['i-salud', 'i-pension', 'i-arl'].forEach(i => ev($(i), 'input'));
  $('btn-revisar').click();
  ok('Escrito a mano y con la planilla de Laura de septiembre repetida en OTRO mes: 🟡 por planilla repetida (no bloquea)', await esperar(() => $('semaforo').classList.contains('rev')) && /tu cuenta de cobro de Septiembre 2026/.test($('semaforo').textContent) && !$('btn-enviar').disabled, $('semaforo').textContent);
  $('i-numero').value = '88000001'; ev($('i-numero'), 'input'); $('btn-revisar').click();
  ok('Con otro n.º de planilla: ✅ (agosto con planilla de agosto)', await esperar(() => $('semaforo').classList.contains('ok')), $('semaforo').textContent);
  $('btn-enviar').click();
  ok('Envío manual: pantalla final verde', await esperar(() => pantalla() === 'p-final', 8000) && $('semaforo-final').classList.contains('ok'), pantalla() + ' | ' + $('banner').textContent);
  ok('CARGA: la fila nueva quedó con lectura "manual"', vm.runInContext('__sheets.CARGA._get(6,22)', ctx) === 'manual', vm.runInContext('__sheets.CARGA._get(6,22)', ctx));

  // ------------------------------------------------------------ v3: días distintos + planillas adicionales + alerta sin bloqueo
  $('btn-otro-mes').click();
  ok('v3: "Enviar otro mes" vuelve a la pantalla 2', await esperar(() => pantalla() === 'p-datos'), pantalla());
  ok('v3: la opción de días distintos está disponible (la hoja ya está migrada)', visible('dias-bloque') && !visible('dias-edicion') && /días distintos/.test($('btn-dias').textContent));
  $('mes').value = '2026-07'; ev($('mes'), 'change');
  $('btn-dias').click();
  ok('v3: al tocarla aparecen Días a cobrar y Motivo', visible('dias-edicion') && !$('btn-dias').offsetParent === false || visible('dias-edicion'));
  $('dias-n').value = '2o'; ev($('dias-n'), 'input');
  ok('v3: el campo de días solo deja números', $('dias-n').value === '2', $('dias-n').value);
  $('dias-n').value = '20'; ev($('dias-n'), 'input');
  ok('v3: muestra el cálculo (honorario × 20 ÷ 30 = $4.782.667)', /\$4\.782\.667/.test($('dias-calculo').textContent), $('dias-calculo').textContent);
  subir('archivo', Buffer.from('%PDF-1.4\nno es una planilla\n%%EOF'), 'rara2.pdf', 'application/pdf');
  ok('v3: sin motivo no deja subir y lo explica', pantalla() === 'p-datos' && /motivo/i.test($('banner').textContent), $('banner').textContent);
  $('dias-motivo').value = 'Licencia no remunerada'; ev($('dias-motivo'), 'input');
  subir('archivo', Buffer.from('%PDF-1.4\nno es una planilla\n%%EOF'), 'rara2.pdf', 'application/pdf');
  ok('v3: con días y motivo pasa a la verificación', await esperar(() => pantalla() === 'p-verificar'), pantalla() + ' | ' + $('banner').textContent);
  const envioDias = llamadas.filter(c => c.fn === 'api_leerPlanilla').pop();
  ok('v3: la lectura ya manda los días a mano al servidor', envioDias.args[0].diasManual && envioDias.args[0].diasManual.dias === '20' && envioDias.args[0].diasManual.motivo === 'Licencia no remunerada', envioDias.args[0].diasManual);
  ok('v3: se ve la tarjeta de planillas adicionales con la explicación y el botón "＋ Agregar otra planilla"', visible('adic-card') && /＋ Agregar otra planilla \(corrección o adicional\)/.test($('btn-adic-abrir').textContent) && !visible('adic-form'));
  $('i-numero').value = '86616708'; ev($('i-numero'), 'input');
  $('i-mes').value = '07'; $('i-anio').value = '2026'; ev($('i-mes'), 'change');
  $('i-salud').value = '358700'; $('i-pension').value = '459200'; $('i-arl').value = '70000';
  ['i-salud', 'i-pension', 'i-arl'].forEach(i => ev($(i), 'input'));
  $('btn-revisar').click();
  ok('v3: con días a mano el semáforo queda 🟡 con el aviso', await esperar(() => $('semaforo').classList.contains('rev')) && /Días cobrados a mano: 20 \(Licencia no remunerada\)\. Revisar\./.test($('semaforo').textContent), $('semaforo').textContent);
  // --- agregar planillas adicionales
  $('btn-adic-abrir').click();
  ok('v3: abre el formulario "Planilla 2" con la explicación del valor único', visible('adic-form') && $('adic-titulo').textContent === 'Planilla 2' && /sin los intereses de mora/.test($('ca-valor').textContent) && /Siempre en positivo/.test($('ca-valor').textContent));
  $('btn-adic-agregar').click();
  ok('v3: sin datos no agrega y marca lo que falta', S_adic().length === 0 && !$('adic-error').hidden && $('ca-numero').classList.contains('falta'), $('adic-error').textContent);
  $('a-numero').value = '86616X99'; $('a-mes').value = '06'; $('a-anio').value = '2026'; $('a-valor').value = '21.400';
  $('btn-adic-agregar').click();
  ok('v3: n.º con letras: no agrega', S_adic().length === 0 && /solo con números/.test($('adic-error').textContent), $('adic-error').textContent);
  $('a-numero').value = '86616999'; $('a-valor').value = '-500';
  $('btn-adic-agregar').click();
  ok('v3: valor negativo: no agrega (siempre positivo)', S_adic().length === 0 && /mayor que cero/.test($('adic-error').textContent), $('adic-error').textContent);
  $('a-valor').value = '21.400';
  $('btn-adic-agregar').click();
  ok('v3: agrega la planilla 2 a la lista', S_adic().length === 1 && /Planilla 2 · n\.º 86616999 · Junio 2026 · \$21\.400/.test($('adic-lista').textContent) && !visible('adic-form'), $('adic-lista').textContent);
  // segunda, subiendo un PDF (no legible: queda en manual) y quitándola después
  $('btn-adic-abrir').click();
  ok('v3: la segunda se llama "Planilla 3"', $('adic-titulo').textContent === 'Planilla 3');
  subir('archivo-adic', Buffer.from('%PDF-1.4\nno es una planilla\n%%EOF'), 'correccion.pdf', 'application/pdf');
  ok('v3: al subir el PDF de la adicional lo guarda y avisa que escriba los datos', await esperar(() => /no pudimos leerlo con seguridad|Archivo guardado/.test($('adic-estado').textContent)), $('adic-estado').textContent);
  const lecAdic = llamadas.filter(c => c.fn === 'api_leerPlanilla').pop();
  ok('v3: la adicional se lee como adicional (no se evalúa) y manda su texto de pdf.js (vacío si no hay)', lecAdic.args[0].adicional === true && typeof lecAdic.args[0].texto === 'string');
  $('a-numero').value = '86616998'; $('a-mes').value = '05'; $('a-anio').value = '2026'; $('a-valor').value = '3200';
  $('btn-adic-agregar').click();
  ok('v3: ya hay 2 adicionales (la 2.ª con PDF)', S_adic().length === 2 && /con PDF/.test($('adic-lista').textContent), $('adic-lista').textContent);
  d.querySelectorAll('#adic-lista .quitar')[1].click();
  ok('v3: "Quitar" saca la planilla 3 de la lista', S_adic().length === 1 && !/86616998/.test($('adic-lista').textContent), $('adic-lista').textContent);
  ok('v3: al agregar/quitar se revisa de nuevo con las adicionales (api_evaluar las lleva)', await esperar(() => { const c = llamadas.filter(x => x.fn === 'api_evaluar').pop(); return c && c.args[0].adicionales && c.args[0].adicionales.length === 1; }));
  ok('v3: sigue 🟡 y el botón Enviar activo', await esperar(() => !$('btn-enviar').disabled) && $('semaforo').classList.contains('rev'));
  $('btn-enviar').click();
  ok('v3: pantalla final con la cuenta de cobro 🟡 y el botón de descarga SIEMPRE visible', await esperar(() => pantalla() === 'p-final', 8000) && $('semaforo-final').classList.contains('rev') && visible('final-descarga') && !visible('final-error') && /Cuenta de cobro lista, tu supervisor la revisará/.test($('semaforo-final').textContent), pantalla() + ' | ' + $('banner').textContent);
  const envio7 = llamadas.filter(c => c.fn === 'api_enviar').pop().args[0];
  ok('v3: api_enviar lleva 1 adicional (valor 21400, mes 2026-06) y los días a mano', envio7.adicionales.length === 1 && envio7.adicionales[0].numero === '86616999' && envio7.adicionales[0].valor === 21400 && envio7.adicionales[0].periodo === '2026-06' && envio7.diasManual.dias === '20', envio7);
  ok('v3: CARGA fila 7: valor a 20 días, AF/AG, planilla 2 y estado 🟡', vm.runInContext('__sheets.CARGA._get(7,11)', ctx) === 4782667 && vm.runInContext('__sheets.CARGA._get(7,32)', ctx) === 20 && vm.runInContext('__sheets.CARGA._get(7,23)', ctx) === '86616999' && vm.runInContext('__sheets.CARGA._get(7,25)', ctx) === 21400 && vm.runInContext('__sheets.CARGA._get(7,16)', ctx) === '🟡 REVISAR', [11, 32, 23, 25, 16].map(c => vm.runInContext('__sheets.CARGA._get(7,' + c + ')', ctx)));
  const ultimaExp = vm.runInContext('__log.fetches[__log.fetches.length - 1]', ctx);
  ok('v3: la factura de esa fila se exportó con las filas 30 y 31 ocultas y el rango A1:N51', JSON.stringify(ultimaExp.ocultas) === '[30,31]' && /range=A1%3AN51&/.test(ultimaExp.url) && vm.runInContext('Object.keys(__sheets.FACTURA.hidden).length', ctx) === 0, ultimaExp);
  $('btn-descargar').click();
  ok('v3: la descarga (Excel) funciona aunque haya alerta', w.__descarga && /202607 - LAURA AVILA ROA - Cuenta de cobro\.xlsx/.test(w.__descarga.nombre), w.__descarga);

  // --- 🔴 (cotiza menos): se envía igual y se descarga
  $('btn-otro-mes').click();
  ok('v3: otra vez a la pantalla 2', await esperar(() => pantalla() === 'p-datos'));
  ok('v3: al volver, los días a mano y las adicionales empiezan de cero', !visible('dias-edicion') && $('dias-n').value === '');
  $('mes').value = '2026-06'; ev($('mes'), 'change');
  subir('archivo', Buffer.from('%PDF-1.4\nno es una planilla\n%%EOF'), 'rara3.pdf', 'application/pdf');
  ok('v3: 🔴 pasa a verificación', await esperar(() => pantalla() === 'p-verificar'), pantalla() + ' | ' + $('banner').textContent);
  ok('v3: sin adicionales no hay lista visible', !visible('adic-lista') || S_adic().length === 0);
  $('i-numero').value = '86050187'; ev($('i-numero'), 'input');
  $('i-mes').value = '06'; $('i-anio').value = '2026'; ev($('i-mes'), 'change');
  $('i-salud').value = '100000'; $('i-pension').value = '200000'; $('i-arl').value = '30000';
  ['i-salud', 'i-pension', 'i-arl'].forEach(i => ev($(i), 'input'));
  $('btn-revisar').click();
  ok('v3: cotizar MENOS da 🔴 pero deja enviar', await esperar(() => $('semaforo').classList.contains('err')) && !$('btn-enviar').disabled && /Cotizaste \$330\.000 y para este contrato debe ser al menos \$887\.900/.test($('semaforo').textContent), $('semaforo').textContent);
  $('btn-enviar').click();
  ok('v3: 🔴 igual llega a la pantalla final CON el botón de descarga', await esperar(() => pantalla() === 'p-final', 8000) && $('semaforo-final').classList.contains('err') && visible('final-descarga') && /Cuenta de cobro lista, con una alerta para tu supervisor/.test($('semaforo-final').textContent), pantalla() + ' | ' + $('banner').textContent);
  // --- mayor
  $('btn-otro-mes').click();
  ok('v3: pantalla 2 otra vez', await esperar(() => pantalla() === 'p-datos'));
  $('mes').value = '2026-05'; ev($('mes'), 'change');
  subir('archivo', Buffer.from('%PDF-1.4\nno es una planilla\n%%EOF'), 'rara4.pdf', 'application/pdf');
  await esperar(() => pantalla() === 'p-verificar');
  $('i-numero').value = '85401370'; ev($('i-numero'), 'input');
  $('i-mes').value = '05'; $('i-anio').value = '2026'; ev($('i-mes'), 'change');
  $('i-salud').value = '600000'; $('i-pension').value = '700000'; $('i-arl').value = '90000';
  ['i-salud', 'i-pension', 'i-arl'].forEach(i => ev($(i), 'input'));
  $('btn-revisar').click();
  ok('v3: cotizar MÁS da 🟡 con el mensaje del supervisor', await esperar(() => $('semaforo').classList.contains('rev')) && /Cotizaste \$1\.390\.000, más de los \$887\.900 que corresponden a este contrato \(puede ser por otros ingresos o contratos\)\. Tu supervisor lo revisará\./.test($('semaforo').textContent), $('semaforo').textContent);
  // --- faltan datos obligatorios: SÍ bloquea
  $('i-numero').value = ''; ev($('i-numero'), 'input'); $('btn-revisar').click();
  ok('v3: sin n.º de planilla el botón Enviar se bloquea y dice qué falta', await esperar(() => /Falta el n\.º de la planilla/.test($('semaforo').textContent)) && $('btn-enviar').disabled && /Falta algo para generar/.test($('semaforo').textContent), $('semaforo').textContent);
  // --- si el Excel no sale, el PDF se entrega con aviso; y si no sale ninguno, se avisa sin botones
  $('i-numero').value = '85401370'; ev($('i-numero'), 'input'); $('btn-revisar').click();
  await esperar(() => !$('btn-enviar').disabled);
  vm.runInContext('__xlsxStatus = [500, 500]', ctx);
  $('btn-enviar').click();
  ok('v3: sin Excel, el final trae solo "Descargar en PDF" con el aviso amable', await esperar(() => pantalla() === 'p-final', 8000) && !visible('btn-descargar') && visible('btn-descargar-pdf') && /No pudimos armar el Excel/.test($('final-aviso').textContent) && visible('final-aviso') && !visible('final-nota-pdf') && !visible('final-error'), pantalla() + ' | ' + $('final-aviso').textContent);
  $('btn-descargar-pdf').click();
  ok('v3: el PDF se descarga igual', w.__descarga && /Cuenta de cobro\.pdf$/.test(w.__descarga.nombre), w.__descarga);
  $('btn-otro-mes').click();
  await esperar(() => pantalla() === 'p-datos');
  $('mes').value = '2026-05'; ev($('mes'), 'change');
  subir('archivo', Buffer.from('%PDF-1.4\nno es una planilla\n%%EOF'), 'rara5.pdf', 'application/pdf');
  await esperar(() => pantalla() === 'p-verificar');
  $('i-numero').value = '85401371'; ev($('i-numero'), 'input');
  $('i-mes').value = '05'; $('i-anio').value = '2026'; ev($('i-mes'), 'change');
  $('i-salud').value = '358700'; $('i-pension').value = '459200'; $('i-arl').value = '70000';
  ['i-salud', 'i-pension', 'i-arl'].forEach(i => ev($(i), 'input'));
  $('btn-revisar').click();
  await esperar(() => !$('btn-enviar').disabled);
  vm.runInContext('__xlsxStatus = [500, 500]; __exportStatus = [500, 500]', ctx);
  $('btn-enviar').click();
  ok('v3: si no sale ni el Excel ni el PDF: se avisa, sin botones de descarga, y el envío queda registrado', await esperar(() => pantalla() === 'p-final', 8000) && !visible('final-descarga') && visible('final-error') && /Excel ni PDF/.test($('final-error').textContent) && /Enviado, pero falta la cuenta de cobro/.test($('semaforo-final').textContent), pantalla());
  $('btn-salir-2').click();
  ok('Salir limpia el PIN y vuelve a la pantalla 1', pantalla() === 'p-login' && $('pin').value === '');
  ok('Ningún error de JavaScript durante toda la prueba', errores.length === 0, errores);

  console.log('\nResultado: ' + pasan + ' correctas, ' + fallan + ' fallidas.');
  process.exit(fallan ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
