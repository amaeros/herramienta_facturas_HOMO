/**
 * mocks_gas.js - Simulación MÍNIMA de los servicios de Google Apps Script para probar Code.gs en node.
 * Se ejecuta DENTRO del contexto vm (mismo "realm" que Code.gs, así Date/Array coinciden).
 * Variables que inyecta test_server.js en el contexto: __fixture (texto JSON), __hostOcr(bytes) -> texto, __Buffer.
 * Limitaciones: no valida permisos, cuotas, tiempos ni el comportamiento real del OCR/exportación de Google.
 */
var __log = { alerts: [], mails: [], fetches: [], ocrCalls: [], sleeps: 0, driveCreates: [], removed: [] };
var __lockBusy = false;
var __exportStatus = [];          // cola de códigos HTTP a devolver en las exportaciones a PDF (p. ej. [429]); vacía = 200
var __xlsxStatus = [];            // lo mismo para las exportaciones a XLSX (cola aparte: __log.fetches solo cuenta las de PDF)
var __ocrFail = false;            // si es true, Drive.Files.create lanza error (para probar la lectura manual)
var __ocrOverride = null;         // texto fijo a devolver por el OCR (si no, se usa __hostOcr con los bytes)
var __now = null;                 // fecha "actual" fija (opcional)
var __copyLosesImages = false;    // si es true, Sheet.copyTo entre hojas de cálculo NO conserva las imágenes (logos)
var __xlsxMime = null;            // si no es null, el export xlsx devuelve ese content-type (para probar la validación)
var __xlsxBytes = null;           // si no es null, el export xlsx devuelve estos bytes (p. ej. un HTML de error)
var __tempSpreadsheets = {};      // hojas de cálculo creadas con SpreadsheetApp.create (id -> FakeSpreadsheet)

// ---------------------------------------------------------------- hojas
// Hoja simulada con lo necesario para probar la migración v3 y la exportación de la factura:
// valores, fórmulas, formatos (firma de texto por celda), celdas combinadas, alturas, filas ocultas y columnas.
// Al insertar filas, las filas NUEVAS quedan en blanco y sin formato (el peor caso): la migración debe copiar todo explícitamente.
function FakeSheet(name, rows, maxRows, maxCols) {
  this.name = name; this.data = rows || []; this.maxRows = maxRows || 1000; this.maxCols = maxCols || 26;
  this.formats = {}; this.formulas = {}; this.styles = {}; this.merges = []; this.rowHeights = {}; this.hidden = {}; this.colWidths = {};
  this.sheetId = Math.floor(Math.random() * 1e6);
  this.opLog = [];
}
FakeSheet.prototype.getName = function () { return this.name; };
FakeSheet.prototype.getSheetId = function () { return this.sheetId; };
FakeSheet.prototype.getMaxRows = function () { return this.maxRows; };
FakeSheet.prototype.getMaxColumns = function () { return this.maxCols; };
FakeSheet.prototype.insertColumnsAfter = function (pos, n) { this.maxCols += n; this.opLog.push('insertColumnsAfter ' + pos + ' ' + n); };
function __shiftKeys(map, pos, n) {            // desplaza las claves "fila,col" con fila > pos
  var out = {};
  Object.keys(map).forEach(function (k) {
    var p = k.split(','), r = Number(p[0]);
    out[(r > pos ? r + n : r) + ',' + p[1]] = map[k];
  });
  return out;
}
FakeSheet.prototype.insertRowsAfter = function (pos, n) {
  this.opLog.push('insertRowsAfter ' + pos + ' ' + n);
  var blank = [];
  for (var i = 0; i < n; i++) blank.push([]);
  while (this.data.length < pos) this.data.push([]);
  Array.prototype.splice.apply(this.data, [pos, 0].concat(blank));
  this.formulas = __shiftKeys(this.formulas, pos, n);
  this.styles = __shiftKeys(this.styles, pos, n);
  this.formats = __shiftKeys(this.formats, pos, n);
  this.merges = this.merges.map(function (m) {
    if (m[0] > pos) return [m[0] + n, m[1], m[2] + n, m[3]];
    if (m[2] > pos) return [m[0], m[1], m[2] + n, m[3]];       // una combinada que cruza la inserción se estira
    return m;
  });
  var rh = {}, hid = {};
  Object.keys(this.rowHeights).forEach(function (k) { var r = Number(k); rh[r > pos ? r + n : r] = this.rowHeights[k]; }, this);
  Object.keys(this.hidden).forEach(function (k) { var r = Number(k); hid[r > pos ? r + n : r] = true; }, this);
  this.rowHeights = rh; this.hidden = hid;
  this.maxRows += n;
};
FakeSheet.prototype.getImages = function () { return this.images || []; };
FakeSheet.prototype.setName = function (n) { this.name = n; return this; };
FakeSheet.prototype.deleteRows = function (pos, n) {
  n = n || 1;
  this.opLog.push('deleteRows ' + pos + ' ' + n);
  if (pos < 1 || pos + n - 1 > this.maxRows) throw new Error('deleteRows fuera de rango: ' + pos + ' x' + n + ' (filas: ' + this.maxRows + ')');
  if (this.maxRows - n < 1) throw new Error('No se pueden borrar todas las filas de la hoja');
  var self = this, fin = pos + n - 1;
  this.data.splice(pos - 1, n);
  function mover(map) {
    var out = {};
    Object.keys(map).forEach(function (k) {
      var q = k.split(','), r = Number(q[0]);
      if (r >= pos && r <= fin) return;
      out[(r > fin ? r - n : r) + ',' + q[1]] = map[k];
    });
    return out;
  }
  this.formulas = mover(this.formulas); this.styles = mover(this.styles); this.formats = mover(this.formats);
  this.merges = this.merges.map(function (m) {
    if (m[0] >= pos && m[2] <= fin) return null;                           // la combinada estaba entera en las filas borradas
    var a = m[0], b = m[2];
    a = a > fin ? a - n : (a >= pos ? pos : a);
    b = b > fin ? b - n : (b >= pos ? pos - 1 : b);
    return [a, m[1], b, m[3]];
  }).filter(function (m) { return m && m[2] >= m[0]; });
  var rh = {}, hid = {};
  Object.keys(this.rowHeights).forEach(function (k) { var r = Number(k); if (r >= pos && r <= fin) return; rh[r > fin ? r - n : r] = self.rowHeights[k]; });
  Object.keys(this.hidden).forEach(function (k) { var r = Number(k); if (r >= pos && r <= fin) return; hid[r > fin ? r - n : r] = true; });
  this.rowHeights = rh; this.hidden = hid;
  this.maxRows -= n;
};
FakeSheet.prototype.deleteColumns = function (pos, n) {
  n = n || 1;
  this.opLog.push('deleteColumns ' + pos + ' ' + n);
  if (pos < 1 || pos + n - 1 > this.maxCols) throw new Error('deleteColumns fuera de rango: ' + pos + ' x' + n + ' (columnas: ' + this.maxCols + ')');
  if (this.maxCols - n < 1) throw new Error('No se pueden borrar todas las columnas de la hoja');
  var fin = pos + n - 1;
  this.data.forEach(function (row) { if (row.length >= pos) row.splice(pos - 1, n); });
  function mover(map) {
    var out = {};
    Object.keys(map).forEach(function (k) {
      var q = k.split(','), c = Number(q[1]);
      if (c >= pos && c <= fin) return;
      out[q[0] + ',' + (c > fin ? c - n : c)] = map[k];
    });
    return out;
  }
  this.formulas = mover(this.formulas); this.styles = mover(this.styles); this.formats = mover(this.formats);
  this.merges = this.merges.map(function (m) {
    if (m[1] >= pos && m[3] <= fin) return null;
    var a = m[1], b = m[3];
    a = a > fin ? a - n : (a >= pos ? pos : a);
    b = b > fin ? b - n : (b >= pos ? pos - 1 : b);
    return [m[0], a, m[2], b];
  }).filter(function (m) { return m && m[3] >= m[1]; });
  this.maxCols -= n;
};
// Sheet.copyTo(spreadsheet): copia TODO (valores, fórmulas, formato, combinadas, alturas) con el nombre "Copy of X".
// Peor caso real: las fórmulas que apuntan a otras hojas (que en la hoja nueva no existen) quedan en #REF!.
FakeSheet.prototype.copyTo = function (spreadsheet) {
  var c = new FakeSheet('Copy of ' + this.name, JSON.parse(JSON.stringify(this.data)), this.maxRows, this.maxCols);
  c.formulas = JSON.parse(JSON.stringify(this.formulas)); c.styles = JSON.parse(JSON.stringify(this.styles));
  c.formats = JSON.parse(JSON.stringify(this.formats)); c.merges = this.merges.map(function (m) { return m.slice(); });
  c.rowHeights = Object.assign({}, this.rowHeights); c.hidden = Object.assign({}, this.hidden); c.colWidths = Object.assign({}, this.colWidths);
  c.images = __copyLosesImages ? [] : (this.images || []).slice();
  Object.keys(c.formulas).forEach(function (k) {
    if (/\b(CARGA|CONTRATOS|PARAMETROS|PANEL)!/.test(c.formulas[k])) { var q = k.split(','); c._set(+q[0], +q[1], '#REF!'); }
  });
  c.parentSpreadsheet = spreadsheet;
  spreadsheet.sheets.push(c);
  this.opLog.push('copyTo(spreadsheet ' + spreadsheet.getId() + ')');
  return c;
};
FakeSheet.prototype.getRowHeight = function (r) { return this.rowHeights[r] || 21; };
FakeSheet.prototype.setRowHeight = function (r, h) { this.rowHeights[r] = h; return this; };
FakeSheet.prototype.hideRows = function (r, n) { for (var i = 0; i < (n || 1); i++) this.hidden[r + i] = true; this.opLog.push('hideRows ' + r + ' ' + (n || 1)); };
FakeSheet.prototype.showRows = function (r, n) { for (var i = 0; i < (n || 1); i++) delete this.hidden[r + i]; this.opLog.push('showRows ' + r + ' ' + (n || 1)); };
FakeSheet.prototype.isRowHiddenByUser = function (r) { return !!this.hidden[r]; };
FakeSheet.prototype.setColumnWidth = function (c, w) { this.colWidths[c] = w; return this; };
FakeSheet.prototype.getColumnWidth = function (c) { return this.colWidths[c] || 100; };
FakeSheet.prototype.getLastRow = function () {
  for (var i = this.data.length - 1; i >= 0; i--) {
    var r = this.data[i] || [];
    for (var j = 0; j < r.length; j++) if (r[j] !== '' && r[j] !== null && r[j] !== undefined) return i + 1;
  }
  return 0;
};
FakeSheet.prototype._get = function (r, c) { var row = this.data[r - 1]; var v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; };
FakeSheet.prototype._set = function (r, c, v) {
  if (c > this.maxCols) throw new Error('La hoja ' + this.name + ' solo tiene ' + this.maxCols + ' columnas (se escribió la columna ' + c + ')');
  while (this.data.length < r) this.data.push([]);
  var row = this.data[r - 1];
  while (row.length < c) row.push('');
  row[c - 1] = v;
};
function __colNum(letras) { var n = 0; for (var i = 0; i < letras.length; i++) n = n * 26 + (letras.charCodeAt(i) - 64); return n; }
function __colLetras(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function __makeRange(sheet, r, col, nr, nc) {
  if (col + nc - 1 > sheet.maxCols) throw new Error('Rango fuera de la hoja ' + sheet.name + ': columna ' + (col + nc - 1) + ' > ' + sheet.maxCols);
  var self = sheet;
  var rg = {
    getRow: function () { return r; }, getColumn: function () { return col; },
    getLastRow: function () { return r + nr - 1; }, getLastColumn: function () { return col + nc - 1; },
    getNumRows: function () { return nr; }, getNumColumns: function () { return nc; },
    getA1Notation: function () { return __colLetras(col) + r + (nr * nc > 1 ? ':' + __colLetras(col + nc - 1) + (r + nr - 1) : ''); },
    getValues: function () {
      var out = [];
      for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) row.push(self._get(r + i, col + j)); out.push(row); }
      return out;
    },
    getValue: function () { return self._get(r, col); },
    getFormula: function () { return self.formulas[r + ',' + col] || ''; },
    setValues: function (vals) {
      if (vals.length !== nr || vals[0].length !== nc) throw new Error('setValues: tamaño distinto (' + vals.length + 'x' + vals[0].length + ' vs ' + nr + 'x' + nc + ')');
      for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) { self._set(r + i, col + j, vals[i][j]); delete self.formulas[(r + i) + ',' + (col + j)]; }
    },
    setValue: function (v) { self._set(r, col, v); delete self.formulas[r + ',' + col]; return rg; },
    setFormula: function (f) {
      if (!/^=/.test(f)) throw new Error('setFormula: debe empezar con "=": ' + f);
      self._set(r, col, ''); self.formulas[r + ',' + col] = f; return rg;
    },
    clearContent: function () { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) { self._set(r + i, col + j, ''); delete self.formulas[(r + i) + ',' + (col + j)]; } return rg; },
    setNumberFormat: function (f) { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) self.formats[(r + i) + ',' + (col + j)] = f; return rg; },
    getNumberFormat: function () { return self.formats[r + ',' + col] || ''; },
    merge: function () {
      if (nr * nc < 2) return rg;
      for (var i = 0; i < self.merges.length; i++) { var m = self.merges[i]; if (m[0] === r && m[1] === col && m[2] === r + nr - 1 && m[3] === col + nc - 1) return rg; }
      self.merges.push([r, col, r + nr - 1, col + nc - 1]); return rg;
    },
    breakApart: function () {
      self.merges = self.merges.filter(function (m) { return !(m[0] >= r && m[2] <= r + nr - 1 && m[1] >= col && m[3] <= col + nc - 1); });
      return rg;
    },
    getMergedRanges: function () {
      return self.merges.filter(function (m) { return !(m[2] < r || m[0] > r + nr - 1 || m[3] < col || m[1] > col + nc - 1); })
        .map(function (m) { return __makeRange(self, m[0], m[1], m[2] - m[0] + 1, m[3] - m[1] + 1); });
    },
    copyTo: function (dest, tipo) {
      // solo se copia el FORMATO (firma de estilo y formato de número); las combinadas NO se copian (hay que combinarlas aparte)
      var dr = dest.getRow(), dc = dest.getColumn(), dnr = dest.getNumRows(), dnc = dest.getNumColumns();
      for (var i = 0; i < dnr; i++) for (var j = 0; j < dnc; j++) {
        var sr = r + (nr === 1 ? 0 : i % nr), sc = col + (nc === 1 ? 0 : j % nc);
        var from = sr + ',' + sc, to = (dr + i) + ',' + (dc + j);
        if (self.styles[from] !== undefined) dest.__sheet.styles[to] = self.styles[from]; else delete dest.__sheet.styles[to];
        if (self.formats[from] !== undefined) dest.__sheet.formats[to] = self.formats[from]; else delete dest.__sheet.formats[to];
        if (tipo === 'PASTE_NORMAL') dest.__sheet._set(dr + i, dc + j, self._get(sr, sc));
      }
      self.opLog.push('copyTo ' + rg.getA1Notation() + ' -> ' + dest.getA1Notation());
    },
    __sheet: sheet
  };
  return rg;
}
FakeSheet.prototype.getRange = function (a, b, c, d) {
  if (typeof a === 'string') {
    var m = /^([A-Z]+)(\d+)$/.exec(a);
    if (!m) throw new Error('A1 no soportado en el mock: ' + a);
    return __makeRange(this, Number(m[2]), __colNum(m[1]), 1, 1);
  }
  return __makeRange(this, a, b, c || 1, d || 1);
};

var __fixtureData = JSON.parse(__fixture);
function __revive(v) {
  if (v && typeof v === 'object' && v.$date) {
    var p = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(v.$date);
    return new Date(Date.UTC(+p[1], +p[2] - 1, +p[3], +p[4] + 5, +p[5], +p[6]));   // hora de Bogotá = UTC-5
  }
  return v === null ? '' : v;
}
function __sheetFromFixture(name, maxCols) {
  var h = new FakeSheet(name, __fixtureData[name].map(function (r) { return r.map(__revive); }), 1000, maxCols);
  return h;
}
// FACTURA del formato oficial (A1:Q48): valores, fórmulas, estilos, combinadas y alturas tomados de la plantilla real
function __facturaFromFixture() {
  var L = __fixtureData.FACTURA_LAYOUT, f = new FakeSheet('FACTURA', [], 1000, 26);
  Object.keys(L.cells).forEach(function (k) {
    var p = k.split(','), v = L.cells[k];
    if (typeof v === 'string' && v.charAt(0) === '=') { f._set(+p[0], +p[1], ''); f.formulas[k] = v; } else f._set(+p[0], +p[1], v);
  });
  Object.keys(L.styles).forEach(function (k) { f.styles[k] = L.styles[k]; });
  f.merges = L.merges.map(function (m) { return m.slice(); });
  Object.keys(L.heights).forEach(function (k) { f.rowHeights[Number(k)] = L.heights[k]; });
  f.images = [{ nombre: 'logo HOMO' }, { nombre: 'logo Gobernación' }];     // los 2 logos de la plantilla (imágenes sobre la cuadrícula)
  return f;
}
var __sheets = {};
// opciones: { cargaCols: 22 (hoja vieja, por defecto) | 26 }  -> la migración v3 debe poder con ambas
function __resetSheets(opciones) {
  opciones = opciones || {};
  var carga = __sheetFromFixture('CARGA', opciones.cargaCols || 22);
  carga.styles['1,22'] = 'ENCABEZADO|Arial|verde';          // el formato del encabezado V1 debe copiarse a W1:AH1
  carga.formats['2,7'] = 'dd/mm/yyyy'; carga.formats['2,8'] = '"$ "#,##0';
  __sheets = {
    PARAMETROS: __sheetFromFixture('PARAMETROS'), CONTRATOS: __sheetFromFixture('CONTRATOS'), CARGA: carga,
    FACTURA: __facturaFromFixture(), PANEL: new FakeSheet('PANEL', [[]], 100)
  };
  __state.activeSheet = 'CARGA'; __state.activeRow = 2;
}
var __state = { activeSheet: 'CARGA', activeRow: 2, tz: 'America/Bogota' };
var __ui = {
  ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' }, Button: { YES: 'YES', NO: 'NO' }, __yes: true,
  alert: function (t, x) { __log.alerts.push({ titulo: t, texto: x }); return __ui.__yes ? 'YES' : 'NO'; },
  createMenu: function (n) {
    var m = { nombre: n, items: [], addItem: function (t, f) { this.items.push([t, f]); return this; }, addSeparator: function () { return this; }, addToUi: function () { __log.menu = this; } };
    return m;
  },
  showModalDialog: function (h, t) { __log.dialog = { titulo: t, html: h.__html }; }
};
function FakeSpreadsheet(id, name) {
  this.id = id; this.name = name; this.sheets = [new FakeSheet('Hoja 1', [], 1000, 26)];
}
FakeSpreadsheet.prototype.getId = function () { return this.id; };
FakeSpreadsheet.prototype.getName = function () { return this.name; };
FakeSpreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; };
FakeSpreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
FakeSpreadsheet.prototype.getSheetByName = function (n) { return this.sheets.filter(function (x) { return x.name === n; })[0] || null; };
FakeSpreadsheet.prototype.deleteSheet = function (sh) {
  if (this.sheets.length < 2) throw new Error('No se puede borrar la única hoja de la hoja de cálculo');
  var i = this.sheets.indexOf(sh); if (i < 0) throw new Error('La hoja no pertenece a esta hoja de cálculo');
  this.sheets.splice(i, 1);
};
var __ss = {
  getSheetByName: function (n) { return __sheets[n] || null; },
  getId: function () { return 'SS_ID_123'; }, getUrl: function () { return 'https://docs.google.com/spreadsheets/d/SS_ID_123/edit'; },
  getSpreadsheetTimeZone: function () { return __state.tz; },
  setSpreadsheetTimeZone: function (z) { __state.tz = z; },
  getActiveSheet: function () { return __sheets[__state.activeSheet]; }
};
var SpreadsheetApp = {
  getActive: function () {
    var sh = __sheets[__state.activeSheet];
    sh.getActiveRange = function () { return { getRow: function () { return __state.activeRow; } }; };
    return __ss;
  },
  getUi: function () { return __ui; },
  create: function (nombre) {
    var t = new FakeSpreadsheet(__newId('TEMPSS'), nombre);
    __tempSpreadsheets[t.id] = t;
    var f = new FakeFile(nombre, null, __rootFolder); f.id = t.id; __rootFolder.files.push(f); __allFiles[t.id] = f;
    __log.created = (__log.created || []).concat([t.id]);
    return t;
  },
  flush: function () {
    __log.flushes = (__log.flushes || 0) + 1;
    // simula que Google recalcula las fórmulas de FACTURA con el valor actual de P1 (cada celda con fórmula toma un valor distinto)
    var F = __sheets.FACTURA, p1 = F._get(1, 16);
    Object.keys(F.formulas).forEach(function (k) { var q = k.split(','); if (+q[1] === 16 && +q[0] === 1) return; F._set(+q[0], +q[1], 'calc|' + p1 + '|' + k); });
  },
  CopyPasteType: { PASTE_FORMAT: 'PASTE_FORMAT', PASTE_NORMAL: 'PASTE_NORMAL', PASTE_VALUES: 'PASTE_VALUES' }
};

// ---------------------------------------------------------------- Utilities
function __pad(n) { return (n < 10 ? '0' : '') + n; }
function __blob(bytes, mime, name) {
  return {
    __bytes: bytes, __mime: mime, __name: name,
    getBytes: function () { return this.__bytes; }, getName: function () { return this.__name; },
    setName: function (n) { this.__name = n; return this; }, getContentType: function () { return this.__mime; }
  };
}
var Utilities = {
  sleep: function () { __log.sleeps++; },
  getUuid: function () { return 'uuid-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2); },
  base64Decode: function (s) {
    if (!/^[A-Za-z0-9+\/=\s]*$/.test(s)) throw new Error('Base64 inválido');
    return Array.from(__Buffer.from(s, 'base64'), function (b) { return b > 127 ? b - 256 : b; });
  },
  base64Encode: function (bytes) { return __Buffer.from(bytes.map(function (b) { return b & 0xFF; })).toString('base64'); },
  newBlob: function (bytes, mime, name) { return __blob(bytes, mime, name); },
  formatDate: function (d, tz, fmt) {
    var t = new Date(d.getTime() - 5 * 3600 * 1000);     // Bogotá = UTC-5 (sin horario de verano)
    var y = t.getUTCFullYear(), m = __pad(t.getUTCMonth() + 1), dd = __pad(t.getUTCDate());
    if (fmt === 'yyyy-MM-dd') return y + '-' + m + '-' + dd;
    if (fmt === 'yyyy-MM') return y + '-' + m;
    throw new Error('formato no soportado en el mock: ' + fmt);
  },
  parseDate: function (s, tz, fmt) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!p) throw new Error('parseDate: ' + s);
    return new Date(Date.UTC(+p[1], +p[2] - 1, +p[3], 5, 0, 0));
  }
};

// ---------------------------------------------------------------- Drive
var __ids = 0;
function __newId(p) { return p + (++__ids); }
function __iter(arr) { var i = 0; return { hasNext: function () { return i < arr.length; }, next: function () { return arr[i++]; } }; }
function FakeFile(name, blob, parent) {
  this.id = __newId('FILE'); this.name = name; this.blob = blob; this.parent = parent; this.trashed = false; this.created = new Date();
}
FakeFile.prototype.getId = function () { return this.id; };
FakeFile.prototype.getName = function () { return this.name; };
FakeFile.prototype.setName = function (n) { this.name = n; return this; };
FakeFile.prototype.getUrl = function () { return 'https://drive.google.com/file/d/' + this.id + '/view'; };
FakeFile.prototype.setTrashed = function (t) { this.trashed = t; return this; };
FakeFile.prototype.getDateCreated = function () { return this.created; };
FakeFile.prototype.moveTo = function (folder) {
  var i = this.parent.files.indexOf(this); if (i >= 0) this.parent.files.splice(i, 1);
  folder.files.push(this); this.parent = folder; return this;
};
function FakeFolder(name, parent) { this.id = __newId('FOLDER'); this.name = name; this.parent = parent; this.files = []; this.folders = []; this.trashed = false; }
FakeFolder.prototype.getId = function () { return this.id; };
FakeFolder.prototype.getName = function () { return this.name; };
FakeFolder.prototype.getUrl = function () { return 'https://drive.google.com/drive/folders/' + this.id; };
FakeFolder.prototype.isTrashed = function () { return this.trashed; };
FakeFolder.prototype.getFoldersByName = function (n) { return __iter(this.folders.filter(function (f) { return f.name === n && !f.trashed; })); };
FakeFolder.prototype.createFolder = function (n) { var f = new FakeFolder(n, this); this.folders.push(f); __allFolders[f.id] = f; return f; };
FakeFolder.prototype.createFile = function (blob) {
  var f = new FakeFile(blob.getName(), blob, this); this.files.push(f); __allFiles[f.id] = f; return f;
};
FakeFolder.prototype.getFiles = function () { return __iter(this.files.filter(function (f) { return !f.trashed; })); };
FakeFolder.prototype.getFilesByName = function (n) { return __iter(this.files.filter(function (f) { return f.name === n && !f.trashed; })); };
FakeFolder.prototype.removeFile = function (f) { var i = this.files.indexOf(f); if (i >= 0) this.files.splice(i, 1); return this; };
FakeFolder.prototype.addFile = function (f) { this.files.push(f); f.parent = this; return this; };
var __allFolders = {}, __allFiles = {};
var __rootFolder = new FakeFolder('Mi unidad', null);
var DriveApp = {
  getRootFolder: function () { return __rootFolder; },
  getFolderById: function (id) { var f = __allFolders[id]; if (!f) throw new Error('No se encontró la carpeta ' + id); return f; },
  getFileById: function (id) { var f = __allFiles[id]; if (!f) throw new Error('No se encontró el archivo ' + id); return f; },
  createFolder: function (n) { var f = new FakeFolder(n, null); __allFolders[f.id] = f; return f; }
};
var Drive = {
  Files: {
    create: function (resource, blob, opts) {
      if (__ocrFail) throw new Error('Drive API no disponible (simulado)');
      __log.driveCreates.push({ resource: resource, opts: opts, mime: blob.getContentType() });
      var id = __newId('DOC');
      var texto = __ocrOverride !== null ? __ocrOverride : __hostOcr(blob.getBytes());
      __docs[id] = texto;
      return { id: id };
    },
    remove: function (id) { delete __docs[id]; __log.removed.push(id); }
  }
};
var __docs = {};
var DocumentApp = {
  openById: function (id) {
    if (!(id in __docs)) throw new Error('Doc no existe ' + id);
    return { getBody: function () { return { getText: function () { return __docs[id]; } }; } };
  }
};

// ---------------------------------------------------------------- otros servicios
var __cacheStore = {};
var CacheService = {
  getScriptCache: function () {
    return {
      get: function (k) { return k in __cacheStore ? __cacheStore[k] : null; },
      put: function (k, v) { __cacheStore[k] = String(v); },
      remove: function (k) { delete __cacheStore[k]; }
    };
  }
};
var LockService = {
  getScriptLock: function () { return { tryLock: function () { return !__lockBusy; }, releaseLock: function () { __log.released = (__log.released || 0) + 1; } }; }
};
var MailApp = { sendEmail: function (o) { __log.mails.push(o); } };
var ScriptApp = {
  getOAuthToken: function () { return 'TOKEN_FALSO'; },
  getService: function () { return { getUrl: function () { return 'https://script.google.com/macros/s/AKfycbFAKE/exec'; } }; }
};
var UrlFetchApp = {
  fetch: function (url, opts) {
    var p1 = __sheets.FACTURA._get(1, 16);
    var mx = /\/spreadsheets\/d\/([^\/]+)\/export\?format=xlsx/.exec(url);
    var code;
    if (mx) {
      __log.fetchesXlsx = (__log.fetchesXlsx || []).concat([{ url: url, opts: opts, p1: p1 }]);
      code = __xlsxStatus.length ? __xlsxStatus.shift() : 200;
    } else {
      // se anota qué filas de FACTURA estaban ocultas en el momento exacto de la exportación a PDF
      __log.fetches.push({ url: url, opts: opts, p1: p1, ocultas: Object.keys(__sheets.FACTURA.hidden).map(Number).sort(function (a, b) { return a - b; }) });
      code = __exportStatus.length ? __exportStatus.shift() : 200;
    }
    if (mx) {
      // export de la hoja TEMPORAL: se anota cómo estaba en ese momento (nombres de hojas, tamaño, fórmulas, filas, combinadas)
      var t = __tempSpreadsheets[mx[1]];
      if (!t) code = 404;
      else {
        var sh = t.sheets[0];
        __log.xlsx = (__log.xlsx || []).concat([{
          id: t.id, nombresHojas: t.sheets.map(function (x) { return x.name; }), maxRows: sh.maxRows, maxCols: sh.maxCols,
          formulas: Object.keys(sh.formulas).length, merges: sh.merges.map(function (m) { return m.slice(); }),
          valores: JSON.parse(JSON.stringify(sh.data)), p1: p1, ocultas: Object.keys(sh.hidden).map(Number),
          trashedAlExportar: !!(__allFiles[t.id] && __allFiles[t.id].trashed), imagenes: (sh.images || []).length
        }]);
      }
      return {
        getResponseCode: function () { return code; },
        getBlob: function () {
          var bytes = __xlsxBytes !== null ? __xlsxBytes : Array.from(__Buffer.concat([__Buffer.from([0x50, 0x4B, 0x03, 0x04]), __Buffer.from('xlsx factura fila ' + p1 + ' ' + 'x'.repeat(200))]));
          return __blob(bytes, __xlsxMime !== null ? __xlsxMime : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'export.xlsx');
        }
      };
    }
    return {
      getResponseCode: function () { return code; },
      getBlob: function () { return __blob(Array.from(__Buffer.from('%PDF-1.4 factura fila ' + p1 + ' ' + 'x'.repeat(200))), 'application/pdf', 'export.pdf'); }
    };
  }
};
var HtmlService = {
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
  createHtmlOutputFromFile: function (n) {
    var o = { __file: n, meta: {}, setTitle: function (t) { this.title = t; return this; }, addMetaTag: function (k, v) { this.meta[k] = v; return this; }, setXFrameOptionsMode: function (m) { this.xf = m; return this; } };
    return o;
  },
  createHtmlOutput: function (h) {
    return { __html: h, setWidth: function () { return this; }, setHeight: function () { return this; } };
  }
};
var Session = { getScriptTimeZone: function () { return 'America/Bogota'; } };

__resetSheets();
