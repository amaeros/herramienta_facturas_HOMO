/**
 * documentos.ts - Lector de documentos del contrato (contrato, acta de prorroga/adicion y poliza).
 *
 * Modulo PURO (sin red, sin Node, sin DOM): recibe el TEXTO ya extraido del PDF (pdf.js, ver pdfText.ts)
 * y devuelve los datos del contrato que se pueden leer de ese documento.
 *
 *   leerDocumento(texto) -> { tipo, campos, notas }
 *
 * Tipos reconocidos (ESE Hospital Mental de Antioquia, HOMO):
 *   - 'contrato'       formato GJ-CO-FR-23 (contrato de prestacion de servicios)
 *   - 'acta_prorroga'  formato GJ-CO-FR-12 (acta de prorroga o adicion)
 *   - 'poliza'         poliza de cumplimiento entidad estatal (Seguros del Estado)
 *   - 'desconocido'    cualquier otra cosa
 *
 * Tolerancia: pdf.js deja espacios raros DENTRO de las fichas ("2026CPS 0 4 3", "202 6", "GJ - CO - FR - 2 3"),
 * saltos de linea en medio de frases, dobles espacios y marcas de agua ("Previsualizacion"). Se colapsan los
 * espacios, se comparan las etiquetas sin tildes y se permiten espacios sueltos entre las letras / digitos
 * de los codigos y numeros. Solo se llenan los campos que de verdad se encuentran. Nunca lanza errores.
 *
 * Reglas para no confundirse:
 *   - del contrato NO se saca la fecha de inicio (depende del acta de inicio);
 *   - del acta, la fecha final es la NUEVA (FINALIZANDO EL ... / ultimo "sin exceder el ..."), no la "terminacion inicial";
 *     tampoco se usan los montos / fechas del contrato interadministrativo que el acta menciona;
 *   - de la poliza solo se toma la vigencia DESDE (la vigencia HASTA cubre meses mas alla del contrato).
 */

export type TipoDocumentoLeido = 'contrato' | 'acta_prorroga' | 'poliza' | 'desconocido';

export interface CamposDocumento {
  /** Normalizado, sin espacios: "2026CPS043" */
  numeroContrato?: string;
  nombre?: string;
  /** Solo digitos */
  cedula?: string;
  /** Una sola linea, con espacios simples */
  objeto?: string;
  /** Honorario mensual (COP) */
  honorario?: number;
  /** Valor total del contrato (COP) */
  valorTotal?: number;
  /** YYYY-MM-DD */
  inicio?: string;
  /** YYYY-MM-DD */
  fin?: string;
  direccion?: string;
  ciudad?: string;
  /** Solo digitos */
  telefono?: string;
}

export interface DocumentoLeido {
  tipo: TipoDocumentoLeido;
  campos: CamposDocumento;
  notas: string[];
}

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/** Patron que permite un espacio suelto entre cada letra: L('pago') -> "p ?a ?g ?o". */
function L(palabra: string): string {
  return palabra.replace(/\s+/g, '').split('').map(function (c) {
    return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join(' ?');
}

const MES_SRC = Object.keys(MESES).map(L).join('|');
/** dia, mes en letras, anio (con espacios sueltos). Grupos: 3 */
const FECHA_SRC = '(?<!\\d)(\\d ?\\d?) *de *(' + MES_SRC + ') *de *(2 ?0 ?\\d ?\\d)(?!\\d)';
/** Numero con puntos de miles ("1.001.370.879", "1001.370.879", "1001370879"); admite espacios sueltos. 1 grupo. */
const NUM_ID_SRC = '(\\d{1,4}(?: ?[. ] ?\\d ?\\d ?\\d)+|\\d{6,11})';
/** Monto con "$". 1 grupo. */
const MONTO_SRC = '\\$ *(\\d{1,3}(?: ?[.,] ?\\d ?\\d ?\\d)+|\\d+)';
/** Codigo de contrato: 2026CPS043, 2026CPSP018 (con espacios sueltos). Grupos: anio, P?, numero, 4to digito pegado */
const CODIGO_SRC = '(?<![\\d])(2 ?0 ?\\d ?\\d) ?C ?P ?S ?(P ?)?(\\d ?\\d ?\\d)(\\d)?';

interface Texto {
  /** lineas limpias (sin marcas de agua ni encabezados repetidos) */
  lines: string[];
  /** posicion de inicio de cada linea dentro de flat */
  lineStarts: number[];
  /** todo en una sola linea, espacios simples, conserva tildes */
  flat: string;
  /** igual que flat pero sin tildes (misma longitud, mismas posiciones) */
  plain: string;
  /** sin tildes, sin espacios, en mayusculas (para clasificar) */
  compact: string;
}

function quitarTildes(s: string): string {
  return s.replace(/[À-ſ]/g, function (c) { return c.normalize('NFD')[0]; });
}

function limpiarLinea(l: string): string {
  return l.replace(/\bPrevisualizaci[oó]n\b/gi, ' ').replace(/ {2,}/g, ' ').trim();
}

/** Quita los encabezados de pagina repetidos (los que terminan en "Codigo: GJ-...") salvo el primero. */
function quitarEncabezadosRepetidos(lines: string[]): string[] {
  const reCod = /^C ?[oó] ?d ?i ?g ?o ?: ?GJ/i;
  const reIni = /^(CONTRATO ?N|ACTA ?DE ?PR)/i;
  const cods: number[] = [];
  lines.forEach(function (l, i) { if (reCod.test(l)) cods.push(i); });
  if (cods.length < 2) return lines;
  const borrar = new Set<number>();
  for (let c = 1; c < cods.length; c++) {
    const k = cods[c];
    let s = -1;
    for (let j = k - 1; j >= Math.max(0, k - 16); j--) { if (reIni.test(lines[j])) { s = j; break; } }
    if (s < 0) continue;
    for (let j = s; j <= k; j++) borrar.add(j);
    if (k + 1 < lines.length && /^\d{1,3}$/.test(lines[k + 1])) borrar.add(k + 1);
  }
  return lines.filter(function (_l, i) { return !borrar.has(i); });
}

function prepararTexto(raw: unknown): Texto {
  let s = typeof raw === 'string' ? raw : (raw === null || raw === undefined ? '' : String(raw));
  try { s = s.normalize('NFC'); } catch { /* sin normalize */ }
  s = s.replace(/\r\n?/g, '\n').replace(/\f/g, '\n')
    .replace(/[    ​‌‍﻿⁠\t]/g, ' ')
    .replace(/[−–—‑]/g, '-');
  let lines = s.split('\n').map(limpiarLinea).filter(function (l) { return l.length > 0; });
  lines = quitarEncabezadosRepetidos(lines);
  const lineStarts: number[] = [];
  let pos = 0;
  lines.forEach(function (l) { lineStarts.push(pos); pos += l.length + 1; });
  const flat = lines.join(' ');
  const plain = quitarTildes(flat);
  const compact = plain.replace(/\s+/g, '').toUpperCase();
  return { lines: lines, lineStarts: lineStarts, flat: flat, plain: plain, compact: compact };
}

function soloDigitos(s: string): string { return s.replace(/\D/g, ''); }

function pad2(n: number): string { return (n < 10 ? '0' : '') + n; }

function isoFecha(dia: number, mes: number, anio: number): string | undefined {
  if (!(anio >= 2000 && anio <= 2100 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31)) return undefined;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return undefined;
  return anio + '-' + pad2(mes) + '-' + pad2(dia);
}

/** Convierte los 3 grupos (dia, mes en letras, anio) de FECHA_SRC a YYYY-MM-DD. */
function fechaDeGrupos(dia: string, mes: string, anio: string): string | undefined {
  const m = MESES[quitarTildes(mes).replace(/\s+/g, '').toLowerCase()];
  if (!m) return undefined;
  return isoFecha(Number(soloDigitos(dia)), m, Number(soloDigitos(anio)));
}

function monto(s: string): number | undefined {
  const v = Number(soloDigitos(s));
  return isFinite(v) && v > 0 ? v : undefined;
}

function limpiarNombre(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[\s.,:;-]+|[\s.,:;-]+$/g, '').trim();
}

/** Texto de un campo largo en una sola linea: sin espacios antes de la puntuacion ni despues de comillas de apertura. */
function ordenarTexto(s: string): string {
  return s.replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)”])/g, '$1')
    .replace(/([(“])\s+/g, '$1')
    .replace(/\bN([°º])(?=\d)/g, 'N$1 ')
    .trim();
}

/** Primer codigo de contrato del texto, normalizado ("2026CPS043"). */
function buscarCodigo(plain: string, desde = 0): string | undefined {
  const re = new RegExp(CODIGO_SRC, 'ig');
  re.lastIndex = desde;
  const m = re.exec(plain);
  if (!m) return undefined;
  return soloDigitos(m[1]) + 'CPS' + (m[2] ? 'P' : '') + soloDigitos(m[3]) + (m[4] || '');
}

/** Busca "etiqueta" y devuelve el codigo de contrato que aparece justo despues; si no, el primero del documento. */
function numeroContrato(plain: string, etiquetas: RegExp[]): string | undefined {
  for (let i = 0; i < etiquetas.length; i++) {
    const m = etiquetas[i].exec(plain);
    if (m) {
      const c = buscarCodigo(plain.substring(m.index, m.index + m[0].length + 40));
      if (c) return c;
    }
  }
  return buscarCodigo(plain);
}

/**
 * Corta un bloque de texto del documento. El bloque empieza justo despues de lo que case `inicio` (la etiqueta,
 * p. ej. "OBJETO:"). Termina en la primera coincidencia de `fines` (o en `max` caracteres). Si el bloque trae
 * una comilla de cierre (”) se corta en la ultima.
 */
function cortarBloque(t: Texto, inicio: RegExp, fines: RegExp[], max: number): string | undefined {
  const mi = inicio.exec(t.plain);
  if (!mi) return undefined;
  const ini = mi.index + mi[0].length;
  let fin = Math.min(t.plain.length, ini + max);
  for (let i = 0; i < fines.length; i++) {
    const r = new RegExp(fines[i].source, fines[i].flags.replace('g', ''));
    const sub = t.plain.substring(ini, fin);
    const mf = r.exec(sub);
    if (mf) fin = ini + mf.index;
  }
  let bloque = t.flat.substring(ini, fin);
  const q = bloque.lastIndexOf('”');
  if (q >= 0) bloque = bloque.substring(0, q + 1);
  bloque = ordenarTexto(bloque);
  return bloque.length >= 15 ? bloque : undefined;
}

function tituloCiudad(s: string): string {
  const MIN = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);
  const ACENTOS: Record<string, string> = {
    medellin: 'Medellín', bogota: 'Bogotá', itagui: 'Itagüí', apartado: 'Apartadó',
    sopetran: 'Sopetrán', jerico: 'Jericó', jardin: 'Jardín', cali: 'Cali',
  };
  return s.toLowerCase().split(/\s+/).map(function (w, i) {
    if (ACENTOS[quitarTildes(w)]) return ACENTOS[quitarTildes(w)];
    if (i > 0 && MIN.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

export function leerDocumento(texto: string): DocumentoLeido {
  try {
    const t = prepararTexto(texto);
    if (t.compact.replace(/[^A-Z0-9]/g, '').length < 30) {
      return { tipo: 'desconocido', campos: {}, notas: ['El documento no trae texto (¿es un PDF escaneado o vacío?): no se pudo leer.'] };
    }
    const tipo = clasificar(t);
    if (tipo === 'contrato') return leerContrato(t);
    if (tipo === 'acta_prorroga') return leerActa(t);
    if (tipo === 'poliza') return leerPoliza(t);
    return {
      tipo: 'desconocido',
      campos: {},
      notas: ['No se reconoció el tipo de documento (se esperaba el contrato GJ-CO-FR-23, el acta de prórroga o adición GJ-CO-FR-12 o la póliza de cumplimiento).'],
    };
  } catch (e) {
    const msg = e && (e as Error).message ? (e as Error).message : String(e);
    return { tipo: 'desconocido', campos: {}, notas: ['Error interno del lector de documentos: ' + msg] };
  }
}

// ---------------------------------------------------------------------------
// Clasificacion
// ---------------------------------------------------------------------------

function clasificar(t: Texto): TipoDocumentoLeido {
  const c = t.compact;
  function has(s: string): number { return c.indexOf(s) >= 0 ? 1 : 0; }

  let poliza = 0;
  poliza += 3 * has('VIGENCIADESDE');
  poliza += 2 * has('FECHAEXPEDICION');
  poliza += 2 * has('SEGUROSDELESTADO');
  poliza += 1 * has('DATOSDELTOMADOR');
  poliza += 1 * has('TIPOMOVIMIENTO');
  poliza += 1 * has('POLIZADESEGURODECUMPLIMIENTO');

  let acta = 0;
  acta += 3 * has('GJ-CO-FR-12');
  acta += 3 * has('ACTADEPRORROGA');
  acta += 2 * has('ADICIONYPRORROGA');
  acta += 1 * has('TERMINACIONINICIAL');
  acta += 1 * has('VALORINICIALDELCONTRATO');
  acta += 1 * has('CONCEPTODELSUPERVISOR');

  let contrato = 0;
  contrato += 3 * has('GJ-CO-FR-23');
  contrato += 2 * has('CONTRATANTE:');
  contrato += 2 * has('PRIMERA.OBJETO');
  contrato += 1 * has('PLAZO:');
  contrato += 1 * has('TERMINACION:');
  contrato += 1 * has('SEGUNDO.VALORDELCONTRATO');
  contrato += 1 * has('FORMADEPAGO:');
  contrato += 1 * has('CONTRATODEPRESTACIONDESERVICIOS');

  // el acta menciona el contrato y su forma de pago; la poliza se menciona en el contrato (garantias)
  const mejor = Math.max(poliza, acta, contrato);
  if (mejor < 4) return 'desconocido';
  if (acta === mejor) return 'acta_prorroga';
  if (poliza === mejor) return 'poliza';
  return 'contrato';
}

// ---------------------------------------------------------------------------
// Contrato (GJ-CO-FR-23)
// ---------------------------------------------------------------------------

function leerContrato(t: Texto): DocumentoLeido {
  const campos: CamposDocumento = {};
  const notas: string[] = [];
  const { plain, flat } = t;

  campos.numeroContrato = numeroContrato(plain, [
    new RegExp('\\b' + L('numero') + ' ?:', 'i'),
    new RegExp('\\b' + L('contrato') + ' ?N ?[°ºo.]', 'i'),
  ]);

  // nombre: "CONTRATISTA : NOMBRE" (encabezado) o "..., y NOMBRE con numero de identificacion ..."
  const reNom = new RegExp('(\\b' + L('contratista') + ' ?: ?)([A-Za-z\'. -]+?)(?= +[A-Za-z]{4,} ?:| *$)', 'i');
  let m = reNom.exec(plain);
  if (m) {
    const ini = m.index + m[1].length;
    campos.nombre = limpiarNombre(flat.substring(ini, ini + m[2].length));
  } else {
    const reNom2 = new RegExp('(, ?y +)([A-Za-z\'. -]{5,90}?)(?= +con +' + L('numerodeidentificacion') + ')', 'i');
    m = reNom2.exec(plain);
    if (m) {
      const ini = m.index + m[1].length;
      campos.nombre = limpiarNombre(flat.substring(ini, ini + m[2].length));
    }
  }

  // cedula: "con numero de identificacion 1.001.234.567" (la del gerente dice "cedula de ciudadania numero", la del HOMO "identificacion tributaria")
  m = new RegExp('\\bcon +' + L('numerodeidentificacion') + ' *' + NUM_ID_SRC, 'i').exec(plain);
  if (m) campos.cedula = soloDigitos(m[1]);

  // objeto: bloque del encabezado "OBJETO: ... ”" (termina antes de "Codigo:"); respaldo: clausula PRIMERA
  const finesObj = [
    new RegExp(L('codigo') + ' ?:', 'i'),
    new RegExp('\\b' + L('paragrafo') + ' ?1', 'i'),
    new RegExp('\\b' + L('segundo') + ' ?\\.', 'i'),
    new RegExp('\\b' + L('segunda') + ' ?\\.', 'i'),
  ];
  campos.objeto = cortarBloque(t, new RegExp('\\b' + L('objeto') + ' ?: ?', 'i'), finesObj, 3000)
    || cortarBloque(t, new RegExp('\\b' + L('primera') + ' ?\\. ?' + L('objeto') + ' ?\\.? ?', 'i'), finesObj, 3000);

  // valor total (inicial): "VALOR: $ 36.081.000"; respaldo: clausula SEGUNDO. VALOR DEL CONTRATO
  m = new RegExp('\\b' + L('valor') + ' ?: ?' + MONTO_SRC, 'i').exec(plain);
  if (!m) m = new RegExp(L('valordelcontrato') + '[^$]{0,300}?' + MONTO_SRC, 'i').exec(plain);
  if (m) campos.valorTotal = monto(m[1]);

  // honorario: FORMA DE PAGO ... "la suma de CUATRO MILLONES ... ($ 4.009.000)"
  const fp = new RegExp(L('formadepago'), 'ig');
  let fm: RegExpExecArray | null;
  while ((fm = fp.exec(plain)) !== null) {
    const ventana = plain.substring(fm.index, fm.index + 900);
    const hm = new RegExp(L('lasumade') + '[^$]{0,200}?' + MONTO_SRC, 'i').exec(ventana);
    if (hm) { campos.honorario = monto(hm[1]); break; }
  }

  // terminacion: "TERMINACION : Sin exceder el 30 de Septiembre de 2026."
  m = new RegExp(L('terminacion') + ' ?: ?(?:' + L('sinexceder') + ' *(?:el)? *)?' + FECHA_SRC, 'i').exec(plain);
  if (m) campos.fin = fechaDeGrupos(m[1], m[2], m[3]);

  notas.push('El contrato no trae la fecha exacta de inicio (depende del acta de inicio).');
  if (campos.valorTotal !== undefined) notas.push('El valor del contrato es el valor inicial; si hubo adiciones, el valor total sale del acta de prórroga o adición.');
  if (campos.fin === undefined) notas.push('No se encontró la fecha de terminación del contrato.');
  if (campos.honorario === undefined) notas.push('No se encontró el honorario mensual en la forma de pago.');
  if (!campos.numeroContrato) notas.push('No se encontró el número del contrato.');
  if (!campos.cedula) notas.push('No se encontró la cédula del contratista.');

  return { tipo: 'contrato', campos: limpiarCampos(campos), notas: notas };
}

// ---------------------------------------------------------------------------
// Acta de prorroga o adicion (GJ-CO-FR-12)
// ---------------------------------------------------------------------------

function leerActa(t: Texto): DocumentoLeido {
  const campos: CamposDocumento = {};
  const notas: string[] = [];
  const { plain, flat } = t;

  campos.numeroContrato = numeroContrato(plain, [new RegExp('\\b' + L('numero') + ' ?: ?', 'i')]);

  // nombre: "Nombre o Razon Social NOMBRE  Representante legal ..."
  let m = new RegExp('(' + L('nombreorazonsocial') + ' ?:? ?)([A-Za-z\'. -]+?)(?= +' + L('representante') + '| +' + L('nit') + ' ?o ?c)', 'i').exec(plain);
  if (m) {
    const ini = m.index + m[1].length;
    campos.nombre = limpiarNombre(flat.substring(ini, ini + m[2].length));
  }

  // cedula: "Nit o cedula representante legal y/o persona natural 1.001.234.567"; respaldo: "identificado/a con C.C. ..."
  m = new RegExp(L('nit') + ' ?o ?' + L('cedula') + '[^0-9]{0,90}?' + NUM_ID_SRC, 'i').exec(plain);
  if (!m) m = new RegExp('\\bC\\.? ?C\\.? ?:? ?' + NUM_ID_SRC, 'i').exec(plain);
  if (m) campos.cedula = soloDigitos(m[1]);

  // objeto: "Objeto: ... ”" hasta "Fecha de Suscripcion"
  campos.objeto = cortarBloque(t, new RegExp('\\b' + L('objeto') + ' ?: ?', 'i'), [
    new RegExp(L('fechadesuscripcion'), 'i'),
    new RegExp(L('fechainicio'), 'i'),
  ], 2500);

  // inicio: "Fecha Inicio del contrato 01 de enero de 2026"
  m = new RegExp(L('fechainiciodelcontrato') + ' ?:? ?' + FECHA_SRC, 'i').exec(plain);
  if (m) campos.inicio = fechaDeGrupos(m[1], m[2], m[3]);

  // fin: la NUEVA terminacion. Candidatas: "FINALIZANDO EL ..." y "sin exceder el ..." (salvo "Terminacion inicial");
  // se toma la mas tardia de las del acta. No se miran las de "sin superar" (son del contrato interadministrativo / clausulas).
  const fin = finActa(plain);
  if (fin) campos.fin = fin;
  else {
    const mi = new RegExp(L('terminacioninicial') + ' ?:? ?(?:' + L('sinexceder') + ' *(?:el)? *)?' + FECHA_SRC, 'i').exec(plain);
    if (mi) {
      const f = fechaDeGrupos(mi[1], mi[2], mi[3]);
      if (f) {
        campos.fin = f;
        notas.push('El acta no indica una nueva fecha de terminación; se usa la terminación inicial.');
      }
    }
  }

  // valor total con adiciones
  const vInicial = new RegExp(L('valordelcontratoinicialmasadicion') + ' ?:? ?' + MONTO_SRC, 'i').exec(plain);
  const vConAd = new RegExp(L('valortotaldelcontratoconadiciones') + ' ?:? ?' + MONTO_SRC, 'i').exec(plain);
  const a = vInicial ? monto(vInicial[1]) : undefined;
  const b = vConAd ? monto(vConAd[1]) : undefined;
  campos.valorTotal = b !== undefined ? b : a;
  if (a !== undefined && b !== undefined && a !== b) {
    notas.push('El acta trae dos valores totales distintos (valor inicial más adición y valor total con adiciones); se usa el segundo. Revísalo.');
  }

  // honorario deducido: adicion / meses de prorroga
  const mAd = new RegExp('\\b' + L('adicion') + ' ?N ?[°ºo.]? ?\\d+ ?:? ?' + MONTO_SRC, 'i').exec(plain)
    || new RegExp(L('valoradicion') + ' ?(?:No\\.?|N ?[°º])? ?\\d* ?:? ?' + MONTO_SRC, 'i').exec(plain);
  const mPr = new RegExp('\\b' + L('prorroga') + ' ?N ?[°ºo.]? ?\\d+ +[A-Za-z ]*?\\( ?(\\d ?\\d) ?\\) ?' + L('meses'), 'i').exec(plain)
    || new RegExp(L('seprorroga') + ' +[A-Za-z ]*?\\( ?(\\d ?\\d) ?\\) ?' + L('meses'), 'i').exec(plain);
  const adicion = mAd ? monto(mAd[1]) : undefined;
  const meses = mPr ? Number(soloDigitos(mPr[1])) : 0;
  if (adicion !== undefined && meses > 0) {
    const h = adicion / meses;
    if (Math.abs(h - Math.round(h)) < 1e-9) {
      campos.honorario = Math.round(h);
      notas.push('El honorario mensual se dedujo dividiendo la adición entre los meses de prórroga; verifícalo con el contrato.');
    } else {
      notas.push('La adición no se divide exacto entre los meses de prórroga; no se dedujo el honorario mensual.');
    }
  }

  if (!campos.inicio) notas.push('No se encontró la fecha de inicio del contrato en el acta.');
  if (!campos.fin) notas.push('No se encontró la fecha de terminación del contrato en el acta.');
  if (campos.valorTotal === undefined) notas.push('No se encontró el valor total del contrato con adiciones.');

  return { tipo: 'acta_prorroga', campos: limpiarCampos(campos), notas: notas };
}

/** La fecha final nueva del acta: la mas tardia entre "FINALIZANDO EL ..." y "sin exceder el ..." (sin la terminacion inicial). */
function finActa(plain: string): string | undefined {
  const cands: string[] = [];
  const reFin = new RegExp(L('finalizando') + ' *(?:el)? *' + FECHA_SRC, 'ig');
  let m: RegExpExecArray | null;
  while ((m = reFin.exec(plain)) !== null) {
    const f = fechaDeGrupos(m[1], m[2], m[3]);
    if (f) cands.push(f);
  }
  if (cands.length) return cands.sort().pop();

  const reSin = new RegExp(L('sinexceder') + ' *(?:el)? *' + FECHA_SRC, 'ig');
  while ((m = reSin.exec(plain)) !== null) {
    const antes = plain.substring(Math.max(0, m.index - 40), m.index);
    if (new RegExp(L('terminacioninicial') + ' ?:? ?$', 'i').test(antes)) continue;
    const f = fechaDeGrupos(m[1], m[2], m[3]);
    if (f) cands.push(f);
  }
  return cands.length ? cands.sort().pop() : undefined;
}

// ---------------------------------------------------------------------------
// Poliza de cumplimiento (Seguros del Estado)
// ---------------------------------------------------------------------------

const PALABRA_NOM = "[A-ZÁÉÍÓÚÑÜ'.-]+";
const NOMBRES_SRC = '(' + PALABRA_NOM + '(?: ' + PALABRA_NOM + ')*)';
const ID_LABEL_SRC = '(?:C\\.? ?C\\.?|C\\.? ?E\\.?|T\\.? ?I\\.?|N\\.? ?I\\.? ?T\\.?)';
const MOVIMIENTO_RE = /^(?:ANEXO(?: (?:DE|No\.?|N°) ?(?:\d+ )?)? ?[A-ZÁÉÍÓÚ]+(?: Y [A-ZÁÉÍÓÚ]+)?|EXPEDICI[OÓ]N|MODIFICACI[OÓ]N|PR[OÓ]RROGA|ADICI[OÓ]N|RENOVACI[OÓ]N|REVOCACI[OÓ]N|CANCELACI[OÓ]N|AMPLIACI[OÓ]N|ACLARACI[OÓ]N|ORIGINAL|INICIAL|NUEVA) +/;

function leerPoliza(t: Texto): DocumentoLeido {
  const campos: CamposDocumento = {};
  const notas: string[] = [];
  const { plain, flat } = t;

  // "01 10 2026  01 01 2026 00:00  30 03 2027 23:59": expedicion, vigencia desde, vigencia hasta
  const D2 = '(\\d ?\\d)', Y4 = '(2 ?0 ?\\d ?\\d)', H = '(?: +\\d{1,2} ?: ?\\d{2})?';
  const reFechas = new RegExp('(?<!\\d)' + D2 + ' +' + D2 + ' +' + Y4 + ' +' + D2 + ' +' + D2 + ' +' + Y4 + H + ' +' + D2 + ' +' + D2 + ' +' + Y4 + H);
  const mf = reFechas.exec(plain);
  let finFechas = 0;
  if (mf) {
    finFechas = mf.index + mf[0].length;
    campos.inicio = isoFecha(Number(soloDigitos(mf[4])), Number(soloDigitos(mf[5])), Number(soloDigitos(mf[6])));
  }
  if (campos.inicio) {
    notas.push('La póliza no indica la fecha de fin del contrato; se usa solo su vigencia desde como fecha de inicio.');
    notas.push('La vigencia hasta de la póliza no se usa como fecha de fin: cubre meses más allá del contrato.');
  } else {
    notas.push('No se pudo leer la vigencia de la póliza (fechas de expedición, vigencia desde y hasta).');
  }

  campos.numeroContrato = buscarCodigo(plain);

  // tomador: "APELLIDOS, NOMBRES  CC: 1001.234.567  <direccion> <CIUDAD>, <DEPARTAMENTO> <telefono>"
  const reTomador = new RegExp('^' + NOMBRES_SRC + ', ?' + NOMBRES_SRC + ' +' + ID_LABEL_SRC + ' *:? *' + NUM_ID_SRC + '(?![\\d])');
  let tomador: RegExpExecArray | null = null;
  let resto = '';
  // 1) por lineas (las que siguen a la de las fechas)
  let l0 = 0;
  if (mf) {
    for (let i = 0; i < t.lineStarts.length; i++) { if (t.lineStarts[i] <= mf.index) l0 = i; }
    l0 += 1;
  }
  for (let k = l0; k < Math.min(t.lines.length, l0 + 8) && !tomador; k++) {
    let cand = t.lines.slice(k, k + 4).join(' ');
    for (let r = 0; r < 3; r++) cand = cand.replace(MOVIMIENTO_RE, '');
    const x = reTomador.exec(cand);
    if (x) { tomador = x; resto = cand.substring(x[0].length) + ' ' + t.lines.slice(k + 4, k + 6).join(' '); }
  }
  // 2) respaldo: todo el texto tras las fechas, quitando el tipo de movimiento
  if (!tomador) {
    let cand = flat.substring(finFechas).trim();
    for (let r = 0; r < 3; r++) cand = cand.replace(MOVIMIENTO_RE, '');
    const x = reTomador.exec(cand);
    if (x) { tomador = x; resto = cand.substring(x[0].length); }
  }
  if (tomador) {
    campos.nombre = limpiarNombre(tomador[2] + ' ' + tomador[1]);
    campos.cedula = soloDigitos(tomador[3]);
    leerDomicilio(resto, campos);
  } else {
    notas.push('No se pudo leer el nombre y la cédula del tomador en la póliza.');
  }

  return { tipo: 'poliza', campos: limpiarCampos(campos), notas: notas };
}

/** "CL 36 AA SUR 26 A 30 ENVIGADO, ANTIOQUIA 3001234567" -> direccion, ciudad, telefono */
function leerDomicilio(resto: string, campos: CamposDocumento): void {
  const txt = resto.replace(/\s+/g, ' ').trim();
  const L_ = "A-ZÁÉÍÓÚÑÜ";
  const TEL = '(\\d(?: ?\\d){6,9})(?!\\d)';
  const m = new RegExp('^(.{3,90}?), ?([' + L_ + ']+(?: [' + L_ + ']+)?) +' + TEL).exec(txt);
  if (m) {
    separarDireccionCiudad(m[1], campos);
    campos.telefono = soloDigitos(m[3]);
    return;
  }
  // respaldo: solo telefono celular cerca de la cedula
  const t = new RegExp('(?<!\\d)(3 ?[0-5](?: ?\\d){8})(?!\\d)').exec(txt.substring(0, 160));
  if (t) campos.telefono = soloDigitos(t[1]);
}

const PALABRAS_DIRECCION = new Set(['SUR', 'NORTE', 'ESTE', 'OESTE', 'APTO', 'APT', 'INT', 'INTERIOR', 'CASA', 'BLOQUE', 'TORRE', 'PISO', 'OF', 'OFICINA', 'LOCAL', 'BRR', 'BARRIO']);

/** La ciudad son las palabras al final, despues del ultimo token con digitos. */
function separarDireccionCiudad(s: string, campos: CamposDocumento): void {
  const toks = s.trim().split(/ +/);
  let ult = -1;
  for (let i = 0; i < toks.length; i++) if (/\d/.test(toks[i])) ult = i;
  if (ult < 0 || ult === toks.length - 1) { campos.direccion = toks.join(' '); return; }
  let c = ult + 1;
  while (c < toks.length - 1 && (toks[c].length === 1 || PALABRAS_DIRECCION.has(toks[c].toUpperCase()))) c++;
  campos.direccion = toks.slice(0, c).join(' ');
  campos.ciudad = tituloCiudad(toks.slice(c).join(' '));
}

// ---------------------------------------------------------------------------

/** Quita las claves sin valor (y valores vacios) para que solo queden los campos realmente leidos. */
function limpiarCampos(c: CamposDocumento): CamposDocumento {
  const out: CamposDocumento = {};
  (Object.keys(c) as Array<keyof CamposDocumento>).forEach(function (k) {
    const v = c[k];
    if (v === undefined || v === null || v === '') return;
    if (k === 'honorario' || k === 'valorTotal') { if (typeof v === 'number' && isFinite(v) && v > 0) out[k] = v; return; }
    (out as Record<string, unknown>)[k] = v;
  });
  return out;
}
