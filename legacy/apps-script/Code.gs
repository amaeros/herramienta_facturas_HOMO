/**
 * Code.gs - Aplicación web "Cuenta de cobro HOMO" + menú del supervisor + orquestación.
 *
 * Archivos del proyecto: Code.gs (este), Calc.gs (reglas), Parser.gs (lector de planillas),
 * Index.html (pantalla de la contratista) y appsscript.json (manifiesto).
 * El script está ligado a la hoja "Centro de Control Facturas HOMO" (container-bound).
 * Contrato de datos: ver CONTRATO_DATOS.md (PARAMETROS, CONTRATOS, CARGA, FACTURA, PANEL).
 *
 * Convención: las funciones que terminan en "_" son privadas (el navegador no puede llamarlas).
 * Las funciones "api_*" son las que llama Index.html; todas devuelven { ok, error?, ... }.
 */

var HOMO = {
  HOJA_PANEL: 'PANEL', HOJA_CARGA: 'CARGA', HOJA_FACTURA: 'FACTURA',
  HOJA_CONTRATOS: 'CONTRATOS', HOJA_PARAMETROS: 'PARAMETROS',
  TZ: 'America/Bogota',
  CARPETA_RAIZ: 'Cuentas de cobro HOMO',
  CARPETA_TEMPORAL: '_temporal',
  MAX_BYTES: 10 * 1024 * 1024,
  MIN_TEXTO_NAVEGADOR: 150,        // menos caracteres que esto = PDF escaneado/foto: se usa el OCR de Drive
  MAX_TEXTO_NAVEGADOR: 200000,
  MAX_INTENTOS_PIN: 5,
  VENTANA_PIN_SEG: 600,
  CACHE_LECTURA_SEG: 21600,
  COLS_CONTRATOS: 19,
  COLS_CARGA_V2: 22,               // hoja instalada antes de la v3 (A..V)
  COLS_CARGA_V3: 34,               // v3: A..AH (W..AH = planillas 2-4, días a mano, motivo, URLs de PDFs adicionales)
  COLS_CARGA: 35,                  // v3.1: A..AI (AI = URL del PDF de la cuenta de cobro; S pasa a ser la URL del Excel)
  // fragmentos que deben aparecer (sin tildes, en minúscula) en los encabezados de la fila 1
  ENC_CONTRATOS: ['nombre', 'cedula', 'direccion', 'telefono', 'ciudad', 'cargo', 'contrato', 'objeto', 'inicio',
    'terminacion', 'honorario', 'total', 'riesgo', 'riesgo', 'desde', 'reviso', 'reviso', 'activo', 'correo'],
  ENC_CARGA: ['marca', 'contratista', 'mes a cobrar', 'inicio', 'corte', 'planilla', 'mes cotizado', 'ss declarado',
    'documento', 'dias', 'valor', 'acumulado', 'ejecucion', 'esperada', 'desglose', 'estado', 'mensaje', 'planilla',
    'factura', 'observacion', 'aprobado', 'lectura',
    // v3 (W..AH)
    'planilla 2', 'mes cotizado', 'valor', 'planilla 3', 'mes cotizado', 'valor', 'planilla 4', 'mes cotizado', 'valor',
    'dias', 'motivo', 'url', 'pdf factura'],
  ENCABEZADOS_V3: ['Planilla 2 n.º', 'Planilla 2 mes cotizado', 'Planilla 2 valor', 'Planilla 3 n.º', 'Planilla 3 mes cotizado',
    'Planilla 3 valor', 'Planilla 4 n.º', 'Planilla 4 mes cotizado', 'Planilla 4 valor', 'Días cobrados manualmente',
    'Motivo de la novedad', 'URLs PDFs adicionales', 'URL PDF factura'],
  MAX_ADICIONALES: 3,
  FILAS_EXTRA_FACTURA: 3,
  MIME_XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

// ===================================================================================
//  Utilidades generales
// ===================================================================================

function amable_(mensaje) { var e = new Error(mensaje); e.amable = true; return e; }

/** Ejecuta una función del servidor y siempre devuelve { ok, ... } con mensajes amables. */
function envolver_(fn) {
  try {
    var r = fn();
    if (r && typeof r === 'object' && r.ok === undefined) r.ok = true;
    return r;
  } catch (e) {
    if (e && e.amable) return { ok: false, error: e.message };
    console.error('Error en el servidor: ' + (e && e.stack ? e.stack : e));
    return {
      ok: false,
      error: 'Algo salió mal de nuestro lado. Intenta de nuevo en un momento. Si sigue igual, avisa a tu supervisor.'
    };
  }
}

function normTxt_(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function esFecha_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }

function pad2_(n) { n = Number(n); return (n < 10 ? '0' : '') + n; }

/** Convierte un número escrito de varias formas ("1.750.905", "12,5%", 0.125) en número; NaN si no se puede. */
function numero_(v) {
  if (typeof v === 'number') return v;
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return NaN;
  var pct = /%$/.test(s);
  s = s.replace(/%$/, '').replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  var n = Number(s);
  return pct ? n / 100 : n;
}

/** Monto en pesos escrito por una persona: "358.700", "$ 358,700", 358700 -> 358700; null si no es un número. */
function monto_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.round(v) : null;
  var s = String(v).replace(/[$\s]/g, '');
  if (!s) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  if (/^\d{1,3}([.,]\d{3})+[.,]\d{1,2}$/.test(s)) return Number(s.replace(/[.,]\d{1,2}$/, '').replace(/[.,]/g, ''));
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d+[.,]\d{1,2}$/.test(s)) return Math.round(Number(s.replace(',', '.')));
  return null;
}

function ymdCelda_(v, tz) {
  if (v === '' || v === null || v === undefined) return '';
  if (esFecha_(v)) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  var s = String(v).trim(), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return '';
}

function ymdADate_(ymd, tz) { return ymd ? Utilities.parseDate(ymd, tz, 'yyyy-MM-dd') : ''; }

function mesActual_() { return Utilities.formatDate(new Date(), HOMO.TZ, 'yyyy-MM'); }

function esCorreo_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }

function limpiarNombreArchivo_(s) { return String(s).replace(/[\\\/:*?"<>|#%]/g, ' ').replace(/\s+/g, ' ').trim(); }

function ultimos4_(cedula) { return String(cedula === null || cedula === undefined ? '' : cedula).replace(/\D/g, '').slice(-4); }

// ===================================================================================
//  Lectura de la hoja
// ===================================================================================

function hoja_(ss, nombre) {
  var h = ss.getSheetByName(nombre);
  if (!h) throw amable_('No encuentro la hoja "' + nombre + '". Avisa a tu supervisor.');
  return h;
}

function tz_(ss) { return (ss.getSpreadsheetTimeZone && ss.getSpreadsheetTimeZone()) || HOMO.TZ; }

function leerParametros_(ss) {
  var v = hoja_(ss, HOMO.HOJA_PARAMETROS).getRange(1, 1, 18, 2).getValues();
  function b(fila) { return v[fila - 1][1]; }
  var P = {
    pctIbc: numero_(b(2)), pctSalud: numero_(b(3)), pctPension: numero_(b(4)), smmlv: numero_(b(5)),
    piso: numero_(b(6)), techo: numero_(b(7)), arl: {},
    carpetaId: String(b(15) || '').trim(),
    enviarCorreo: normTxt_(b(16)) === 'si',
    correoSupervisor: String(b(17) || '').trim(),
    tolerancia: numero_(b(18))
  };
  for (var f = 9; f <= 13; f++) {
    var k = String(v[f - 1][0] || '').trim().toUpperCase();
    var t = numero_(v[f - 1][1]);
    if (k && isFinite(t)) P.arl[k] = t;
  }
  if (!isFinite(P.tolerancia)) P.tolerancia = 100;
  var faltan = [];
  ['pctIbc', 'pctSalud', 'pctPension', 'smmlv', 'piso', 'techo'].forEach(function (k) { if (!isFinite(P[k])) faltan.push(k); });
  if (Object.keys(P.arl).length < 5) faltan.push('tabla ARL');
  if (faltan.length) {
    console.error('PARAMETROS incompleta: ' + faltan.join(', '));
    throw amable_('La hoja PARAMETROS está incompleta. Avisa a tu supervisor.');
  }
  return P;
}

function leerContratos_(ss) {
  var h = hoja_(ss, HOMO.HOJA_CONTRATOS), tz = tz_(ss);
  var ult = h.getLastRow();
  if (ult < 2) return [];
  var v = h.getRange(2, 1, ult - 1, HOMO.COLS_CONTRATOS).getValues(), res = [];
  for (var i = 0; i < v.length; i++) {
    var r = v[i], nombre = String(r[0] || '').trim();
    if (!nombre) continue;
    res.push({
      fila: i + 2, nombre: nombre, cedula: String(r[1] === null ? '' : r[1]).trim(), cargo: String(r[5] || ''),
      numero: String(r[6] || ''), inicio: ymdCelda_(r[8], tz), fin: ymdCelda_(r[9], tz),
      honorario: numero_(r[10]), total: numero_(r[11]),
      riesgo: String(r[12] || '').trim().toUpperCase(), riesgoNuevo: String(r[13] || '').trim().toUpperCase(),
      desde: ymdCelda_(r[14], tz), activo: normTxt_(r[17]) === 'si', correo: String(r[18] || '').trim()
    });
  }
  return res;
}

function buscarContrato_(contratos, nombre) {
  var n = normTxt_(nombre);
  for (var i = 0; i < contratos.length; i++) if (normTxt_(contratos[i].nombre) === n) return contratos[i];
  return null;
}

/** ¿La hoja CARGA ya tiene las columnas de la v3 (W..AH) con sus encabezados? */
function esCargaV3_(hoja) {
  if (hoja.getMaxColumns() < HOMO.COLS_CARGA_V3) return false;
  var fila = hoja.getRange(1, 1, 1, HOMO.COLS_CARGA_V3).getValues()[0];
  for (var i = HOMO.COLS_CARGA_V2; i < HOMO.COLS_CARGA_V3; i++) {
    if (normTxt_(fila[i]).indexOf(HOMO.ENC_CARGA[i]) < 0) return false;
  }
  return true;
}

/** ¿CARGA ya tiene la columna AI "URL PDF factura" (v3.1)? Sin ella, el PDF igual se genera, pero su link no se anota en la hoja. */
function tieneColumnaPdf_(hoja) {
  if (hoja.getMaxColumns() < HOMO.COLS_CARGA) return false;
  return normTxt_(hoja.getRange(1, HOMO.COLS_CARGA).getValue()).indexOf(HOMO.ENC_CARGA[HOMO.COLS_CARGA - 1]) >= 0;
}

function textoPlanilla_(v) {
  if (typeof v === 'number') v = String(Math.round(v));
  return String(v === null || v === undefined ? '' : v).trim();
}

function leerCarga_(ss) {
  var h = hoja_(ss, HOMO.HOJA_CARGA), tz = tz_(ss);
  var ult = h.getLastRow();
  if (ult < 2) return [];
  var v3 = esCargaV3_(h), conPdf = v3 && tieneColumnaPdf_(h);
  var cols = conPdf ? HOMO.COLS_CARGA : (v3 ? HOMO.COLS_CARGA_V3 : HOMO.COLS_CARGA_V2);
  var v = h.getRange(2, 1, ult - 1, cols).getValues(), res = [];
  for (var i = 0; i < v.length; i++) {
    var r = v[i];
    if (!String(r[1] || '').trim()) continue;
    var fila = {
      fila: i + 2, contratista: String(r[1]).trim(), mes: ymdCelda_(r[2], tz).slice(0, 7),
      inicio: ymdCelda_(r[3], tz), corte: ymdCelda_(r[4], tz), planilla: textoPlanilla_(r[5]),
      mesCot: ymdCelda_(r[6], tz).slice(0, 7), declarado: r[7], docNum: r[8], dias: r[9], valor: r[10],
      acum: r[11], pct: r[12], esperada: r[13], desglose: r[14], estado: String(r[15] || ''), mensaje: String(r[16] || ''),
      urlPlanilla: String(r[17] || ''), urlFactura: String(r[18] || ''), obs: r[19], aprobado: String(r[20] || ''),
      lectura: String(r[21] || ''), extras: [], diasManual: '', motivo: '', urlsExtra: '', urlPdf: conPdf ? String(r[34] || '') : ''
    };
    if (v3) {
      for (var k = 0; k < HOMO.MAX_ADICIONALES; k++) {
        var b = HOMO.COLS_CARGA_V2 + k * 3, num = textoPlanilla_(r[b]);
        if (num) fila.extras.push({ numero: num, mesCot: ymdCelda_(r[b + 1], tz).slice(0, 7), valor: r[b + 2] });
      }
      fila.diasManual = r[31] === null || r[31] === undefined ? '' : r[31];
      fila.motivo = String(r[32] || '');
      fila.urlsExtra = String(r[33] || '');
    }
    res.push(fila);
  }
  return res;
}

/** Filas de CARGA que cuentan como "otras planillas" para revisar repetidas (todas menos la misma clave). */
function otrasPlanillas_(carga, contratista, mes) {
  var res = [];
  for (var i = 0; i < carga.length; i++) {
    var r = carga[i];
    if (r.contratista === contratista && r.mes === mes) continue;
    if (r.planilla) res.push({ numero: r.planilla, mismaContratista: r.contratista === contratista, mes: r.mes });
    (r.extras || []).forEach(function (x) {
      res.push({ numero: x.numero, mismaContratista: r.contratista === contratista, mes: r.mes });
    });
  }
  return res;
}

function contextoContratista_(nombre, pin) {
  var ss = SpreadsheetApp.getActive();
  var contratos = leerContratos_(ss);
  var c = autenticar_(contratos, nombre, pin);
  return {
    ss: ss, contratos: contratos, contrato: c, params: leerParametros_(ss), carga: leerCarga_(ss),
    v3: esCargaV3_(hoja_(ss, HOMO.HOJA_CARGA)), pdfCol: tieneColumnaPdf_(hoja_(ss, HOMO.HOJA_CARGA))
  };
}

// ===================================================================================
//  PIN y límite de intentos
// ===================================================================================

function claveIntentos_(nombre) {
  return 'pinfail_' + normTxt_(nombre).replace(/[^a-z0-9]+/g, '_').slice(0, 120);
}

/** Valida nombre + PIN (últimos 4 dígitos de la cédula). Se llama en CADA función del servidor. */
function autenticar_(contratos, nombre, pin) {
  nombre = String(nombre || '').trim();
  pin = String(pin || '').trim();
  if (!nombre || !/^\d{4}$/.test(pin)) throw amable_('Escoge tu nombre y escribe tu PIN de 4 números.');
  var cache = CacheService.getScriptCache(), clave = claveIntentos_(nombre);
  var fallos = Number(cache.get(clave) || 0);
  if (fallos >= HOMO.MAX_INTENTOS_PIN) {
    throw amable_('Ya intentaste muchas veces con un PIN incorrecto. Espera 10 minutos e inténtalo de nuevo, o habla con tu supervisor.');
  }
  var c = buscarContrato_(contratos, nombre);
  var ok = !!(c && c.activo && c.cedula && ultimos4_(c.cedula).length === 4 && ultimos4_(c.cedula) === pin);
  if (!ok) {
    cache.put(clave, String(fallos + 1), HOMO.VENTANA_PIN_SEG);
    throw amable_('El nombre o el PIN no son correctos. El PIN son los últimos 4 números de tu cédula.');
  }
  if (fallos) cache.remove(clave);
  return c;
}

// ===================================================================================
//  Carpetas de Drive
// ===================================================================================

function subcarpeta_(padre, nombre) {
  nombre = limpiarNombreArchivo_(nombre);
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

/** Carpeta raíz: la de PARAMETROS!B15; si está vacía o ya no existe, se crea "Cuentas de cobro HOMO" y se guarda su ID. */
function carpetaRaiz_(ss) {
  var h = hoja_(ss, HOMO.HOJA_PARAMETROS);
  var id = String(h.getRange('B15').getValue() || '').trim();
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) {
      console.error('La carpeta guardada en PARAMETROS!B15 no se puede abrir; se crea una nueva. ' + e);
    }
  }
  var nueva = DriveApp.createFolder(HOMO.CARPETA_RAIZ);
  h.getRange('B15').setValue(nueva.getId());
  return nueva;
}

function carpetaTemporal_(ss) { return subcarpeta_(carpetaRaiz_(ss), HOMO.CARPETA_TEMPORAL); }

function carpetaMes_(ss, contratista, mes) {
  return subcarpeta_(subcarpeta_(carpetaRaiz_(ss), contratista), mes);
}

/** Manda a la papelera las planillas temporales de más de 24 horas (por si alguien no terminó el envío). */
function limpiarTemporales_(carpeta) {
  try {
    var limite = new Date().getTime() - 24 * 3600 * 1000, it = carpeta.getFiles(), n = 0;
    while (it.hasNext() && n < 30) {
      var f = it.next(); n++;
      if (f.getDateCreated().getTime() < limite) f.setTrashed(true);
    }
  } catch (e) { console.error('No se pudo limpiar la carpeta temporal: ' + e); }
}

function borrarSiExiste_(carpeta, nombre) {
  var it = carpeta.getFilesByName(nombre);
  while (it.hasNext()) it.next().setTrashed(true);
}

// ===================================================================================
//  Archivo de la planilla: validación, OCR y lectura
// ===================================================================================

function tipoArchivo_(bytes) {
  function b(i) { return bytes[i] & 0xFF; }
  if (!bytes || bytes.length < 8) return null;
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return { mime: 'application/pdf', ext: 'pdf' };
  if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47) return { mime: 'image/png', ext: 'png' };
  return null;
}

/** Convierte el PDF/imagen en un Google Doc con OCR, lee el texto y borra el Doc temporal. */
function ocrTexto_(blob) {
  var docId = null;
  try {
    var creado;
    try {
      creado = Drive.Files.create({ name: 'ocr-temporal-' + new Date().getTime(), mimeType: 'application/vnd.google-apps.document' },
        blob, { ocrLanguage: 'es' });
    } catch (e3) {
      console.error('Drive v3 no pudo convertir el archivo: ' + e3);
      if (typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.insert === 'function') {
        creado = Drive.Files.insert({ title: 'ocr-temporal-' + new Date().getTime(), mimeType: 'application/vnd.google-apps.document' },
          blob, { ocr: true, ocrLanguage: 'es' });
      } else {
        throw e3;
      }
    }
    docId = creado.id;
    return DocumentApp.openById(docId).getBody().getText();
  } finally {
    if (docId) {
      try { Drive.Files.remove(docId); } catch (e1) {
        try { DriveApp.getFileById(docId).setTrashed(true); } catch (e2) { console.error('No se pudo borrar el Doc temporal ' + docId + ': ' + e2); }
      }
    }
  }
}

var RANGO_CONFIANZA_ = { alta: 3, media: 2, baja: 1 };

/** Texto que el navegador extrajo del PDF con pdf.js (capa de texto real). Recortado; '' si no es texto. */
function textoNavegador_(t) {
  if (typeof t !== 'string') return '';
  return t.length > HOMO.MAX_TEXTO_NAVEGADOR ? t.substring(0, HOMO.MAX_TEXTO_NAVEGADOR) : t;
}

/**
 * Lee la planilla con la mejor fuente disponible. Orden:
 *  1) texto del navegador (pdf.js), si tiene al menos MIN_TEXTO_NAVEGADOR caracteres;
 *  2) si no hay texto o su confianza es 'baja': OCR de Drive (ocrFn), y se queda el resultado de mayor
 *     confianza (alta > media > baja; en empate gana el del navegador).
 * Devuelve { r, fuente: 'navegador' | 'ocr' | 'ninguna', error: true si no se pudo leer con ninguna fuente }.
 */
function leerPlanillaConFuentes_(textoNav, ocrFn) {
  var mejor = null, fuente = 'ninguna', huboError = false;
  var util = String(textoNav || '').replace(/\s+/g, ' ').trim().length;
  if (util >= HOMO.MIN_TEXTO_NAVEGADOR) {
    try { mejor = parsePlanillaText(textoNav); fuente = 'navegador'; } catch (e) {
      console.error('No se pudo interpretar el texto del navegador: ' + (e && e.stack ? e.stack : e));
    }
  }
  if (!mejor || (mejor.confianza || 'baja') === 'baja') {
    try {
      var r2 = parsePlanillaText(ocrFn());
      if (!mejor || (RANGO_CONFIANZA_[r2.confianza] || 1) > (RANGO_CONFIANZA_[mejor.confianza] || 1)) { mejor = r2; fuente = 'ocr'; }
    } catch (e2) {
      console.error('No se pudo leer la planilla con OCR: ' + (e2 && e2.stack ? e2.stack : e2));
      if (!mejor) huboError = true;
    }
  }
  return { r: mejor, fuente: fuente, error: huboError || !mejor };
}

/** Datos escritos/leídos por la contratista, limpios. */
function limpiarDatos_(d) {
  d = d || {};
  var numero = String(d.numero === null || d.numero === undefined ? '' : d.numero).replace(/\s/g, '');
  var per = String(d.periodo || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(per)) per = '';
  return { numero: numero, periodo: per, salud: monto_(d.salud), pension: monto_(d.pension), arl: monto_(d.arl) };
}

function fechaValida_(s) { s = String(s || '').trim(); return Calc.parseYMD(s) ? s : ''; }

/** Planillas adicionales que manda el navegador: [{numero, periodo, valor, tempId}] -> limpias (se descartan las vacías). */
function limpiarAdicionales_(lista) {
  var res = [];
  if (!Array.isArray(lista)) return res;
  for (var i = 0; i < lista.length && res.length < 8; i++) {
    var a = lista[i] || {};
    var numero = String(a.numero === null || a.numero === undefined ? '' : a.numero).replace(/\s/g, '');
    var valor = monto_(a.valor);
    var per = String(a.periodo || a.mesCotizado || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(per)) per = '';
    if (!numero && valor === null) continue;
    res.push({ numero: numero, mesCotizado: per, valor: valor, tempId: String(a.tempId || '') });
  }
  return res;
}

/** Días a cobrar a mano: { dias, motivo } o null si no se usó. */
function limpiarDiasManual_(d) {
  if (!d || typeof d !== 'object') return null;
  var dias = String(d.dias === null || d.dias === undefined ? '' : d.dias).trim();
  var motivo = String(d.motivo === null || d.motivo === undefined ? '' : d.motivo).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (dias === '' && motivo === '') return null;
  return { dias: dias, motivo: motivo };
}

function evaluarEnvio_(ctx, mes, fechaInicio, fechaCorte, datos, extra) {
  extra = extra || {};
  return Calc.evaluate({
    contrato: ctx.contrato, params: ctx.params, mes: mes,
    periodo: { inicio: fechaValida_(fechaInicio), corte: fechaValida_(fechaCorte) },
    planilla: { numero: datos.numero, mesCotizado: datos.periodo, salud: datos.salud, pension: datos.pension, arl: datos.arl },
    otras: otrasPlanillas_(ctx.carga, ctx.contrato.nombre, mes),
    adicionales: extra.adicionales || [], diasManual: extra.diasManual || null
  });
}

/** Lo que pide el navegador además de los datos de la planilla principal: planillas adicionales y días a mano. */
function extrasDePedido_(p) {
  return { adicionales: limpiarAdicionales_(p.adicionales), diasManual: limpiarDiasManual_(p.diasManual) };
}

function mesValido_(mes) {
  mes = String(mes || '').trim();
  if (!Calc.parseMonth(mes)) throw amable_('Escoge el mes a cobrar.');
  return mes;
}

// ===================================================================================
//  API para la página web (Index.html)
// ===================================================================================

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Cuenta de cobro HOMO')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Pantalla 1: lista de nombres activos (solo nombres, sin datos personales). */
function api_listarContratistas() {
  return envolver_(function () {
    var nombres = leerContratos_(SpreadsheetApp.getActive()).filter(function (c) { return c.activo; })
      .map(function (c) { return c.nombre; });
    nombres.sort(function (a, b) { return normTxt_(a) < normTxt_(b) ? -1 : 1; });
    return { nombres: nombres };
  });
}

function resumenContrato_(ctx) {
  var c = ctx.contrato, meses = Calc.monthsBetween(c.inicio, c.fin), hoy = mesActual_();
  var filas = {};
  ctx.carga.forEach(function (r) { if (r.contratista === c.nombre) filas[r.mes] = r; });
  var lista = meses.map(function (k) {
    var p = Calc.expectedPeriod(k, c.inicio, c.fin), dias = Calc.commercialDays(p.inicio, p.corte);
    return {
      key: k, label: Calc.monthLabel(k), inicio: p.inicio, corte: p.corte, dias: dias,
      valor: Calc.periodValue(c.honorario, dias), enviado: filas[k] ? filas[k].estado : ''
    };
  });
  var def = meses.indexOf(hoy) >= 0 ? hoy : (hoy < meses[0] ? meses[0] : meses[meses.length - 1]);
  return {
    nombre: c.nombre, numeroContrato: c.numero, honorario: c.honorario, inicio: c.inicio, fin: c.fin,
    riesgo: Calc.riskFor(c, def), meses: lista, mesDefault: def, v3: !!ctx.v3
  };
}

/** Pantalla 1 -> 2: entra con nombre + PIN. */
function api_login(nombre, pin) {
  return envolver_(function () {
    var ctx = contextoContratista_(nombre, pin);
    if (!ctx.contrato.inicio || !ctx.contrato.fin || !isFinite(ctx.contrato.honorario)) {
      throw amable_('Tu contrato no tiene las fechas o el honorario completos en la hoja. Avisa a tu supervisor.');
    }
    return { contrato: resumenContrato_(ctx) };
  });
}

/** Revisa datos (escritos o corregidos) sin guardar nada. */
function api_evaluar(p) {
  return envolver_(function () {
    p = p || {};
    var ctx = contextoContratista_(p.nombre, p.pin);
    var mes = mesValido_(p.mes);
    return { evaluacion: evaluarEnvio_(ctx, mes, p.fechaInicio, p.fechaCorte, limpiarDatos_(p.datos), extrasDePedido_(p)) };
  });
}

/** Paso 3: recibe la planilla (base64) y, si es PDF, el texto que el navegador sacó con pdf.js (p.texto); la guarda temporal,
 *  la lee (texto del navegador primero, OCR de Drive de respaldo) y devuelve lo leído + la evaluación.
 *  p.adicional = true: es una planilla adicional (corrección...): se lee igual pero no se evalúa. */
function api_leerPlanilla(p) {
  return envolver_(function () {
    p = p || {};
    var ctx = contextoContratista_(p.nombre, p.pin);
    var mes = mesValido_(p.mes);
    var b64 = p.archivo && p.archivo.base64 ? String(p.archivo.base64).replace(/^data:[^,]*,/, '') : '';
    if (!b64) throw amable_('No recibimos el archivo. Vuelve a elegirlo.');
    if (b64.length > HOMO.MAX_BYTES * 1.4) throw amable_('El archivo pesa más de 10 MB. Sube un PDF más liviano o una foto.');
    var bytes;
    try { bytes = Utilities.base64Decode(b64); } catch (e) { throw amable_('No pudimos abrir el archivo. Vuelve a elegirlo.'); }
    if (bytes.length > HOMO.MAX_BYTES) throw amable_('El archivo pesa más de 10 MB. Sube un PDF más liviano o una foto.');
    var tipo = tipoArchivo_(bytes);
    if (!tipo) throw amable_('Solo podemos recibir archivos PDF, JPG o PNG.');

    var temporal = carpetaTemporal_(ctx.ss);
    limpiarTemporales_(temporal);
    var blob = Utilities.newBlob(bytes, tipo.mime, 'planilla.' + tipo.ext);
    var archivo = temporal.createFile(blob).setName('tmp-' + Utilities.getUuid() + '.' + tipo.ext);
    var tempId = archivo.getId();

    var lectura = { numero: '', periodo: '', salud: null, pension: null, arl: null };
    var confianza = 'baja', notas = [], leyo = false, tipoDoc = 'otro', fuente = 'ninguna';
    // Texto real del PDF sacado en el navegador con pdf.js (solo tiene sentido para PDF; las fotos van directo al OCR)
    var textoNav = tipo.ext === 'pdf' ? textoNavegador_(p.texto) : '';
    try {
      var lec = leerPlanillaConFuentes_(textoNav, function () {
        return ocrTexto_(Utilities.newBlob(bytes, tipo.mime, 'planilla.' + tipo.ext));
      });
      fuente = lec.fuente;
      if (lec.error) notas.push('No pudimos leer el archivo automáticamente.');
      var r = lec.r;
      if (r) {
        confianza = r.confianza || 'baja';
        notas = r.notas || [];
        tipoDoc = r.tipo || 'otro';
        if (confianza !== 'baja') {
          lectura = { numero: r.numero || '', periodo: r.periodo || '', salud: r.salud, pension: r.pension, arl: r.arl };
          leyo = !!(r.numero || r.periodo || r.salud !== null || r.pension !== null || r.arl !== null);
        }
      }
    } catch (e) {
      console.error('No se pudo leer la planilla: ' + (e && e.stack ? e.stack : e));
      notas.push('No pudimos leer el archivo automáticamente.');
    }
    console.log('api_leerPlanilla: fuente=' + fuente + ', texto del navegador=' + textoNav.length + ' caracteres, confianza=' + confianza + ', leyo=' + leyo);

    CacheService.getScriptCache().put('lec_' + tempId, JSON.stringify({
      nombre: ctx.contrato.nombre, tipo: tipo.ext, leyo: leyo, lectura: lectura
    }), HOMO.CACHE_LECTURA_SEG);

    // Planilla ADICIONAL (corrección, ajuste, otra planilla): no se valida contra lo esperado; solo se propone n.º, mes y valor total
    var evaluacion = null, valor = null;
    if (p.adicional) {
      if (leyo && lectura.salud !== null && lectura.pension !== null && lectura.arl !== null) valor = lectura.salud + lectura.pension + lectura.arl;
    } else if (leyo) {
      evaluacion = evaluarEnvio_(ctx, mes, p.fechaInicio, p.fechaCorte, limpiarDatos_(lectura), extrasDePedido_(p));
    }
    return {
      tempId: tempId, leyo: leyo, confianza: confianza, tipoDoc: tipoDoc, fuente: fuente, notas: notas, lectura: lectura,
      evaluacion: evaluacion, valor: valor
    };
  });
}

/** Pantalla 5: guarda todo, genera la cuenta de cobro y avisa. La evaluación del servidor es la que manda. */
function api_enviar(p) {
  return envolver_(function () {
    p = p || {};
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw amable_('Hay varias personas enviando su planilla al mismo tiempo. Espera un minuto e inténtalo otra vez.');
    }
    try {
      return procesarEnvio_(p);
    } finally {
      lock.releaseLock();
    }
  });
}

/** Lee del caché la planilla temporal subida por esta contratista; lanza un mensaje amable si no existe. */
function planillaTemporal_(tempId, contratista) {
  var raw = tempId ? CacheService.getScriptCache().get('lec_' + tempId) : null;
  if (!raw) throw amable_('No encontramos la planilla que subiste (pudo vencerse). Vuelve a subirla, por favor.');
  var lec = JSON.parse(raw);
  if (lec.nombre !== contratista) throw amable_('No encontramos la planilla que subiste. Vuelve a subirla, por favor.');
  return lec;
}

/** Pasa un archivo temporal a la carpeta definitiva con su nombre final y devuelve su URL. */
function guardarArchivoDefinitivo_(ss, tempId, carpeta, nombre) {
  var archivo = DriveApp.getFileById(tempId);
  borrarSiExiste_(carpeta, nombre);
  archivo.setName(nombre);
  if (typeof archivo.moveTo === 'function') archivo.moveTo(carpeta);
  else { carpeta.addFile(archivo); carpetaTemporal_(ss).removeFile(archivo); }
  return archivo.getUrl();
}

/** Borra los PDF "Planilla 2..4" de un envío anterior (un reenvío reemplaza todo el conjunto). */
function limpiarPlanillasAdicionales_(carpeta, docNum, nombre) {
  for (var n = 2; n <= HOMO.MAX_ADICIONALES + 1; n++) {
    ['pdf', 'jpg', 'png'].forEach(function (ext) {
      borrarSiExiste_(carpeta, limpiarNombreArchivo_(docNum + ' - ' + nombre + ' - Planilla ' + n + '.' + ext));
    });
  }
}

function procesarEnvio_(p) {
  var ctx = contextoContratista_(p.nombre, p.pin);
  var c = ctx.contrato, ss = ctx.ss, tz = tz_(ss);
  var mes = mesValido_(p.mes);
  if (Calc.monthsBetween(c.inicio, c.fin).indexOf(mes) < 0) {
    throw amable_('Ese mes no está dentro de la vigencia de tu contrato. Escoge otro mes.');
  }
  var datos = limpiarDatos_(p.datos), extra = extrasDePedido_(p);
  var ev = evaluarEnvio_(ctx, mes, p.fechaInicio, p.fechaCorte, datos, extra);
  // Las alertas (🟡 / 🔴) nunca bloquean; solo falta un dato obligatorio o un formato imposible.
  if (ev.bloquea) throw amable_(ev.mensaje);
  if ((ev.adicionales.length || ev.diasManual) && !ctx.v3) {
    throw amable_('Para cobrar con planillas adicionales o con días distintos, tu supervisor debe actualizar la hoja (menú Cuentas HOMO › Actualizar hoja a v3). Avísale, o envía solo con la planilla principal.');
  }

  // --- planillas temporales -> carpeta definitiva ----------------------------------
  var tempId = String(p.tempId || '');
  var lec = planillaTemporal_(tempId, c.nombre);
  var temporalesExtra = ev.adicionales.map(function (a, i) {
    var t = extra.adicionales[i] && extra.adicionales[i].tempId;
    return t ? { lec: planillaTemporal_(t, c.nombre), tempId: t } : null;
  });
  var lectura;
  if (!lec.leyo) lectura = 'manual';
  else {
    var l = limpiarDatos_(lec.lectura);
    lectura = (l.numero === datos.numero && l.periodo === datos.periodo && l.salud === datos.salud &&
      l.pension === datos.pension && l.arl === datos.arl) ? 'auto' : 'corregido';
  }
  var carpeta = carpetaMes_(ss, c.nombre, mes);
  var docNum = Calc.docNumber(mes);
  var urlPlanilla = guardarArchivoDefinitivo_(ss, tempId, carpeta,
    limpiarNombreArchivo_(docNum + ' - ' + c.nombre + ' - Planilla.' + (lec.tipo || 'pdf')));
  limpiarPlanillasAdicionales_(carpeta, docNum, c.nombre);
  var urlsExtra = [];
  temporalesExtra.forEach(function (t, i) {
    if (!t) return;
    urlsExtra.push(guardarArchivoDefinitivo_(ss, t.tempId, carpeta,
      limpiarNombreArchivo_(docNum + ' - ' + c.nombre + ' - Planilla ' + (i + 2) + '.' + (t.lec.tipo || 'pdf'))));
  });

  // --- CARGA -------------------------------------------------------------------
  var hoja = hoja_(ss, HOMO.HOJA_CARGA);
  var previa = null;
  ctx.carga.forEach(function (r) { if (r.contratista === c.nombre && r.mes === mes) previa = r; });
  var filaN = previa ? previa.fila : siguienteFila_(hoja);
  var per = ev.periodo || { inicio: fechaValida_(p.fechaInicio), corte: fechaValida_(p.fechaCorte) };
  var registro = {
    marca: new Date(), contratista: c.nombre, mes: mes, inicio: per.inicio, corte: per.corte,
    planilla: datos.numero, mesCot: datos.periodo, declarado: ev.declarado, docNum: docNum, dias: ev.dias, valor: ev.valor,
    esperada: ev.ss ? ev.ss.total : '', desglose: ev.ss ? ev.ss.desglose : (ev.parcial ? 'mes parcial: no se valida' : ''),
    estado: ev.estadoTexto, mensaje: ev.mensaje, urlPlanilla: urlPlanilla, urlFactura: '', lectura: lectura,
    extras: ev.adicionales, diasManual: ev.diasManual && extra.diasManual ? Number(extra.diasManual.dias) : '',
    motivo: ev.diasManual && extra.diasManual ? extra.diasManual.motivo : '', urlsExtra: urlsExtra.join('\n')
  };
  escribirFila_(hoja, filaN, registro, !!previa, tz, ctx.v3);
  recalcularAcumuladosContratista_(ss, hoja, c);

  // --- factura: SIEMPRE se genera (las alertas no bloquean) --------------------------
  // La cuenta de cobro principal es el EXCEL (así la recibe el HOMO); el PDF es la copia de lectura. Si uno falla, el otro se entrega igual.
  var resp = {
    estado: ev.estado, estadoTexto: ev.estadoTexto, emoji: ev.emoji, mensaje: ev.mensaje,
    facturaXlsx: null, facturaPdf: null, correoContratista: false, aviso: ''
  };
  var adjuntos = [];
  var g = generarFactura_(ss, hoja, filaN, c.nombre, mes);
  registro.urlFactura = g.xlsx ? g.xlsx.url : '';
  registro.urlPdf = g.pdf ? g.pdf.url : '';
  hoja.getRange(filaN, 19).setValue(registro.urlFactura);
  if (ctx.pdfCol) hoja.getRange(filaN, HOMO.COLS_CARGA).setValue(registro.urlPdf);
  if (g.xlsx) { adjuntos.push(g.xlsx.blob); resp.facturaXlsx = datosArchivo_(g.xlsx.blob, HOMO.MIME_XLSX); }
  if (g.pdf) { adjuntos.push(g.pdf.blob); resp.facturaPdf = datosArchivo_(g.pdf.blob, 'application/pdf'); }
  resp.aviso = avisoFactura_(g);

  // --- correos ---------------------------------------------------------------
  try { resp.correoContratista = enviarCorreos_(ctx, c, mes, ev, registro, adjuntos, filaN, ss); } catch (e) {
    console.error('Error enviando correos: ' + e);
  }
  return resp;
}

// ===================================================================================
//  Escritura en CARGA
// ===================================================================================

function siguienteFila_(hoja) {
  var ult = hoja.getLastRow();
  if (ult < 2) return 2;
  var col = hoja.getRange(2, 2, ult - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) if (String(col[i][0] || '').trim()) return i + 3;
  return 2;
}

function escribirFila_(hoja, fila, r, esReemplazo, tz, v3) {
  var cols = v3 ? Math.min(hoja.getMaxColumns(), HOMO.COLS_CARGA) : HOMO.COLS_CARGA_V2;
  if (fila > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 50);
  if (fila > 1000) {   // el formato de la plantilla llega hasta la fila 1000: se hereda de la fila anterior
    try {
      hoja.getRange(fila - 1, 1, 1, cols).copyTo(hoja.getRange(fila, 1, 1, cols),
        SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    } catch (e) { console.error('No se pudo copiar el formato a la fila ' + fila + ': ' + e); }
  }
  hoja.getRange(fila, 6).setNumberFormat('@');
  function nn(v) { return v === null || v === undefined ? '' : v; }
  var valores = [[
    r.marca, r.contratista, ymdADate_(r.mes + '-01', tz), ymdADate_(r.inicio, tz), ymdADate_(r.corte, tz),
    String(r.planilla), r.mesCot ? ymdADate_(r.mesCot + '-01', tz) : '', nn(r.declarado), r.docNum, nn(r.dias), nn(r.valor),
    '', '', nn(r.esperada), r.desglose, r.estado, r.mensaje, r.urlPlanilla, r.urlFactura
  ]];
  hoja.getRange(fila, 1, 1, 19).setValues(valores);
  hoja.getRange(fila, 22).setValue(r.lectura);
  if (v3) {
    // W..AH: planillas 2-4 (n.º, mes cotizado, valor), días a mano, motivo y URLs de los PDF adicionales (se reescribe todo el bloque)
    var ex = r.extras || [], bloque = [];
    for (var k = 0; k < HOMO.MAX_ADICIONALES; k++) {
      var x = ex[k];
      bloque.push(x ? String(x.numero) : '', x && x.mesCotizado ? ymdADate_(x.mesCotizado + '-01', tz) : '', x ? x.valor : '');
      hoja.getRange(fila, HOMO.COLS_CARGA_V2 + 1 + k * 3).setNumberFormat('@');
    }
    bloque.push(nn(r.diasManual), r.motivo || '', r.urlsExtra || '');
    hoja.getRange(fila, HOMO.COLS_CARGA_V2 + 1, 1, 12).setValues([bloque]);
  }
  if (esReemplazo) hoja.getRange(fila, 21).setValue('');   // un reenvío anula la aprobación anterior
}

/** Recalcula acumulado (L) y % (M) de TODAS las filas de una contratista, en orden de mes. */
function recalcularAcumuladosContratista_(ss, hoja, contrato) {
  var filas = leerCarga_(ss).filter(function (r) { return r.contratista === contrato.nombre; });
  filas.sort(function (a, b) { return a.mes < b.mes ? -1 : (a.mes > b.mes ? 1 : 0); });
  var valores = {};
  filas.forEach(function (r) { if (isFinite(Number(r.valor)) && r.valor !== '') valores[r.mes] = Number(r.valor); });
  filas.forEach(function (r) {
    var a = Calc.cumulative(contrato, r.mes, valores);
    hoja.getRange(r.fila, 12, 1, 2).setValues([[a.acumulado, a.pct]]);
  });
}

// ===================================================================================
//  Factura en PDF (hoja FACTURA)
// ===================================================================================

/** Filas de FACTURA con el texto fijo "planilla pila #." (columna C): [principal, adicional 1, 2, 3]. */
function filasPlanillaFactura_(hoja) {
  var n = Math.min(hoja.getMaxRows(), 120), v = hoja.getRange(1, 3, n, 1).getValues(), res = [];
  for (var i = 0; i < v.length; i++) if (normTxt_(v[i][0]).indexOf('planilla pila') >= 0) res.push(i + 1);
  return res;
}

/** Última fila del formato oficial (A..N): la última con contenido, ampliada si cae dentro de una celda combinada. */
function ultimaFilaFormato_(hoja) {
  var n = Math.min(hoja.getMaxRows(), 150), rango = hoja.getRange(1, 1, n, 14), v = rango.getValues(), ult = 0, i, j;
  for (i = 0; i < v.length; i++) {
    for (j = 0; j < v[i].length; j++) if (v[i][j] !== '' && v[i][j] !== null && v[i][j] !== undefined) { ult = i + 1; break; }
  }
  try {
    rango.getMergedRanges().forEach(function (m) {
      if (m.getRow() <= ult && m.getLastRow() > ult) ult = m.getLastRow();
    });
  } catch (e) { console.error('No se pudieron leer las celdas combinadas de FACTURA: ' + e); }
  return ult < 30 ? 48 : ult;      // 48 = formato original; si no se encuentra nada, se usa ese
}

/** Filas de planillas adicionales de FACTURA que NO se usan en esta factura (sin n.º en CARGA): se ocultan al exportar. */
function filasAdicionalesVacias_(ss, hojaFactura, filaCarga) {
  var filas = filasPlanillaFactura_(hojaFactura).slice(1, 1 + HOMO.MAX_ADICIONALES);
  if (!filas.length) return [];
  var carga = hoja_(ss, HOMO.HOJA_CARGA);
  if (esCargaV3_(carga)) {
    var v = carga.getRange(filaCarga, HOMO.COLS_CARGA_V2 + 1, 1, 9).getValues()[0];
    return filas.filter(function (f, i) { return !textoPlanilla_(v[i * 3]); });   // se ocultan solo las que no tienen n.º de planilla
  }
  return filas;     // hoja sin migrar: no hay datos de planillas adicionales, se ocultan todas
}

function exportarFacturaPdf_(ss, filaCarga, nombreArchivo) {
  var hoja = hoja_(ss, HOMO.HOJA_FACTURA);
  hoja.getRange('P1').setValue(filaCarga);
  SpreadsheetApp.flush();
  var ocultas = [];
  try {
    filasAdicionalesVacias_(ss, hoja, filaCarga).forEach(function (f) { hoja.hideRows(f, 1); ocultas.push(f); });
    SpreadsheetApp.flush();
    Utilities.sleep(1500);          // deja que las fórmulas de FACTURA terminen de calcularse
    var ultima = ultimaFilaFormato_(hoja);
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + hoja.getSheetId() +
      '&range=A1%3AN' + ultima + '&size=letter&portrait=true&fitw=true&scale=4&gridlines=false&printtitle=false&sheetnames=false' +
      '&pagenum=UNDEFINED&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4&horizontal_alignment=CENTER';
    var opciones = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
    var resp = UrlFetchApp.fetch(url, opciones);
    if (resp.getResponseCode() === 429) {         // Google pide esperar: se reintenta una vez
      Utilities.sleep(4000);
      resp = UrlFetchApp.fetch(url, opciones);
    }
    var codigo = resp.getResponseCode();
    if (codigo !== 200) throw new Error('La exportación a PDF devolvió el código ' + codigo);
    var blob = resp.getBlob();
    var tipo = String(blob.getContentType() || '');
    if (tipo.indexOf('pdf') < 0) throw new Error('La exportación no devolvió un PDF (tipo ' + tipo + ')');
    return blob.setName(nombreArchivo);
  } finally {
    // SIEMPRE se vuelven a mostrar las filas ocultas, aunque la exportación falle
    ocultas.forEach(function (f) { try { hoja.showRows(f, 1); } catch (e) { console.error('No se pudo volver a mostrar la fila ' + f + ' de FACTURA: ' + e); } });
    if (ocultas.length) SpreadsheetApp.flush();
  }
}

/** Archivo en base64 para la pantalla. */
function datosArchivo_(blob, mime) {
  return { nombre: blob.getName(), base64: Utilities.base64Encode(blob.getBytes()), mime: mime };
}

/**
 * Exporta la hoja FACTURA a un Excel (.xlsx). Google no exporta "una sola hoja con fórmulas resueltas", así que se arma una
 * hoja de cálculo TEMPORAL: se copia FACTURA, se dejan solo los valores (sin fórmulas, que apuntarían a hojas que no existen
 * ahí), se borran las filas de planillas adicionales vacías, la columna P y todo lo que queda fuera de A1:N(última), y se exporta.
 * La temporal siempre se manda a la papelera (finally).
 */
function exportarFacturaXlsx_(ss, filaCarga, nombreArchivo) {
  var hoja = hoja_(ss, HOMO.HOJA_FACTURA);
  hoja.getRange('P1').setValue(filaCarga);
  SpreadsheetApp.flush();
  Utilities.sleep(1500);            // deja que las fórmulas de FACTURA terminen de calcularse
  var ultima = ultimaFilaFormato_(hoja);
  var vacias = filasAdicionalesVacias_(ss, hoja, filaCarga);
  // los valores ya calculados de la hoja ORIGINAL (no dependen de que la copia recalcule nada)
  var valores = hoja.getRange(1, 1, ultima, 14).getValues();
  var temp = null;
  try {
    temp = SpreadsheetApp.create('_temporal ' + nombreArchivo);
    try { DriveApp.getFileById(temp.getId()).moveTo(carpetaTemporal_(ss)); }
    catch (e) { console.error('No se pudo mover la hoja temporal a la carpeta _temporal: ' + e); }
    var copia = hoja.copyTo(temp);
    try {
      if (hoja.getImages && copia.getImages && copia.getImages().length < hoja.getImages().length) {
        console.warn('La copia de FACTURA perdió imágenes (logos): ' + copia.getImages().length + ' de ' + hoja.getImages().length + '.');
      }
    } catch (e) { /* solo informativo */ }
    copia.getRange(1, 1, ultima, 14).setValues(valores);                 // TODO a valores: ya no queda ninguna fórmula
    var maxC = copia.getMaxColumns();
    if (maxC > 14) copia.deleteColumns(15, maxC - 14);                  // fuera la columna P (y Q...) y todo lo que sobre
    var maxR = copia.getMaxRows();
    if (maxR > ultima) copia.deleteRows(ultima + 1, maxR - ultima);
    vacias.slice().sort(function (a, b) { return b - a; }).forEach(function (f) { copia.deleteRows(f, 1); });   // de abajo hacia arriba
    temp.getSheets().forEach(function (sh) { if (sh.getSheetId() !== copia.getSheetId()) temp.deleteSheet(sh); });
    copia.setName(HOMO.HOJA_FACTURA);
    SpreadsheetApp.flush();

    var url = 'https://docs.google.com/spreadsheets/d/' + temp.getId() + '/export?format=xlsx';
    var opciones = { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
    var resp = UrlFetchApp.fetch(url, opciones);
    if (resp.getResponseCode() === 429) {         // Google pide esperar: se reintenta una vez
      Utilities.sleep(4000);
      resp = UrlFetchApp.fetch(url, opciones);
    }
    var codigo = resp.getResponseCode();
    if (codigo !== 200) throw new Error('La exportación a Excel devolvió el código ' + codigo);
    var blob = resp.getBlob();
    var tipo = String(blob.getContentType() || '');
    var b = blob.getBytes();
    if (tipo.indexOf('spreadsheetml') < 0 && tipo.indexOf('excel') < 0) throw new Error('La exportación no devolvió un Excel (tipo ' + tipo + ')');
    if (!b || b.length < 4 || (b[0] & 0xFF) !== 0x50 || (b[1] & 0xFF) !== 0x4B) throw new Error('El archivo exportado no parece un .xlsx (no es un zip)');
    return blob.setName(nombreArchivo);
  } finally {
    // SIEMPRE se manda la hoja temporal a la papelera, aunque algo falle
    if (temp) {
      try { DriveApp.getFileById(temp.getId()).setTrashed(true); }
      catch (e) { console.error('No se pudo mandar a la papelera la hoja temporal ' + temp.getId() + ': ' + e); }
    }
  }
}

/**
 * Genera la cuenta de cobro de una fila de CARGA en EXCEL (principal) y en PDF (copia de lectura) y guarda ambos en la carpeta
 * contratista / AAAA-MM. Si uno falla, el otro se entrega igual: nunca lanza error por una exportación. Requiere tener el candado.
 * Devuelve { xlsx: {blob,url,id}|null, pdf: {blob,url,id}|null, errores: [...] }.
 */
function generarFactura_(ss, hojaCarga, filaCarga, contratista, mes) {
  var base = limpiarNombreArchivo_(Calc.docNumber(mes) + ' - ' + contratista + ' - Cuenta de cobro');
  var res = { xlsx: null, pdf: null, errores: [] };
  var carpeta = null;
  [['xlsx', exportarFacturaXlsx_], ['pdf', exportarFacturaPdf_]].forEach(function (par) {
    var tipo = par[0], nombre = base + '.' + tipo;
    try {
      var blob = par[1](ss, filaCarga, nombre);
      if (!carpeta) carpeta = carpetaMes_(ss, contratista, mes);
      borrarSiExiste_(carpeta, nombre);
      var f = carpeta.createFile(blob);
      res[tipo] = { blob: blob, url: f.getUrl(), id: f.getId() };
    } catch (e) {
      console.error('No se pudo generar la cuenta de cobro en ' + tipo + ' (fila ' + filaCarga + '): ' + (e && e.stack ? e.stack : e));
      res.errores.push(tipo);
    }
  });
  return res;
}

/** Aviso amable para la contratista según lo que se pudo generar. */
function avisoFactura_(g) {
  if (g.xlsx && g.pdf) return '';
  if (g.pdf) return 'No pudimos armar el Excel de tu cuenta de cobro en este momento; te dejamos el PDF. Tu supervisor puede generar el Excel desde la hoja.';
  if (g.xlsx) return 'Tu cuenta de cobro en Excel está lista. El PDF de lectura no se pudo generar ahora; no lo necesitas para entregarla.';
  return 'Tu planilla quedó guardada, pero ahora no pudimos generar la cuenta de cobro (Excel ni PDF). ' +
    'Avisa a tu supervisor: él puede generarla desde la hoja.';
}

// ===================================================================================
//  Correos
// ===================================================================================

function enviarCorreos_(ctx, c, mes, ev, registro, adjuntos, filaN, ss) {
  var enviado = false, P = ctx.params, mesTxt = Calc.monthLabel(mes);
  adjuntos = adjuntos || [];
  if (adjuntos.length && P.enviarCorreo && esCorreo_(c.correo)) {
    MailApp.sendEmail({
      to: c.correo.trim(), name: 'Cuentas de cobro HOMO',
      subject: 'Tu cuenta de cobro de ' + mesTxt + ' (HOMO)',
      body: 'Hola ' + c.nombre + ',\n\nAdjuntamos tu cuenta de cobro de ' + mesTxt + ' al Hospital Mental de Antioquia' +
        (adjuntos.length > 1 ? ': el Excel (el que se entrega) y el PDF (copia para leer).' : '.') + '\n' +
        (ev.estado !== 'OK' ? '\nTen en cuenta: ' + ev.mensaje + '\n' : '') +
        '\nRecuerda firmarla y entregarla junto con tu informe de actividades.\n\nGracias.',
      attachments: adjuntos
    });
    enviado = true;
  }
  if (P.correoSupervisor) {
    var destinos = P.correoSupervisor.split(/[;,\s]+/).filter(esCorreo_).join(',');
    if (destinos) {
      MailApp.sendEmail({
        to: destinos, name: 'Cuentas de cobro HOMO',
        subject: '[Cuentas HOMO] ' + ev.emoji + ' ' + c.nombre + ' - ' + mesTxt,
        body: 'Estado: ' + ev.estadoTexto + '\nContratista: ' + c.nombre + '\nMes a cobrar: ' + mesTxt +
          '\nPlanilla n.º ' + registro.planilla + ' (mes cotizado ' + (registro.mesCot ? Calc.monthLabel(registro.mesCot) : 'sin dato') + ')' +
          (registro.extras && registro.extras.length ? '\nPlanillas adicionales:' + registro.extras.map(function (x, i) {
            return '\n  ' + (i + 2) + ') n.º ' + x.numero + ' (mes cotizado ' + (x.mesCotizado ? Calc.monthLabel(x.mesCotizado) : 'sin dato') + ') por ' + Calc.fmtMoney(x.valor);
          }).join('') : '') +
          (registro.diasManual !== '' && registro.diasManual !== undefined ? '\nDías cobrados a mano: ' + registro.diasManual + ' (' + registro.motivo + ')' : '') +
          '\nLectura: ' + registro.lectura + '\n\nMensaje: ' + ev.mensaje + '\n\n' +
          'Fila en la hoja: ' + filaN + '\nPlanilla: ' + registro.urlPlanilla +
          (registro.urlsExtra ? '\nPlanillas adicionales (PDF): ' + registro.urlsExtra.replace(/\n/g, ' , ') : '') +
          (registro.urlFactura ? '\nCuenta de cobro (Excel): ' + registro.urlFactura : '\n(No se generó la cuenta de cobro en Excel.)') +
          (registro.urlPdf ? '\nCuenta de cobro (PDF): ' + registro.urlPdf : '\n(No se generó el PDF de la cuenta de cobro.)') +
          '\nHoja: ' + ss.getUrl()
      });
    }
  }
  return enviado;
}

// ===================================================================================
//  Menú "Cuentas HOMO" (supervisor)
// ===================================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Cuentas HOMO')
    .addItem('Regenerar factura de la fila seleccionada', 'regenerarFacturaFilaSeleccionada')
    .addItem('Recalcular todo (acumulados y estados)', 'recalcularTodo')
    .addSeparator()
    .addItem('Abrir el link de la app', 'abrirLinkApp')
    .addItem('Configuración inicial', 'configuracionInicial')
    .addItem('Actualizar hoja a v3 (una sola vez)', 'actualizarHojaV3')
    .addToUi();
}

function avisar_(titulo, texto) {
  try { SpreadsheetApp.getUi().alert(titulo, texto, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { console.log(titulo + '\n' + texto); }
}

function preguntar_(titulo, texto) {
  try {
    var ui = SpreadsheetApp.getUi();
    return ui.alert(titulo, texto, ui.ButtonSet.YES_NO) === ui.Button.YES;
  } catch (e) { return false; }
}

function regenerarFacturaFilaSeleccionada() {
  var ss = SpreadsheetApp.getActive(), hoja = ss.getActiveSheet();
  if (hoja.getName() !== HOMO.HOJA_CARGA) {
    avisar_('Regenerar factura', 'Primero ve a la hoja CARGA y haz clic en cualquier celda de la fila que quieres regenerar.');
    return;
  }
  var fila = hoja.getActiveRange().getRow();
  if (fila < 2) { avisar_('Regenerar factura', 'Haz clic en una fila con datos (no en los encabezados).'); return; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { avisar_('Regenerar factura', 'Hay otro envío en curso. Inténtalo de nuevo en un minuto.'); return; }
  try {
    var r = leerCarga_(ss).filter(function (x) { return x.fila === fila; })[0];
    if (!r) { avisar_('Regenerar factura', 'La fila ' + fila + ' está vacía.'); return; }
    // Las alertas (🟡 / 🔴) no bloquean: la cuenta de cobro se genera siempre; ya no se pregunta nada.
    var g = generarFactura_(ss, hoja, fila, r.contratista, r.mes);
    if (!g.xlsx && !g.pdf) throw new Error('no se pudo generar ni el Excel ni el PDF (revisa el registro de ejecuciones del script).');
    hoja.getRange(fila, 19).setValue(g.xlsx ? g.xlsx.url : '');
    if (tieneColumnaPdf_(hoja)) hoja.getRange(fila, HOMO.COLS_CARGA).setValue(g.pdf ? g.pdf.url : '');
    avisar_(g.xlsx && g.pdf ? 'Factura generada' : 'Factura generada con una falla',
      'La cuenta de cobro de ' + r.contratista + ' (' + Calc.monthLabel(r.mes) + ') quedó en Drive:\n' +
      (g.xlsx ? 'Excel: ' + g.xlsx.url : 'Excel: NO se pudo generar (intenta de nuevo en un minuto).') + '\n' +
      (g.pdf ? 'PDF: ' + g.pdf.url : 'PDF: NO se pudo generar (intenta de nuevo en un minuto).'));
  } catch (e) {
    console.error('Regenerar factura: ' + (e && e.stack ? e.stack : e));
    avisar_('No se pudo generar', 'Ocurrió un error: ' + (e && e.message ? e.message : e));
  } finally {
    lock.releaseLock();
  }
}

/** Vuelve a calcular I, J, K, L, M, N, O, P y Q de todas las filas de CARGA con los datos actuales de la hoja. */
function recalcularTodo() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { avisar_('Recalcular', 'Hay otro envío en curso. Inténtalo de nuevo en un minuto.'); return; }
  try {
    var ss = SpreadsheetApp.getActive(), hoja = hoja_(ss, HOMO.HOJA_CARGA);
    var P = leerParametros_(ss), contratos = leerContratos_(ss), carga = leerCarga_(ss);
    var cuenta = { OK: 0, REVISAR: 0, ERROR: 0, omitidas: 0 }, valoresPorContratista = {};
    carga.forEach(function (r) {
      var c = buscarContrato_(contratos, r.contratista);
      if (!c || !Calc.parseMonth(r.mes)) { cuenta.omitidas++; return; }
      var ev = Calc.evaluate({
        contrato: c, params: P, mes: r.mes, periodo: { inicio: r.inicio, corte: r.corte },
        planilla: { numero: r.planilla, mesCotizado: r.mesCot, total: isFinite(Number(r.declarado)) && r.declarado !== '' ? Number(r.declarado) : null },
        otras: otrasPlanillas_(carga, r.contratista, r.mes),
        // se respetan las planillas adicionales y los días a mano que ya están guardados en la fila
        adicionales: (r.extras || []).map(function (x) { return { numero: x.numero, mesCotizado: x.mesCot, valor: x.valor }; }),
        diasManual: r.diasManual !== '' && r.diasManual !== null ? { dias: r.diasManual, motivo: r.motivo } : null
      });
      cuenta[ev.estado]++;
      var v = ev.valor !== null ? ev.valor : (isFinite(Number(r.valor)) && r.valor !== '' ? Number(r.valor) : null);
      (valoresPorContratista[c.nombre] = valoresPorContratista[c.nombre] || {})[r.mes] = v;
      r._ev = ev; r._c = c;
    });
    carga.forEach(function (r) {
      if (!r._ev) return;
      var ev = r._ev, a = Calc.cumulative(r._c, r.mes, valoresPorContratista[r._c.nombre]);
      hoja.getRange(r.fila, 9, 1, 1).setValue(ev.docNum);
      hoja.getRange(r.fila, 10, 1, 2).setValues([[ev.dias === null ? '' : ev.dias, ev.valor === null ? '' : ev.valor]]);
      hoja.getRange(r.fila, 12, 1, 2).setValues([[a.acumulado, a.pct]]);
      hoja.getRange(r.fila, 14, 1, 2).setValues([[ev.ss ? ev.ss.total : '',
        ev.ss ? ev.ss.desglose : (ev.parcial ? 'mes parcial: no se valida' : '')]]);
      hoja.getRange(r.fila, 16, 1, 2).setValues([[ev.estadoTexto, ev.mensaje]]);
    });
    avisar_('Recalculado', 'Se revisaron ' + carga.length + ' filas: ' + cuenta.OK + ' ✅, ' + cuenta.REVISAR + ' 🟡, ' + cuenta.ERROR +
      ' 🔴' + (cuenta.omitidas ? ' (' + cuenta.omitidas + ' omitidas porque la contratista o el mes no se reconocen)' : '') +
      '.\nNota: como CARGA guarda solo el total de seguridad social declarado, aquí se compara el total (no cada aporte). ' +
      'Se respetaron los días cobrados a mano y las planillas adicionales de cada fila. Las alertas nunca impiden la cuenta de cobro.');
  } catch (e) {
    console.error('Recalcular todo: ' + (e && e.stack ? e.stack : e));
    avisar_('No se pudo recalcular', 'Ocurrió un error: ' + (e && e.message ? e.message : e));
  } finally {
    lock.releaseLock();
  }
}

function urlApp_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

function abrirLinkApp() {
  var url = urlApp_();
  if (!url) {
    avisar_('Link de la app', 'Todavía no hay una aplicación web publicada. En Apps Script: Implementar › Nueva implementación › Aplicación web. ' +
      'Después vuelve a este menú.');
    return;
  }
  try {
    var html = HtmlService.createHtmlOutput(
      '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
      '<p>Este es el link que debes enviar a las contratistas:</p>' +
      '<p><a href="' + url + '" target="_blank" style="word-break:break-all">' + url + '</a></p>' +
      '<p>Cópialo con clic derecho › Copiar dirección de enlace.</p></div>').setWidth(460).setHeight(200);
    SpreadsheetApp.getUi().showModalDialog(html, 'Link de la app');
  } catch (e) { avisar_('Link de la app', url); }
}

function encabezadosOk_(hoja, fragmentos) {
  var fila = hoja.getRange(1, 1, 1, fragmentos.length).getValues()[0], mal = [];
  fragmentos.forEach(function (f, i) {
    if (normTxt_(fila[i]).indexOf(f) < 0) mal.push(String.fromCharCode(65 + i) + '1 debería mencionar «' + f + '» y dice «' + fila[i] + '»');
  });
  return mal;
}

// ===================================================================================
//  Migración a la v3 (se ejecuta UNA vez desde el editor; si se corre de nuevo no duplica nada)
// ===================================================================================

var MESES_FACTURA_ = '"Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"';

function letraColumna_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** CARGA: agrega las columnas W..AI con encabezados (mismo formato que V1) y formatos de número. Si ya tenía W..AH (v3), solo agrega AI. */
function migrarCargaV3_(ss, informe) {
  var h = hoja_(ss, HOMO.HOJA_CARGA), pend = [];
  var faltanCols = HOMO.COLS_CARGA - h.getMaxColumns();
  if (faltanCols > 0) {
    h.insertColumnsAfter(h.getMaxColumns(), faltanCols);
    informe.push('CARGA: se agregaron ' + faltanCols + ' columnas a la hoja.');
  }
  var ini = HOMO.COLS_CARGA_V2 + 1, n = HOMO.COLS_CARGA - HOMO.COLS_CARGA_V2;
  var actuales = h.getRange(1, ini, 1, n).getValues()[0], escritos = 0;
  for (var k = 0; k < n; k++) {
    var txt = String(actuales[k] === null || actuales[k] === undefined ? '' : actuales[k]).trim();
    if (!txt) { h.getRange(1, ini + k).setValue(HOMO.ENCABEZADOS_V3[k]); escritos++; }
    else if (normTxt_(txt).indexOf(HOMO.ENC_CARGA[ini - 1 + k]) < 0) {
      pend.push(letraColumna_(ini + k) + '1 dice «' + txt + '» y debería decir «' + HOMO.ENCABEZADOS_V3[k] + '» (no se tocó)');
    }
  }
  // mismo formato de encabezado que el de V1 (se repite sin problema)
  h.getRange(1, HOMO.COLS_CARGA_V2).copyTo(h.getRange(1, ini, 1, n), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  // anchos y formatos de número (filas 2 en adelante)
  var filas = Math.max(h.getMaxRows() - 1, 1);
  var fmtMes = 'dd/mm/yyyy', fmtValor = '"$ "#,##0';
  try { fmtMes = h.getRange('G2').getNumberFormat() || fmtMes; fmtValor = h.getRange('H2').getNumberFormat() || fmtValor; } catch (e) { /* se usan los de arriba */ }
  for (var q = 0; q < HOMO.MAX_ADICIONALES; q++) {
    var c0 = ini + q * 3;
    h.getRange(2, c0, filas, 1).setNumberFormat('@');
    h.getRange(2, c0 + 1, filas, 1).setNumberFormat(fmtMes);
    h.getRange(2, c0 + 2, filas, 1).setNumberFormat(fmtValor);
    h.setColumnWidth(c0, 110); h.setColumnWidth(c0 + 1, 110); h.setColumnWidth(c0 + 2, 100);
  }
  h.getRange(2, ini + 9, filas, 1).setNumberFormat('0');
  h.setColumnWidth(ini + 9, 90); h.setColumnWidth(ini + 10, 260); h.setColumnWidth(ini + 11, 320); h.setColumnWidth(ini + 12, 320);
  // S ya no es el PDF sino el Excel (la cuenta de cobro que se entrega): se aclara el encabezado SOLO si sigue como venía de fábrica
  try {
    if (normTxt_(h.getRange(1, 19).getValue()) === 'url pdf factura') {
      h.getRange(1, 19).setValue('URL factura (Excel)');
      informe.push('CARGA: S1 ahora dice «URL factura (Excel)» (el PDF queda en AI).');
    }
  } catch (e) { pend.push('CARGA: no pude revisar el encabezado de S1.'); }
  informe.push(escritos ? 'CARGA: encabezados escritos en ' + escritos + ' columna(s) de W..AI.' : 'CARGA: ya tenía las columnas W..AI (no se duplicó nada).');
  return pend;
}

function formulaExtraFactura_(colN, colV, colM, cual) {
  var N = 'INDEX(CARGA!$' + colN + ':$' + colN + ',$P$1)', V = 'INDEX(CARGA!$' + colV + ':$' + colV + ',$P$1)', M = 'INDEX(CARGA!$' + colM + ':$' + colM + ',$P$1)';
  var vacia = 'OR(N($P$1)<2,' + N + '="")';
  if (cual === 'valor') return '=IF(' + vacia + ',"",IF(' + V + '="","",' + V + '))';
  if (cual === 'numero') return '=IF(' + vacia + ',"",' + N + '&"")';
  return '=IF(' + vacia + ',"",IF(ISNUMBER(' + M + '),CHOOSE(MONTH(' + M + '),' + MESES_FACTURA_ + '),""))';
}

/** FACTURA: inserta 3 filas después de la fila "planilla pila #." copiando formato, combinaciones y textos fijos. */
function migrarFacturaV3_(ss, informe) {
  var f = hoja_(ss, HOMO.HOJA_FACTURA), pend = [];
  var filas = filasPlanillaFactura_(f);
  if (!filas.length) {
    pend.push('FACTURA: no encuentro la fila con el texto "planilla pila #." en la columna C; no se modificó la factura.');
    return pend;
  }
  var base = filas[0], hay = 0;
  while (filas[hay + 1] === base + hay + 1) hay++;               // adicionales ya existentes, seguidas de la base
  var faltan = HOMO.FILAS_EXTRA_FACTURA - hay;
  if (faltan > 0) {
    f.insertRowsAfter(base + hay, faltan);
    informe.push('FACTURA: se insertaron ' + faltan + ' fila(s) después de la fila ' + (base + hay) + '.');
  } else {
    informe.push('FACTURA: ya tenía las ' + HOMO.FILAS_EXTRA_FACTURA + ' filas de planillas adicionales (no se insertó nada).');
  }
  var origen = f.getRange(base, 1, 1, 14), combinadas = [];
  try { combinadas = origen.getMergedRanges(); } catch (e) { pend.push('FACTURA: no pude leer las celdas combinadas de la fila ' + base + '.'); }
  var textoC = f.getRange(base, 3).getValue(), textoK = f.getRange(base, 11).getValue();
  var cols = [['W', 'X', 'Y'], ['Z', 'AA', 'AB'], ['AC', 'AD', 'AE']];
  for (var i = 1; i <= HOMO.FILAS_EXTRA_FACTURA; i++) {
    var r = base + i, c = cols[i - 1], dest = f.getRange(r, 1, 1, 14);
    origen.copyTo(dest, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    dest.breakApart();
    combinadas.forEach(function (m) { f.getRange(r, m.getColumn(), 1, m.getNumColumns()).merge(); });
    f.setRowHeight(r, f.getRowHeight(base));
    f.getRange(r, 3).setValue(textoC);                // "planilla pila #."
    f.getRange(r, 11).setValue(textoK);               // ", mes cotizado."
    f.getRange(r, 2).setFormula(formulaExtraFactura_(c[0], c[2], c[1], 'valor'));
    f.getRange(r, 7).setFormula(formulaExtraFactura_(c[0], c[2], c[1], 'numero'));
    f.getRange(r, 12).setFormula(formulaExtraFactura_(c[0], c[2], c[1], 'mes'));
    f.getRange(r, 13).setValue('');
    f.showRows(r, 1);
  }
  // nota de P1/Q1: el área a exportar ya no es fija
  try {
    var q1 = String(f.getRange('Q1').getValue() || '');
    if (/A1:N\d+/.test(q1)) f.getRange('Q1').setValue(q1.replace(/\(?A1:N\d+ es el área a exportar\)?/, '(el script calcula el área a exportar: hasta la última fila del formato)'));
  } catch (e) { /* la nota es opcional */ }
  informe.push('FACTURA: filas ' + (base + 1) + ' a ' + (base + HOMO.FILAS_EXTRA_FACTURA) + ' listas (planilla 2, 3 y 4). Área a exportar: A1:N' + ultimaFilaFormato_(f) + '.');
  return pend;
}

/**
 * MIGRACIÓN A LA v3. Ejecútala UNA vez desde el editor de Apps Script (o desde el menú Cuentas HOMO).
 * Es idempotente: si se corre dos veces no duplica columnas, encabezados ni filas.
 *  - CARGA: agrega las columnas W..AI (planillas 2-4, días cobrados a mano, motivo, URLs de PDFs adicionales, URL PDF factura).
 *    Si la hoja ya tenía W..AH de la v3 original, al volver a correrla solo agrega AI.
 *  - FACTURA: inserta 3 filas después de la de "planilla pila #." para las planillas adicionales.
 * No toca los datos existentes ni PARAMETROS, CONTRATOS o PANEL.
 */
function actualizarHojaV3() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { avisar_('Actualizar hoja a v3', 'Hay otro envío en curso. Inténtalo de nuevo en un minuto.'); return; }
  var informe = [], pend = [];
  try {
    var ss = SpreadsheetApp.getActive();
    pend = pend.concat(migrarCargaV3_(ss, informe));
    pend = pend.concat(migrarFacturaV3_(ss, informe));
    SpreadsheetApp.flush();
  } catch (e) {
    console.error('Actualizar hoja a v3: ' + (e && e.stack ? e.stack : e));
    pend.push('Ocurrió un error: ' + (e && e.message ? e.message : e) + '. Puedes volver a ejecutar actualizarHojaV3: no duplica nada.');
  } finally {
    lock.releaseLock();
  }
  var texto = (pend.length ? 'PENDIENTE:\n - ' + pend.join('\n - ') + '\n\n' : 'Todo listo.\n\n') +
    'HECHO:\n - ' + (informe.length ? informe.join('\n - ') : '(nada)') +
    '\n\nSIGUIENTE: Implementar › Administrar implementaciones › Editar › Nueva versión, para publicar la pantalla nueva.';
  console.log(texto);
  avisar_('Actualizar hoja a v3', texto);
}

/** Prepara todo: carpeta en Drive, revisión de hojas y encabezados, zona horaria e instrucciones. Se ejecuta una sola vez. */
function configuracionInicial() {
  var ss = SpreadsheetApp.getActive(), ok = [], mal = [];
  [HOMO.HOJA_PANEL, HOMO.HOJA_CARGA, HOMO.HOJA_FACTURA, HOMO.HOJA_CONTRATOS, HOMO.HOJA_PARAMETROS].forEach(function (n) {
    if (ss.getSheetByName(n)) ok.push('Hoja ' + n); else mal.push('Falta la hoja ' + n);
  });
  try {
    if (ss.getSheetByName(HOMO.HOJA_CONTRATOS)) {
      var m1 = encabezadosOk_(ss.getSheetByName(HOMO.HOJA_CONTRATOS), HOMO.ENC_CONTRATOS);
      if (m1.length) mal = mal.concat(m1.map(function (x) { return 'CONTRATOS: ' + x; })); else ok.push('Encabezados de CONTRATOS');
    }
    if (ss.getSheetByName(HOMO.HOJA_CARGA)) {
      var carga = ss.getSheetByName(HOMO.HOJA_CARGA);
      // las primeras 22 columnas (A..V) valen para la hoja vieja y para la nueva
      var m2 = encabezadosOk_(carga, HOMO.ENC_CARGA.slice(0, HOMO.COLS_CARGA_V2));
      if (m2.length) mal = mal.concat(m2.map(function (x) { return 'CARGA: ' + x; })); else ok.push('Encabezados de CARGA (A..V)');
      if (esCargaV3_(carga)) {
        ok.push('CARGA con las columnas de la v3 (planillas adicionales y días a mano, W..AH)');
        if (tieneColumnaPdf_(carga)) ok.push('CARGA con la columna AI (URL PDF factura)');
        else mal.push('CARGA no tiene la columna AI «URL PDF factura»: ejecuta actualizarHojaV3 (menú Cuentas HOMO › Actualizar hoja a v3); solo agrega esa columna');
      } else mal.push('CARGA todavía es la versión anterior (22 columnas): ejecuta actualizarHojaV3 (menú Cuentas HOMO › Actualizar hoja a v3)');
    }
    if (ss.getSheetByName(HOMO.HOJA_FACTURA)) {
      var nf = filasPlanillaFactura_(ss.getSheetByName(HOMO.HOJA_FACTURA)).length;
      if (nf >= 1 + HOMO.FILAS_EXTRA_FACTURA) ok.push('FACTURA con las ' + HOMO.FILAS_EXTRA_FACTURA + ' filas de planillas adicionales');
      else if (nf >= 1) mal.push('FACTURA todavía no tiene las filas de planillas adicionales: ejecuta actualizarHojaV3 (menú Cuentas HOMO › Actualizar hoja a v3)');
      else mal.push('FACTURA: no encuentro la fila "planilla pila #." (columna C) del formato oficial');
    }
  } catch (e) { mal.push('No pude revisar los encabezados: ' + e); }
  try { leerParametros_(ss); ok.push('Hoja PARAMETROS completa'); } catch (e) { mal.push('PARAMETROS incompleta: revisa B2 a B7, la tabla ARL (A9:B13) y B18'); }
  try {
    var tzAntes = ss.getSpreadsheetTimeZone();
    if (tzAntes !== HOMO.TZ) { ss.setSpreadsheetTimeZone(HOMO.TZ); ok.push('Zona horaria de la hoja cambiada a Bogotá (antes: ' + tzAntes + ')'); }
    else ok.push('Zona horaria de la hoja: Bogotá');
  } catch (e) { mal.push('No pude poner la zona horaria de la hoja en Bogotá: cámbiala en Archivo › Configuración.'); }
  try {
    var raiz = carpetaRaiz_(ss); carpetaTemporal_(ss);
    ok.push('Carpeta de Drive lista: ' + raiz.getName() + ' (' + raiz.getUrl() + ')');
  } catch (e) { mal.push('No pude crear la carpeta en Drive: ' + e); }
  try {
    if (typeof Drive === 'undefined' || !Drive.Files) throw new Error('el servicio avanzado Drive API no está activado');
    ok.push('Servicio Drive API activado');
  } catch (e) { mal.push('Falta activar el servicio avanzado Drive API (Servicios › + › Drive API › v3 › Agregar).'); }

  var texto = (mal.length ? 'PENDIENTE:\n - ' + mal.join('\n - ') + '\n\n' : 'Todo listo.\n\n') +
    'BIEN:\n - ' + ok.join('\n - ') + '\n\n' +
    'SIGUIENTES PASOS:\n1) Implementar › Nueva implementación › Aplicación web (Ejecutar como: Yo; Quién tiene acceso: Cualquier persona).\n' +
    '2) Copia el link y pruébalo con una planilla real.\n3) Envía el link a las contratistas (el PIN son los últimos 4 números de su cédula).\n' +
    '4) Borra las filas de ejemplo de CARGA antes de empezar.';
  console.log(texto);
  avisar_('Configuración inicial', texto);
}
