/**
 * Parser.gs - Lector de planillas PILA (seguridad social, Colombia).
 *
 * Funcion publica (pura, sin APIs de Google ni de Node):
 *   parsePlanillaText(texto) -> {
 *     numero, periodo, salud, pension, arl, ccf, mora, total, ibc, dias, tarifaArl,
 *     confianza: 'alta'|'media'|'baja', notas: string[],
 *     tipo: 'planilla'|'comprobante'|'certificado'|'otro',   // extra (no rompe el contrato)
 *     planillas: [...]                                        // extra: solo si el archivo trae varias planillas
 *   }
 *
 * Formatos reconocidos (mas un lector generico de respaldo):
 *   A) Aportes en Linea ("Resumen General de Pago" / "Planilla Resumen")
 *   B) Enlace Operativo / SuAporte ("Planilla resumida" = Informacion de la Planilla Pagada,
 *      "Planilla detallada" = Autoliquidacion consolidada)
 *
 * Tolerancia: se normalizan tildes, espacios, saltos de linea, separadores de miles (. ,) y "$".
 * Se busca por palabras clave y patrones, no por posicion fija. Todos los helpers llevan
 * prefijo pp_ / PP_ para no chocar con otros archivos del proyecto Apps Script.
 * Compatible con el runtime V8 de Apps Script (ES2019, sin ?. ni ??, sin require/import).
 */

var PP_MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};
var PP_MES_RE = '(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
// tarifas ARL (%) tal como las imprimen los operadores: 0,522 1,044 2,436 4,350 6,960
var PP_TARIFAS_PCT = [0.522, 1.044, 2.436, 4.35, 6.96];

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------
function parsePlanillaText(texto) {
  var out = pp_blank();
  try {
    var clean = pp_clean(texto);
    if (pp_alnumLen(clean) < 40) {
      out.notas.push('sin texto (documento escaneado o vacio): no se pudo leer');
      out.confianza = 'baja';
      return out;
    }
    var parts = pp_splitDocs(clean);
    if (parts.length > 1) {
      var groups = pp_group(parts);
      if (groups.length > 1) return pp_multi(groups);
    }
    return pp_parseOne(clean);
  } catch (e) {
    out = pp_blank();
    out.notas.push('error interno del lector: ' + (e && e.message ? e.message : e));
    out.confianza = 'baja';
    return out;
  }
}

// ---------------------------------------------------------------------------
// Estructuras y utilidades basicas
// ---------------------------------------------------------------------------
function pp_blank() {
  return {
    numero: null, periodo: null, salud: null, pension: null, arl: null,
    ccf: null, mora: null, total: null, ibc: null, dias: null, tarifaArl: null,
    confianza: 'baja', notas: [], tipo: 'otro'
  };
}

function pp_pad2(n) { n = Number(n); return (n < 10 ? '0' : '') + n; }

function pp_alnumLen(s) { return String(s).replace(/[^A-Za-z0-9]/g, '').length; }

function pp_strip(s) {
  s = String(s === null || s === undefined ? '' : s);
  try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* sin normalize */ }
  return s;
}

// Normaliza el texto conservando saltos de linea (y \f para separar paginas)
function pp_clean(texto) {
  var s = pp_strip(texto);
  s = s.replace(/\r\n?/g, '\n')
    .replace(/[    ​‌‍﻿⁠]/g, ' ')
    .replace(/[−–—‑]/g, '-')
    .replace(/\t/g, ' ');
  s = s.replace(/ {2,}/g, ' ');
  // OCR: separador de miles con espacio ("2. 869. 600", "2 .869 .600")
  s = s.replace(/(\d[.,]) (?=\d{3}(?!\d))/g, '$1');
  s = s.replace(/(\d) ([.,])(?=\d{3}(?!\d))/g, '$1$2');
  // OCR: "$ O" -> "$0"; "$" pegado a letra S/5 no se corrige (demasiado riesgo)
  s = s.replace(/\$ ?[Oo](?![A-Za-z0-9])/g, '$0');
  s = s.replace(/ +\n/g, '\n').replace(/\n +/g, '\n');
  return s;
}

function pp_flat(clean) { return clean.replace(/\s+/g, ' ').trim(); }

// "$ 2.869.600" / "$2,869,600" / "($2,869,600)" / "$ 905.200,00" -> numero
function pp_num(tok) {
  var t = String(tok).replace(/[^\d.,]/g, '');
  if (!t) return null;
  var v;
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) v = Number(t.replace(/[.,]/g, ''));
  else if (/^\d{1,3}([.,]\d{3})*[.,]\d{1,2}$/.test(t)) {
    var d = t.match(/^(.*)[.,](\d{1,2})$/);
    v = Number(d[1].replace(/[.,]/g, '') + '.' + d[2]);
  } else if (/^\d+$/.test(t)) v = Number(t);
  else if (/^\d+[.,]\d{1,2}$/.test(t)) v = Number(t.replace(',', '.'));
  else v = Number(t.replace(/[.,]/g, ''));
  return isFinite(v) ? Math.round(v) : null;
}

// Todos los montos con "$" (incluye negativos entre parentesis o con signo -)
function pp_amounts(flat) {
  var re = /(\(|-)?\s?\$\s?(\(|-)?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\))?/g;
  var res = [], m;
  while ((m = re.exec(flat)) !== null) {
    var v = pp_num(m[3]);
    if (v === null) continue;
    var neg = !!(m[1] || m[2]);
    res.push({ v: neg ? -v : v, start: m.index + m[0].indexOf('$'), end: m.index + m[0].length });
  }
  return res;
}

// Serie contigua de montos (solo espacios entre ellos) que empieza en el monto k
function pp_runFrom(amts, k, flat) {
  var run = [], i = k;
  while (i < amts.length) {
    if (i > k) {
      var gap = flat.substring(amts[i - 1].end, amts[i].start);
      if (!/^\s*$/.test(gap) || gap.length > 3) break;
    }
    run.push(amts[i].v);
    i++;
  }
  return run;
}

// Primera serie de montos que empieza a menos de maxGap caracteres despues de pos
function pp_runNear(flat, amts, pos, maxGap) {
  for (var i = 0; i < amts.length; i++) {
    if (amts[i].start >= pos) {
      if (amts[i].start - pos <= maxGap) return pp_runFrom(amts, i, flat);
      return null;
    }
  }
  return null;
}

function pp_periodoOk(y, m) {
  y = Number(y); m = Number(m);
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12;
}

function pp_mode(arr) {
  var c = {}, best = null, bestN = 0;
  for (var i = 0; i < arr.length; i++) {
    c[arr[i]] = (c[arr[i]] || 0) + 1;
    if (c[arr[i]] > bestN) { bestN = c[arr[i]]; best = arr[i]; }
  }
  return best;
}

function pp_lines(clean) {
  return clean.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
}

// ---------------------------------------------------------------------------
// Varias planillas en un mismo archivo (correcciones, PDF concatenados)
// ---------------------------------------------------------------------------
function pp_splitDocs(clean) {
  var segs = /\f/.test(clean) ? clean.split(/\f/) : [clean];
  var out = [];
  for (var i = 0; i < segs.length; i++) {
    var parts = pp_splitByAnchor(segs[i]);
    for (var j = 0; j < parts.length; j++) if (pp_alnumLen(parts[j]) > 20) out.push(parts[j]);
  }
  return out;
}

function pp_splitByAnchor(seg) {
  var m, idx = [];
  var re = /Fecha\s+creacion\s+reporte/gi;
  while ((m = re.exec(seg)) !== null) idx.push(m.index);
  if (idx.length >= 2) {
    var parts = [];
    for (var i = 0; i < idx.length; i++) {
      var a = (i === 0) ? 0 : idx[i];
      var b = (i + 1 < idx.length) ? idx[i + 1] : seg.length;
      parts.push(seg.substring(a, b));
    }
    return parts;
  }
  var cuts = [];
  var re2 = /Total\s+a\s+Pagar\s*:?(?:\s*\$\s*[\d.,]+)?/gi;
  while ((m = re2.exec(seg)) !== null) cuts.push(m.index + m[0].length);
  if (cuts.length >= 2) {
    var res = [], prev = 0;
    for (var k = 0; k < cuts.length; k++) { res.push(seg.substring(prev, cuts[k])); prev = cuts[k]; }
    res.push(seg.substring(prev));
    return res;
  }
  return [seg];
}

function pp_group(parts) {
  var groups = [];
  for (var i = 0; i < parts.length; i++) {
    var r = pp_parseOne(parts[i]);
    var num = r.tipo === 'planilla' ? r.numero : null;
    var g = null;
    if (num) {
      for (var j = 0; j < groups.length; j++) if (groups[j].numero === num) { g = groups[j]; break; }
    } else if (groups.length) g = groups[groups.length - 1];
    if (g) g.text += '\n' + parts[i];
    else groups.push({ numero: num, text: parts[i] });
  }
  return groups;
}

function pp_multi(groups) {
  var results = groups.map(function (g) { return pp_parseOne(g.text); });
  var out = results[0];
  out.planillas = results.map(function (r) {
    return {
      numero: r.numero, periodo: r.periodo, salud: r.salud, pension: r.pension, arl: r.arl,
      ccf: r.ccf, mora: r.mora, total: r.total, ibc: r.ibc, dias: r.dias, tarifaArl: r.tarifaArl,
      confianza: r.confianza, notas: r.notas.slice()
    };
  });
  out.notas.push('el archivo contiene ' + results.length + ' planillas (' +
    results.map(function (r) { return (r.numero || '?') + (r.periodo ? ' ' + r.periodo : ''); }).join(', ') +
    '); se reporta solo la primera. Suba una planilla por archivo');
  out.confianza = 'baja';
  return out;
}

// ---------------------------------------------------------------------------
// Lectura de una planilla
// ---------------------------------------------------------------------------
function pp_parseOne(clean) {
  var out = pp_blank();
  var flat = pp_flat(clean);
  var low = flat.toLowerCase();

  // --- clasificacion del documento ---
  var cls = pp_classify(low);
  out.tipo = cls.tipo;
  if (cls.tipo === 'comprobante' || cls.tipo === 'certificado') return pp_nonPlanilla(out, flat, low, cls);
  if (cls.tipo === 'otro') {
    out.notas.push('no parece una planilla PILA');
    out.notas.push('no se reconocen encabezados de planilla (liquidacion de aportes, resumen de pago, administradoras)');
    out.confianza = 'baja';
    // aun asi intentamos una lectura generica por si es un formato desconocido
    var probe = pp_blank();
    pp_fmtG(clean, flat, low, probe);
    if (probe.salud !== null && probe.pension !== null) {
      out.tipo = 'planilla';
      pp_copy(probe, out);
      out.notas = ['formato de planilla no reconocido: lectura generica por palabras clave, verifique los valores'];
      return pp_finish(out, { generic: true });
    }
    return out;
  }

  var amts = pp_amounts(flat);
  var ctx = { clean: clean, flat: flat, low: low, amts: amts, generic: false, checks: [], ambiguousNumero: false };

  var isA = /liquidacion detallada de aportes|resumen general de pago|planilla resumen/.test(low) &&
    /datos generales de la liquidacion|resumen de pago/.test(low);
  var isB = /informacion de la planilla pagada|autoliquidacion consolidada|valor sin mora|detalle del aportante/.test(low);

  if (isA) { out.notas.push('formato: Aportes en Linea (resumen general de pago)'); pp_fmtA(ctx, out); }
  else if (isB) { pp_fmtB(ctx, out); }
  else { ctx.generic = true; pp_fmtG(clean, flat, low, out); out.notas.push('formato de planilla no reconocido: lectura generica por palabras clave, verifique los valores'); }

  // Si el lector del formato no consiguio lo esencial, respaldo generico
  if (!ctx.generic && (out.salud === null || out.pension === null || out.arl === null || !out.numero || !out.periodo)) {
    var g = pp_blank();
    pp_fmtG(clean, flat, low, g);
    var used = [];
    ['numero', 'periodo'].forEach(function (k) {
      if (out[k] === null && g[k] !== null) { out[k] = g[k]; used.push(k); }
    });
    if (used.length) { ctx.generic = true; out.notas.push('campos completados con lectura generica: ' + used.join(', ')); }
  }
  return pp_finish(out, ctx);
}

function pp_copy(src, dst) {
  ['numero', 'periodo', 'salud', 'pension', 'arl', 'ccf', 'mora', 'total', 'ibc', 'dias', 'tarifaArl'].forEach(function (k) { dst[k] = src[k]; });
}

// ---------------------------------------------------------------------------
// Clasificacion: planilla / comprobante / certificado / otro
// ---------------------------------------------------------------------------
function pp_classify(low) {
  function has(re) { return re.test(low) ? 1 : 0; }
  var p = 0;
  p += 3 * has(/liquidacion detallada de aportes/);
  p += 3 * has(/resumen de pago[\s\S]{0,300}valor liquidado|valor liquidado[\s\S]{0,300}intereses mora/);
  p += 2 * has(/resumen general de pago|planilla resumen/);
  p += 3 * has(/autoliquidacion consolidada/);
  p += 3 * has(/informacion de la planilla pagada/);
  p += 2 * has(/valor sin mora/);
  p += 2 * has(/datos generales del aportante/);
  p += 2 * has(/detalle del aportante/);
  p += 1 * has(/\bibc\b/);
  p += 1 * has(/administradoras?\b/);
  p += 1 * has(/afiliados/);

  var c = 0;
  c += 3 * has(/pago exitoso|pago electronico/);
  c += 3 * has(/resumen del pago electronico/);
  c += 2 * has(/comprobante (?:no|en linea|de pago|de transaccion)|numero de comprobante/);
  c += 2 * has(/transaccion aprobada|estado de la transaccion:? *(?:aprobada|exitosa)/);
  c += 2 * has(/valor pagado|costo de la transaccion|facturas pagadas|producto origen/);
  c += 1 * has(/\bpse\b|achcolombia/);

  var cert = has(/certificado de aportes|se certifica que/);

  if (cert && p < 6) return { tipo: 'certificado', p: p, c: c };
  if (p >= 5 && p > c) return { tipo: 'planilla', p: p, c: c };
  if (c >= 3 && c >= p) return { tipo: 'comprobante', p: p, c: c };
  if (p >= 3) return { tipo: 'planilla', p: p, c: c };
  if (/planilla/.test(low) && /pension/.test(low) && /salud/.test(low) && /riesgos?|arl/.test(low)) return { tipo: 'planilla', p: p, c: c };
  return { tipo: c > 0 ? 'comprobante' : 'otro', p: p, c: c };
}

// Comprobantes de pago / certificados: no traen el desglose. Se extrae lo poco que hay.
function pp_nonPlanilla(out, flat, low, cls) {
  out.notas.push('no parece una planilla PILA');
  if (cls.tipo === 'certificado') {
    out.notas.push('certificado de aportes: lista pagos pero no trae los valores liquidados por subsistema. Suba la planilla (resumen general de pago)');
  } else {
    out.notas.push('comprobante de pago (banco / PSE / operador): no trae el desglose de salud, pension y ARL. Suba la planilla, no el comprobante');
  }
  var m = flat.match(/clave(?: de la)?(?: planilla)?\s*:?\s*(\d{8,12})/i) ||
    flat.match(/numero de factura(?: referencia \d)?\s*(\d{7,10})\b/i) ||
    flat.match(/planilla de aportes con clave:?\s*(\d{8,12})/i);
  if (m) out.numero = m[1];
  var p = flat.match(/periodo de pago\s*:?\s*(20\d\d)\s*-\s*(\d{1,2})/i);
  if (p && pp_periodoOk(p[1], p[2])) out.periodo = p[1] + '-' + pp_pad2(p[2]);
  var v = flat.match(/valor(?: pagado| del pago)?\s*:?\s*\$?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,})/i) ||
    flat.match(/valor(?: pagado| del pago)[^$]{0,120}\$\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+)/i);
  if (v) out.total = pp_num(v[1]);
  out.confianza = 'baja';
  return out;
}

// ---------------------------------------------------------------------------
// Formato A: Aportes en Linea ("Resumen General de Pago")
// ---------------------------------------------------------------------------
function pp_fmtA(ctx, out) {
  var flat = ctx.flat, amts = ctx.amts;

  // Fila de liquidacion: Periodo pension, periodo salud, [clave pago/CUS], clave planilla, tipo
  var reRow = /(20\d\d) ?- ?(\d{1,2}) +(20\d\d) ?- ?(\d{1,2}) +(?:(\d{5,12}) +)?(\d{8,12}) +([A-Z])\b/;
  var m = flat.match(reRow);
  if (!m) {
    // OCR: la letra del tipo de planilla puede salir como un simbolo (' | !); se ancla con la fecha limite
    var reRow2 = /(20\d\d) ?- ?(\d{1,2}) +(20\d\d) ?- ?(\d{1,2}) +(?:(\d{5,12}) +)?(\d{8,12}) +()[^\s\d]{1,2} +(?=20\d\d ?\/ ?\d{1,2} ?\/)/;
    m = flat.match(reRow2);
    if (m) { m[7] = null; out.notas.push('el tipo de planilla no se leyo bien del texto (OCR)'); }
  }
  var rowEnd = -1;
  if (m && pp_periodoOk(m[1], m[2])) {
    out.numero = m[6];
    out.periodo = m[1] + '-' + pp_pad2(m[2]);
    ctx.tipoPlanilla = m[7];
    if (pp_periodoOk(m[3], m[4]) && (m[1] !== m[3] || Number(m[2]) !== Number(m[4]))) {
      out.notas.push('periodo salud (' + m[3] + '-' + pp_pad2(m[4]) + ') distinto del de pension; se usa el de pension');
    }
    rowEnd = m.index + m[0].length;
    var tail = flat.substring(rowEnd, rowEnd + 110).split(/P[a]gina|Resumen General/)[0];
    var tm = pp_amounts(tail);
    if (tm.length) out.total = tm[0].v;
  } else {
    var cm = flat.match(/clave planilla\s*:?\s*(\d{8,12})/i);
    if (cm) out.numero = cm[1];
    var pm = flat.match(/(20\d\d) ?- ?(\d{2})/);
    if (pm && pp_periodoOk(pm[1], pm[2])) out.periodo = pm[1] + '-' + pm[2];
  }

  // Resumen de pago por administradora (AFP / EPS / ARL / CCF)
  var sec = {}, secMora = 0, secFound = false;
  var reSec = /\b(AFP|EPS|ARL|CCF)\s*\(\s*ADMINISTRADORAS?\s*:?\s*\d+\s*\)\s*(?:\d+\s*)?/g, s;
  while ((s = reSec.exec(flat)) !== null) {
    var run = pp_runNear(flat, amts, s.index + s[0].length, 8);
    if (run && run.length) {
      secFound = true;
      sec[s[1]] = (sec[s[1]] || 0) + run[0];
      if (run.length > 1) secMora += run[1];
    }
  }
  // Linea TOTAL del resumen
  var tot = null, reTot = /\bTOTAL\s+\d+\s+/g, t;
  while ((t = reTot.exec(flat)) !== null) {
    var r2 = pp_runNear(flat, amts, t.index + t[0].length, 4);
    if (r2 && r2.length >= 2) tot = r2;
  }
  // Fila "Total Afiliados": IBC/aporte de pension, salud, ccf, riesgos, parafiscales
  var det = null, dm = /Total Afiliados\s*\(\s*\d+\s*\)/i.exec(flat);
  if (dm) {
    var r3 = pp_runNear(flat, amts, dm.index + dm[0].length, 8);
    if (r3 && r3.length >= 8) det = r3;
  }
  if (!det) {
    var sm = /Sucursal\s*:[^$]{0,60}\(\s*\d+\s*Afiliados?\s*\)/i.exec(flat);
    if (sm) { var r4 = pp_runNear(flat, amts, sm.index + sm[0].length, 8); if (r4 && r4.length >= 8) det = r4; }
  }

  function pick(key, di) {
    var a = (key in sec) ? sec[key] : null;
    var b = det ? det[di] : null;
    if (a !== null && b !== null && Math.abs(a - b) > 1) {
      ctx.checks.push('el resumen de pago (' + key + ' ' + a + ') no coincide con el detalle (' + b + ')');
      return a;
    }
    return a !== null ? a : b;
  }
  out.pension = pick('AFP', 1);
  out.salud = pick('EPS', 3);
  out.arl = pick('ARL', 7);
  out.ccf = pick('CCF', 5);
  if (out.ccf === null && (secFound || det)) out.ccf = 0;
  ctx.otros = det ? (det[9] || 0) : 0;   // aportes parafiscales (SENA/ICBF)

  if (det) {
    out.ibc = det[2] || det[0] || null;
    if (!out.ibc) {
      // planilla de correccion: IBC neto 0; se intenta con la fila positiva del detalle
      var rows = flat.match(/(?:^|\s)\d{5,6}\s+\d{1,2}\s+\$\s?(\d{1,3}(?:[.,]\d{3})+)/);
      if (rows) out.ibc = pp_num(rows[1]);
    }
  }
  // mora
  if (tot) out.mora = tot[1];
  else if (secFound) out.mora = secMora;
  if (out.total === null && tot) out.total = tot[0] + (tot[1] || 0);
  // coherencia con la linea TOTAL
  if (tot && secFound) {
    var liq = (sec.AFP || 0) + (sec.EPS || 0) + (sec.ARL || 0) + (sec.CCF || 0);
    if (Math.abs(liq - tot[0]) > 1) ctx.checks.push('la suma por administradora (' + liq + ') no coincide con el total liquidado (' + tot[0] + ')');
  }

  // dias: dias (1-31) inmediatamente antes de "$ IBC $ aporte"
  var dmm = flat.match(/(?:^|\s)(\d{1,2}) \(?-?\$ ?\d{1,3}(?:[.,]\d{3})+\)? \(?-?\$ ?\d{1,3}(?:[.,]\d{3})+\)?/);
  if (dmm && Number(dmm[1]) >= 1 && Number(dmm[1]) <= 31) out.dias = Number(dmm[1]);

  out.tarifaArl = pp_tarifa(flat);
  if (ctx.tipoPlanilla === 'N') pp_notaCorreccion(out);
}

// ---------------------------------------------------------------------------
// Formato B: Enlace Operativo (SuAporte): planilla resumida y detallada
// ---------------------------------------------------------------------------
function pp_fmtB(ctx, out) {
  var flat = ctx.flat, low = ctx.low, amts = ctx.amts;
  var isRes = /informacion de la planilla pagada|valor sin mora/.test(low) && !/detalle del aportante|autoliquidacion consolidada/.test(low);
  out.notas.push('formato: Enlace Operativo (' + (isRes ? 'planilla resumida' : 'planilla detallada') + ')');

  // --- periodo de cotizacion: se usa "otros riesgos" (= pension); en detallada, "Periodo Cotizacion" ---
  var reMY = new RegExp('\\b' + PP_MES_RE + ' de (20\\d\\d)\\b', 'ig');
  var toks = [], mm;
  while ((mm = reMY.exec(flat)) !== null) toks.push({ y: mm[2], m: PP_MESES[mm[1].toLowerCase()], idx: mm.index });
  function labeled(labelRe) {
    var lm = labelRe.exec(flat);
    if (!lm) return null;
    var after = flat.substring(lm.index + lm[0].length, lm.index + lm[0].length + 40);
    var x = new RegExp('^\\s*:?\\s*' + PP_MES_RE + ' de (20\\d\\d)', 'i').exec(after);
    return x ? { y: x[2], m: PP_MESES[x[1].toLowerCase()] } : null;
  }
  var per = labeled(/Periodo de Cotizacion Otros Riesgos/i) || labeled(/Periodo Cotizacion/i);
  var perSalud = labeled(/Periodo de Cotizacion Para Salud/i);
  if (per) {
    out.periodo = per.y + '-' + pp_pad2(per.m);
    if (perSalud && (perSalud.y !== per.y || perSalud.m !== per.m)) out.notas.push('periodo salud (' + perSalud.y + '-' + pp_pad2(perSalud.m) + ') distinto del de pension; se usa el de pension');
  } else if (toks.length) {
    var keys = {}, distinct = [];
    toks.forEach(function (x) { var k = x.y + '-' + pp_pad2(x.m); if (!keys[k]) { keys[k] = 1; distinct.push(k); } });
    out.periodo = distinct[0];
    if (distinct.length > 1) {
      out.notas.push('el documento menciona varios periodos (' + distinct.join(', ') + '); no se pudo saber cual es el de pension, se usa ' + distinct[0]);
      ctx.checks.push('periodo ambiguo');
    }
  }

  // --- numero de planilla ---
  var nr = pp_enlaceNumero(ctx.clean, flat);
  out.numero = nr.numero;
  if (nr.ambiguous) ctx.ambiguousNumero = true;

  // --- tipo de planilla (I independientes, N correccion...) ---
  var tp = flat.match(/Tipo Planilla\s*:?\s*([A-Z])\s*:/) || flat.match(/Tipo de Planilla\s*:?\s*([A-Z])\b(?![a-z])/);
  if (tp) ctx.tipoPlanilla = tp[1];
  else if (/planilla correcciones|nro planilla corregida/i.test(flat)) ctx.tipoPlanilla = 'N';
  else {
    var lines = pp_lines(ctx.clean);
    for (var i = 1; i < lines.length - 1; i++) {
      if (/^[A-Z]$/.test(lines[i]) && /^\d{7,10}$/.test(lines[i + 1]) && !/^[A-Z]$/.test(lines[i - 1] || 'x')) { ctx.tipoPlanilla = lines[i]; break; }
    }
  }

  if (isRes) pp_enlaceResumida(ctx, out);
  else pp_enlaceDetallada(ctx, out);

  out.tarifaArl = out.tarifaArl !== null ? out.tarifaArl : pp_tarifa(flat);
  if (ctx.tipoPlanilla === 'N') pp_notaCorreccion(out);
}

// Planilla resumida: filas por administradora (codigo, nombre, afiliados, valor sin mora, mora)
function pp_enlaceResumida(ctx, out) {
  var flat = ctx.flat, amts = ctx.amts;
  var re = /\b(25-\d{2}|23\d{4}|EPS[A-Z]?\d{2,3}|EAS\d{2,3}|ESS\d{2,3}|CCF\d{2,3}|14-\d{2})\b/g, m;
  var sums = { pension: null, salud: null, arl: null, ccf: null };
  while ((m = re.exec(flat)) !== null) {
    var code = m[1], key = null;
    if (/^(25-|23\d{4})/.test(code)) key = 'pension';
    else if (/^(EPS|EAS|ESS)/.test(code)) key = 'salud';
    else if (/^CCF/.test(code)) key = 'ccf';
    else if (/^14-/.test(code)) key = 'arl';
    if (!key) continue;
    var run = pp_runNear(flat, amts, m.index + m[0].length, 110);
    if (!run || !run.length) continue;
    sums[key] = (sums[key] || 0) + run[0];
  }
  out.pension = sums.pension; out.salud = sums.salud; out.arl = sums.arl;
  out.ccf = sums.ccf !== null ? sums.ccf : ((sums.pension !== null || sums.salud !== null || sums.arl !== null) ? 0 : null);

  // total a pagar = mayor monto del documento (la resumida no trae IBC); mora = total - liquidado
  var liq = (out.pension || 0) + (out.salud || 0) + (out.arl || 0) + (out.ccf || 0);
  var max = 0, present = {};
  amts.forEach(function (a) { if (a.v > max) max = a.v; present[a.v] = true; });
  if (max > 0) {
    out.total = max;
    var mora = max - liq;
    if (mora >= 0 && (mora === 0 || present[mora] || mora < liq)) out.mora = mora;
    else ctx.checks.push('el total a pagar (' + max + ') es menor que la suma por administradora (' + liq + ')');
    if (mora > 0 && !present[mora]) ctx.checks.push('la mora deducida (' + mora + ') no aparece como monto en el documento');
  }
  out.notas.push('la planilla resumida no trae IBC, dias ni tarifa ARL (use la detallada si los necesita)');
}

// Planilla detallada (Autoliquidacion consolidada): fila III.TOTALES con 12+ montos
function pp_enlaceDetallada(ctx, out) {
  var flat = ctx.flat, amts = ctx.amts, i, run = null, runK = -1;
  for (i = 0; i < amts.length; i++) {
    var r = pp_runFrom(amts, i, flat);
    if (r.length >= 12) { run = r; runK = i; break; }
    i += Math.max(0, r.length - 1);
  }
  if (!run) { out.notas.push('no se encontro la fila de totales (III.TOTALES)'); return; }
  // Alineacion de la fila: en "layout" sobran montos al final (incapacidades, subtotal, mora, total);
  // en "raw" puede sobrar un "$ 0" al inicio (celda de la linea anterior).
  var s0 = 0;
  if (run.length > 12) {
    var cand = [];
    for (var sc = 0; sc + 12 <= run.length; sc++) {
      var ib = run[sc];
      var okIbc = (run[sc + 1] === ib || ib === 0) && (run[sc + 2] === run[sc + 1] || run[sc + 1] === 0 || ib === 0);
      var okPen = ib > 0 ? Math.abs(run[sc + 4] - 0.16 * ib) <= 150 : true;
      var okSal = run[sc + 1] > 0 ? Math.abs(run[sc + 5] - 0.125 * run[sc + 1]) <= 150 : true;
      if (okIbc && okPen && okSal) cand.push(sc);
    }
    if (cand.length === 1) s0 = cand[0];
    else s0 = run.length >= 15 ? 0 : run.length - 12;
  }
  run = run.slice(s0);
  // IBC pension, IBC salud, IBC riesgos, IBC cajas, ap. pension, ap. salud, ap. riesgos, ap. cajas, sena, icbf, esap, min educacion
  out.pension = run[4]; out.salud = run[5]; out.arl = run[6]; out.ccf = run[7];
  out.ibc = run[1] || run[0] || run[2] || null;
  ctx.otros = (run[8] || 0) + (run[9] || 0) + (run[10] || 0) + (run[11] || 0);
  var sum8 = out.pension + out.salud + out.arl + out.ccf + ctx.otros;
  // subtotal, mora, total final (tras incapacidades EPS/ARP)
  if (run.length >= 17 && run[16] - run[15] === run[14]) {
    out.mora = run[15]; out.total = run[16];
  } else {
    // buscar un par (mora, total) donde total - mora == suma de aportes
    var found = false;
    for (var k = 0; k + 1 < amts.length && !found; k++) {
      var x = amts[k].v, y = amts[k + 1].v;
      if (y > 0 && y - x === sum8 && x >= 0 && (k < runK || k >= runK + run.length)) { out.mora = x; out.total = y; found = true; }
    }
    if (!found) {
      for (var q = 0; q < amts.length; q++) {
        if (amts[q].v === sum8 && sum8 > 0) { out.total = sum8; out.mora = 0; found = true; break; }
      }
    }
    if (!found) ctx.checks.push('no se pudo confirmar mora ni total final');
  }
  // dias: moda de enteros 1..30 cerca de la fila del afiliado
  var win = null, reCC = /\bCC\s\d{6,11}\b/g, cm;
  while ((cm = reCC.exec(flat)) !== null) {
    var seg = flat.substring(cm.index, cm.index + 320);
    if (/\((?:25-\d{2}|23\d{4})\)|\(EPS/.test(seg)) { win = seg; break; }
  }
  if (win) {
    var nums = [], reN = /(?<![\d\-\/:.,$#])\b(\d{1,2})\b(?![\d\-\/:.,%])/g, nm;
    while ((nm = reN.exec(win)) !== null) { var n = Number(nm[1]); if (n >= 1 && n <= 30) nums.push(n); }
    var md = pp_mode(nums);
    if (md !== null) out.dias = md;
  }
}

// Numero de planilla de Enlace Operativo: por etiqueta (layout) o por posicion (raw / una sola linea)
function pp_enlaceNumero(clean, flat) {
  var m = flat.match(/Numero Planilla\s*:?\s*(\d{7,10})\b/i);
  if (m) return { numero: m[1], ambiguous: false };
  var cands = [], re = /\b\d{8,10}\b(?!-)/g, x;
  while ((x = re.exec(flat)) !== null) {
    var before = flat.substring(Math.max(0, x.index - 60), x.index);
    var words = before.trim().split(' ');
    var w1 = (words[words.length - 1] || '').replace(/[:.]+$/, '');
    if (/^(CC|CEDULA|NIT|N|WhatsApp|IP|Tel|Telefono|Corregida|Documento|Identificacion)$/i.test(w1)) continue;
    if (/Corregida:?$/i.test(before.trim())) continue;
    if (pp_esTelefono(x[0], before)) continue;
    var role = 'plan';
    if (/^[A-Z]$/.test(w1) || /CUS:?$/i.test(before.trim()) || /Bancaria\/? ?CUS/i.test(before.slice(-40))) role = 'cus';
    cands.push({ v: x[0], role: role, afterPeriod: /\bde 20\d\d$/i.test(before.trim()) });
  }
  var plan = cands.filter(function (c) { return c.role === 'plan'; });
  if (plan.length === 1) return { numero: plan[0].v, ambiguous: false };
  if (plan.length > 1) {
    var ap = plan.filter(function (c) { return c.afterPeriod; });
    if (ap.length >= 1) return { numero: ap[0].v, ambiguous: ap.length > 1 };
    return { numero: plan[0].v, ambiguous: true };
  }
  return { numero: null, ambiguous: false };
}

// Un numero de 10 digitos que empieza por 3 (celular colombiano 300-359) o que viene justo despues de
// "Telefono / Celular / WhatsApp / Fax" es un telefono, nunca un numero de planilla.
function pp_esTelefono(digits, before) {
  if (/^3[0-5]\d{8}$/.test(digits)) return true;
  return /(?:\btel|\btelefono|\bcelular|\bcel|\bmovil|\bwhatsapp|\bfax)\.?[:\s#-]*$/i.test(String(before || '').trim());
}

function pp_tarifa(flat) {
  var m = /(\d{1,2}[.,]\d{1,3}) ?%/.exec(flat);
  if (m) {
    var p = Number(m[1].replace(',', '.'));
    for (var i = 0; i < PP_TARIFAS_PCT.length; i++) if (Math.abs(p - PP_TARIFAS_PCT[i]) < 0.0006) return Math.round(PP_TARIFAS_PCT[i] * 1000) / 100000;
  }
  var re = /(?<![\d.,])(0[.,]522|1[.,]044|2[.,]436|4[.,]350?|6[.,]960?)(?![\d]|[.,]\d)/g, x;
  while ((x = re.exec(flat)) !== null) {
    var b = flat.charAt(x.index - 1), b2 = flat.charAt(x.index - 2);
    if (b === '$' || (b === ' ' && b2 === '$')) continue;
    var pct = Number(x[1].replace(',', '.'));
    return Math.round(pct * 1000) / 100000;
  }
  return null;
}

function pp_notaCorreccion(out) {
  out.notas.push('planilla de correccion (tipo N): los valores son ajustes/diferencias, no el total del periodo; revise a mano');
}

// ---------------------------------------------------------------------------
// Lector generico (formatos desconocidos): busca por palabras clave
// ---------------------------------------------------------------------------
function pp_fmtG(clean, flat, low, out) {
  var m = flat.match(/(?:numero de planilla|n[uo]m(?:ero)?\.? ?(?:de )?planilla|planilla (?:n[o0]\.?|#|numero)|nro\.? ?planilla|clave (?:de )?planilla|id planilla|planilla)\s*[:#.]?\s*(\d{6,12})\b/i);
  if (m && !pp_esTelefono(m[1], '')) out.numero = m[1];
  var p = flat.match(/periodo[^0-9]{0,40}(20\d\d) ?[-\/.] ?(0?[1-9]|1[0-2])\b(?! ?[-\/.] ?\d)/i) ||
    flat.match(/\b(20\d\d) ?[-\/] ?(0[1-9]|1[0-2])\b(?! ?[-\/] ?\d)/);
  if (p) out.periodo = p[1] + '-' + pp_pad2(p[2]);
  else {
    var my = new RegExp(PP_MES_RE + ' (?:de|del) (20\\d\\d)', 'i').exec(flat);
    if (my) out.periodo = my[2] + '-' + pp_pad2(PP_MESES[my[1].toLowerCase()]);
    else {
      var ym = flat.match(/periodo[^0-9]{0,20}(20\d\d)(0[1-9]|1[0-2])\b/i);
      if (ym) out.periodo = ym[1] + '-' + ym[2];
    }
  }
  var AMT = '(\\$\\s?\\d[\\d.,]*|\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?)';
  function find(keys) {
    var re = new RegExp('(?:' + keys + ')[^0-9$]{0,40}' + AMT, 'ig'), x, best = null;
    while ((x = re.exec(flat)) !== null) {
      var v = pp_num(x[1]);
      if (v !== null && v > 0) { best = v; break; }
    }
    return best;
  }
  out.pension = find('aportes? (?:a )?pensi[o]n(?: obligatoria)?|pension obligatoria|total pension|\\bAFP\\b|pension');
  out.salud = find('aportes? (?:a )?salud|salud obligatoria|total salud|\\bEPS\\b|salud');
  out.arl = find('riesgos laborales|riesgos profesionales|aportes? (?:a )?riesgos|\\bARL\\b|\\bARP\\b|riesgos');
  out.ccf = find('caja de compensacion|\\bCCF\\b|aportes? (?:a )?caja');
  var t = find('total a pagar|valor a pagar|total aportes|total planilla');
  if (t !== null) out.total = t;
  var ib = find('\\bIBC\\b|ingreso base de cotizacion');
  if (ib !== null) out.ibc = ib;
  out.tarifaArl = pp_tarifa(flat);
}

// ---------------------------------------------------------------------------
// Cierre: coherencia y nivel de confianza
// ---------------------------------------------------------------------------
function pp_finish(out, ctx) {
  var level = 2; // 2 alta, 1 media, 0 baja
  function cap(n, note) { if (n < level) level = n; if (note) out.notas.push(note); }

  // coherencia: liquidado + otros + mora = total
  if (out.total !== null && out.salud !== null && out.pension !== null && out.arl !== null && out.mora !== null && !ctx.generic) {
    var comp = out.salud + out.pension + out.arl + (out.ccf || 0) + (ctx.otros || 0);
    if (Math.abs(comp + out.mora - out.total) > 1) {
      cap(1, 'la suma de salud+pension+ARL+CCF+mora (' + (comp + out.mora) + ') no coincide con el total (' + out.total + ')');
    }
  }
  (ctx.checks || []).forEach(function (c) { cap(1, 'revisar: ' + c); });

  var missing = ['numero', 'periodo', 'salud', 'pension', 'arl'].filter(function (k) { return out[k] === null; });
  if (missing.length === 1) cap(1, 'no se encontro: ' + missing[0]);
  else if (missing.length >= 2) cap(0, 'no se encontraron: ' + missing.join(', '));

  if (ctx.ambiguousNumero) cap(1, 'el numero de planilla se dedujo por posicion (hay varios numeros candidatos); verifiquelo');
  if (ctx.tipoPlanilla === 'N') level = 0;
  else if (ctx.tipoPlanilla && ctx.tipoPlanilla !== 'I' && ctx.tipoPlanilla !== 'E') cap(1, 'tipo de planilla ' + ctx.tipoPlanilla + ' (se esperaba I: independientes)');
  if (ctx.generic) cap(missing.length ? 0 : 1);
  if (out.mora !== null && out.mora > 0) out.notas.push('la planilla incluye intereses de mora (' + out.mora + '); no se suman a salud/pension/ARL');

  out.confianza = level === 2 ? 'alta' : (level === 1 ? 'media' : 'baja');
  return out;
}
