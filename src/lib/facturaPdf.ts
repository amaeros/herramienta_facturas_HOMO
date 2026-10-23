// PDF listo para imprimir de la cuenta de cobro (formato oficial HOMO GJ-CO-FR-15 v02).
//
// Por qué existe: el Excel se imprime desde programas e impresoras distintas (Google Sheets y los visores del celular
// ignoran "ajustar a una página", las impresoras recortan los márgenes, las fuentes cambian) y se corta. Un PDF sale
// igual en cualquier equipo.
//
// Cómo: se genera el mismo .xlsx de siempre (generarFacturaXlsx), se lee de nuevo con ExcelJS y se dibuja el área de
// impresión de la hoja FACTURA en UNA página carta vertical: anchos de columna, alturas de fila, celdas combinadas,
// bordes, rellenos, fuentes, alineación, ajuste de texto, formatos de número y las 2 imágenes. Todo se escala por
// igual para que quepa con márgenes de 0,4 pulgadas, centrado.
//
// Librería: pdf-lib (+ @pdf-lib/fontkit). Es JavaScript puro, sin leer archivos de datos propios (pdfkit lee sus
// métricas .afm del disco y eso se rompe al empaquetar en una función de Vercel), mide el texto de forma síncrona y
// empotra fuentes TTF con subconjunto. Las fuentes (src/assets/fuentes) son compatibles en medidas con Arial y
// Calibri, así que los saltos de línea caen donde los pone Excel.

import ExcelJS from 'exceljs';
import { PDFDocument, rgb, LineCapStyle, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs';
import path from 'node:path';
import { generarFacturaXlsx, nombreArchivoFactura, type DatosFactura } from './factura';

// ---------------------------------------------------------------------------------------------------------------
// Constantes de medida
// ---------------------------------------------------------------------------------------------------------------

const PAGINA_ANCHO = 612; // carta, puntos
const PAGINA_ALTO = 792;
const MARGEN = 0.4 * 72;
// El estilo Normal de la plantilla es Calibri 12: su dígito más ancho mide 8 px. Excel guarda el ancho de columna
// en esas unidades, así que px = ancho * 8 y pt = px * 0,75 (B:J con los anchos del formato suma 417,75 pt).
const PX_POR_UNIDAD_DE_ANCHO = 8;
const ANCHO_COLUMNA_POR_DEFECTO = 8.43;
const ALTO_FILA_POR_DEFECTO = 12.75;
const RELLENO_HORIZONTAL = 2; // aire a cada lado del texto dentro de una celda
const RELLENO_VERTICAL = 1;
/** Interlineado de Excel: ~12,75 pt para letra de 10. */
const FACTOR_RENGLON = 1.28;
const TAMANO_MINIMO = 7; // lo más que se achica una letra de una sola línea que no cabe
const TAMANO_MINIMO_AJUSTAR = 6; // lo más que se achica una celda con "reducir hasta ajustar"
const TOLERANCIA = 0.5;

type Familia = 'sans' | 'carlito';
const ARCHIVOS_FUENTE: Record<`${Familia}-${'n' | 'b'}`, string> = {
  'sans-n': 'LiberationSans-Regular.ttf',
  'sans-b': 'LiberationSans-Bold.ttf',
  'carlito-n': 'Carlito-Regular.ttf',
  'carlito-b': 'Carlito-Bold.ttf',
};
/** Altura de las mayúsculas (fracción del tamaño): sirve para centrar la letra a ojo dentro del renglón. */
const ALTURA_MAYUSCULA: Record<Familia, number> = { sans: 0.716, carlito: 0.644 };

const RUTA_FUENTES = ['src', 'assets', 'fuentes'];
const cacheFuentes = new Map<string, Buffer>();
async function leerFuente(archivo: string): Promise<Buffer> {
  let b = cacheFuentes.get(archivo);
  if (!b) {
    // las fuentes entran al paquete por outputFileTracingIncludes (next.config.ts), no por trazado
    b = await fs.promises.readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), ...RUTA_FUENTES, archivo));
    cacheFuentes.set(archivo, b);
  }
  return b;
}

// ---------------------------------------------------------------------------------------------------------------
// Estilo y texto
// ---------------------------------------------------------------------------------------------------------------

type Color = [number, number, number];
interface Estilo {
  familia: Familia;
  negrita: boolean;
  size: number;
  color: Color;
  subrayado: boolean;
}
interface Tramo {
  texto: string;
  est: Estilo;
}
interface Pieza {
  texto: string;
  est: Estilo;
  ancho: number;
  espacio: boolean;
}
interface Linea {
  piezas: Pieza[];
  ancho: number;
  alto: number;
  size: number; // la letra más grande del renglón (manda en el alto y la línea base)
  familia: Familia;
  finDeParrafo: boolean;
}

const NEGRO: Color = [0, 0, 0];

function colorDe(c: Partial<ExcelJS.Color> | undefined): Color {
  const argb = c?.argb;
  if (typeof argb === 'string' && /^[0-9a-fA-F]{6,8}$/.test(argb)) {
    const h = argb.slice(-6);
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
  }
  return NEGRO;
}

function familiaDe(nombre: string | undefined): Familia {
  return /calibri|carlito/i.test(nombre ?? 'Calibri') ? 'carlito' : 'sans';
}

function estiloDe(f: Partial<ExcelJS.Font> | undefined, base?: Estilo): Estilo {
  return {
    familia: f?.name ? familiaDe(f.name) : (base?.familia ?? 'carlito'),
    negrita: f?.bold ?? base?.negrita ?? false,
    size: f?.size ?? base?.size ?? 11,
    color: f?.color ? colorDe(f.color) : (base?.color ?? NEGRO),
    subrayado: f?.underline ? true : (base?.subrayado ?? false),
  };
}

const COMA = ',';
function general(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toPrecision(10))).replace('.', COMA);
}

function agrupar(entero: string): string {
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Formatos que usa la hoja: #,##0 · "$ "#,##0 · 0.00% · 0 · 0000 · General. Separadores a la colombiana (1.234,5). */
export function formatoNumero(v: number, fmt?: string): string {
  if (!fmt || fmt === 'General') return general(v);
  const m = /^(?:"([^"]*)")?(#,##0|#,###|0+)(?:\.([0#]+))?(%)?(?:"([^"]*)")?$/.exec(fmt);
  if (!m) return general(v);
  const [, antes = '', nucleo, dec = '', porcentaje, despues = ''] = m;
  const x = porcentaje ? v * 100 : v;
  const d = dec.length;
  const redondeado = Math.round(Math.abs(x) * 10 ** d + 1e-9) / 10 ** d;
  const [ent, frac = ''] = redondeado.toFixed(d).split('.');
  const conGrupos = nucleo.includes(',');
  const entero = conGrupos ? agrupar(ent) : ent.padStart(nucleo.length, '0');
  const signo = x < 0 && redondeado !== 0 ? '-' : '';
  return signo + antes + entero + (d ? COMA + frac : '') + (porcentaje ? '%' : '') + despues;
}

function aTexto(valor: ExcelJS.CellValue, fmt: string | undefined): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number') return formatoNumero(valor, fmt);
  if (typeof valor === 'boolean') return valor ? 'VERDADERO' : 'FALSO';
  if (valor instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(valor.getUTCDate())}/${p(valor.getUTCMonth() + 1)}/${valor.getUTCFullYear()}`;
  }
  return '';
}

function tramosDeCelda(cell: ExcelJS.Cell): { tramos: Tramo[]; esNumero: boolean; esTexto: boolean } {
  const base = estiloDe(cell.font);
  const v = cell.value as ExcelJS.CellValue;
  if (v && typeof v === 'object' && 'richText' in v) {
    const tramos = v.richText.map((r) => ({ texto: r.text, est: estiloDe(r.font, base) }));
    return { tramos, esNumero: false, esTexto: true };
  }
  let valor: ExcelJS.CellValue = v;
  if (v && typeof v === 'object' && 'formula' in v) valor = (v.result ?? null) as ExcelJS.CellValue;
  else if (v && typeof v === 'object' && 'sharedFormula' in v) valor = (v.result ?? null) as ExcelJS.CellValue;
  else if (v && typeof v === 'object' && 'hyperlink' in v) valor = v.text as ExcelJS.CellValue;
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) valor = null;
  const texto = aTexto(valor, cell.numFmt);
  return {
    tramos: texto === '' ? [] : [{ texto, est: base }],
    esNumero: typeof valor === 'number',
    esTexto: typeof valor === 'string',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Fuentes empotradas y medida de texto
// ---------------------------------------------------------------------------------------------------------------

interface Fuentes {
  obtener(familia: Familia, negrita: boolean): PDFFont;
  limpiar(texto: string, familia: Familia, negrita: boolean): string;
  ancho(texto: string, est: Estilo, size?: number): number;
}

async function prepararFuentes(doc: PDFDocument): Promise<Fuentes> {
  doc.registerFontkit(fontkit);
  const fuentes = new Map<string, PDFFont>();
  const conjuntos = new Map<string, Set<number>>();
  for (const [clave, archivo] of Object.entries(ARCHIVOS_FUENTE)) {
    // Sin ligaduras ("ti", "fi"...): salían con un hueco y el texto copiado quedaba raro. Liberation va en subconjunto
    // (liviano); el subconjunto de Carlito que arma fontkit se dibuja con letras que faltan en pdf.js, así que Carlito
    // va completo (el PDF pesa ~0,7 MB).
    const f = await doc.embedFont(await leerFuente(archivo), {
      subset: clave.startsWith('sans'),
      features: { liga: false, clig: false, dlig: false, calt: false },
    });
    fuentes.set(clave, f);
    conjuntos.set(clave, new Set(f.getCharacterSet()));
  }
  const clave = (familia: Familia, negrita: boolean) => `${familia}-${negrita ? 'b' : 'n'}`;
  const obtener = (familia: Familia, negrita: boolean) => fuentes.get(clave(familia, negrita))!;
  const limpiar = (texto: string, familia: Familia, negrita: boolean) => {
    const set = conjuntos.get(clave(familia, negrita))!;
    let salida = '';
    for (const ch of texto.replace(/ /g, ' ').replace(/[​-‍⁠﻿]/g, '')) {
      const cp = ch.codePointAt(0)!;
      if (cp < 32) salida += ' ';
      else salida += set.has(cp) ? ch : '?';
    }
    return salida;
  };
  const ancho = (texto: string, est: Estilo, size = est.size) =>
    obtener(est.familia, est.negrita).widthOfTextAtSize(limpiar(texto, est.familia, est.negrita), size);
  return { obtener, limpiar, ancho };
}

// ---------------------------------------------------------------------------------------------------------------
// Reparto del texto en renglones
// ---------------------------------------------------------------------------------------------------------------

function nuevaLinea(): Linea {
  return { piezas: [], ancho: 0, alto: 0, size: 0, familia: 'carlito', finDeParrafo: false };
}

function cerrarLinea(l: Linea, finDeParrafo: boolean, sizePorDefecto: number, familiaPorDefecto: Familia): Linea {
  // quitar espacios al final (Excel no los cuenta al centrar ni al ajustar)
  while (l.piezas.length && l.piezas[l.piezas.length - 1].espacio) l.ancho -= l.piezas.pop()!.ancho;
  let size = 0;
  let familia = familiaPorDefecto;
  for (const p of l.piezas) {
    if (p.est.size > size) {
      size = p.est.size;
      familia = p.est.familia;
    }
  }
  if (!size) size = sizePorDefecto;
  l.size = size;
  l.familia = familia;
  l.alto = size * FACTOR_RENGLON;
  l.finDeParrafo = finDeParrafo;
  return l;
}

/** Parte los tramos en renglones. Sin `envolver` todo va en un renglón (los saltos de línea cuentan como espacio). */
function repartir(tramos: Tramo[], disponible: number, envolver: boolean, F: Fuentes, base: Estilo): Linea[] {
  const lineas: Linea[] = [];
  let actual = nuevaLinea();
  let pendientes: Pieza[] = [];
  let pendAncho = 0;
  let hayPalabra = false;
  const cerrar = (fin: boolean) => {
    lineas.push(cerrarLinea(actual, fin, base.size, base.familia));
    actual = nuevaLinea();
    pendientes = [];
    pendAncho = 0;
    hayPalabra = false;
  };
  const agregar = (p: Pieza) => {
    actual.piezas.push(p);
    actual.ancho += p.ancho;
  };
  const volcarPendientes = () => {
    for (const p of pendientes) agregar(p);
    pendientes = [];
    pendAncho = 0;
  };

  for (const t of tramos) {
    const tokens = t.texto.match(/\n|[^\S\n]+|[^\s]+/g) ?? [];
    for (const tok of tokens) {
      if (tok === '\n' && envolver) {
        cerrar(true);
        continue;
      }
      if (tok === '\n' || /^\s+$/.test(tok)) {
        // espacio (o salto en celda sin ajuste): se guarda y solo cuenta si luego viene una palabra
        const txt = tok === '\n' ? ' ' : tok;
        const continuacion = actual.piezas.length === 0 && pendientes.length === 0 && lineas.length > 0 && !lineas[lineas.length - 1].finDeParrafo;
        if (continuacion) continue; // los espacios de arranque de un renglón ajustado se descartan
        const ancho = F.ancho(txt, t.est);
        pendientes.push({ texto: txt, est: t.est, ancho, espacio: true });
        pendAncho += ancho;
        continue;
      }
      const w = F.ancho(tok, t.est);
      if (!envolver || !hayPalabra || actual.ancho + pendAncho + w <= disponible + 0.01) {
        if (envolver && !hayPalabra && w > disponible) {
          // palabra más larga que el renglón: se parte por letras
          volcarPendientes();
          let resto = tok;
          while (resto.length) {
            let n = 1;
            while (n < resto.length && F.ancho(resto.slice(0, n + 1), t.est) <= disponible) n++;
            const trozo = resto.slice(0, n);
            resto = resto.slice(n);
            agregar({ texto: trozo, est: t.est, ancho: F.ancho(trozo, t.est), espacio: false });
            hayPalabra = true;
            if (resto.length) cerrar(false);
          }
          continue;
        }
        volcarPendientes();
        agregar({ texto: tok, est: t.est, ancho: w, espacio: false });
        hayPalabra = true;
      } else {
        cerrar(false);
        agregar({ texto: tok, est: t.est, ancho: w, espacio: false });
        hayPalabra = true;
      }
    }
  }
  if (actual.piezas.length) cerrar(true);
  return lineas;
}

// ---------------------------------------------------------------------------------------------------------------
// Hoja: geometría, bordes e imágenes
// ---------------------------------------------------------------------------------------------------------------

function letraANumero(letras: string): number {
  let n = 0;
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function leerRango(rango: string): { c1: number; r1: number; c2: number; r2: number } {
  const m = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i.exec(rango.trim());
  if (!m) throw new Error('Rango inválido: ' + rango);
  return { c1: letraANumero(m[1]), r1: Number(m[2]), c2: letraANumero(m[3]), r2: Number(m[4]) };
}

type Borde = { ancho: number; color: Color; guiones?: number[] };
const PESO: Record<string, number> = { hair: 1, dotted: 2, dashDot: 2, dashDotDot: 2, dashed: 3, thin: 4, mediumDashDot: 5, mediumDashDotDot: 5, slantDashDot: 5, mediumDashed: 5, double: 6, medium: 7, thick: 8 };
function bordeDe(b: Partial<ExcelJS.Border> | undefined): { borde: Borde; peso: number } | null {
  if (!b?.style) return null;
  const estilo = b.style as string;
  const color = b.color ? colorDe(b.color) : NEGRO;
  const mapa: Record<string, Borde> = {
    hair: { ancho: 0.25, color, guiones: [1, 1] },
    dotted: { ancho: 0.75, color, guiones: [1, 1] },
    dashDot: { ancho: 0.75, color, guiones: [3, 1, 1, 1] },
    dashDotDot: { ancho: 0.75, color, guiones: [3, 1, 1, 1, 1, 1] },
    dashed: { ancho: 0.75, color, guiones: [3, 1] },
    thin: { ancho: 0.75, color },
    mediumDashed: { ancho: 1.5, color, guiones: [3, 1] },
    mediumDashDot: { ancho: 1.5, color, guiones: [3, 1, 1, 1] },
    mediumDashDotDot: { ancho: 1.5, color, guiones: [3, 1, 1, 1, 1, 1] },
    slantDashDot: { ancho: 1.5, color, guiones: [3, 1, 1, 1] },
    double: { ancho: 1.5, color },
    medium: { ancho: 1.5, color },
    thick: { ancho: 2.25, color },
  };
  const borde = mapa[estilo];
  return borde ? { borde, peso: PESO[estilo] ?? 4 } : null;
}

interface CeldaDibujo {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  tramos: Tramo[];
  esNumero: boolean;
  envolver: boolean;
  reducir: boolean;
  horizontal: 'left' | 'center' | 'right' | 'justify';
  vertical: 'top' | 'middle' | 'bottom';
  base: Estilo;
  lineas: Linea[];
}

interface Anclaje {
  nativeCol?: number;
  nativeRow?: number;
  nativeColOff?: number;
  nativeRowOff?: number;
  col?: number;
  row?: number;
}

const EMU_POR_PUNTO = 12700;

export async function dibujarHoja(ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook): Promise<Uint8Array> {
  // --- área de impresión
  const area = leerRango(String(ws.pageSetup.printArea ?? 'A1:N48').split('&&')[0]);
  const { c1: C1, r1: R1, c2: C2, r2: R2 } = area;

  // --- anchos de columna y alturas de fila (en puntos, antes de escalar)
  const ancho = new Map<number, number>();
  for (let c = C1; c <= C2; c++) {
    const col = ws.getColumn(c);
    const w = col.hidden ? 0 : (col.width ?? ws.properties.defaultColWidth ?? ANCHO_COLUMNA_POR_DEFECTO);
    ancho.set(c, Math.round(w * PX_POR_UNIDAD_DE_ANCHO) * 0.75);
  }
  const alto = new Map<number, number>();
  for (let r = R1; r <= R2; r++) {
    const row = ws.getRow(r);
    alto.set(r, row.hidden ? 0 : (row.height ?? ws.properties.defaultRowHeight ?? ALTO_FILA_POR_DEFECTO));
  }

  // --- celdas combinadas
  const combinadas = new Map<string, { r1: number; c1: number; r2: number; c2: number }>(); // "r,c" de la maestra
  const esclava = new Set<string>();
  for (const m of (ws.model.merges ?? []) as string[]) {
    const g = leerRango(m);
    combinadas.set(`${g.r1},${g.c1}`, { r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 });
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (r !== g.r1 || c !== g.c1) esclava.add(`${r},${c}`);
  }

  // --- documento y fuentes
  const doc = await PDFDocument.create();
  const F = await prepararFuentes(doc);

  // --- celdas con texto
  const celdas: CeldaDibujo[] = [];
  const conContenido = new Set<string>(); // para saber hasta dónde puede desbordar un texto
  for (let r = R1; r <= R2; r++) {
    for (let c = C1; c <= C2; c++) {
      const clave = `${r},${c}`;
      if (esclava.has(clave)) {
        conContenido.add(clave);
        continue;
      }
      const cell = ws.getCell(r, c);
      const { tramos, esNumero } = tramosDeCelda(cell);
      const m = combinadas.get(clave) ?? { r1: r, c1: c, r2: r, c2: c };
      if (!tramos.length || tramos.every((t) => t.texto.trim() === '')) continue;
      conContenido.add(clave);
      const al = cell.alignment ?? {};
      const horizontal = (al.horizontal === 'centerContinuous' ? 'center' : al.horizontal) as string | undefined;
      celdas.push({
        ...m,
        tramos,
        esNumero,
        envolver: !!al.wrapText,
        reducir: !!al.shrinkToFit,
        horizontal: horizontal === 'center' || horizontal === 'right' || horizontal === 'justify' ? horizontal : horizontal === 'left' ? 'left' : esNumero ? 'right' : 'left',
        vertical: al.vertical === 'top' || al.vertical === 'middle' || al.vertical === 'bottom' ? al.vertical : al.vertical === 'justify' || al.vertical === 'distributed' ? 'top' : 'bottom',
        base: estiloDe(cell.font),
        lineas: [],
      });
    }
  }

  const anchoDe = (c1: number, c2: number) => {
    let s = 0;
    for (let c = c1; c <= c2; c++) s += ancho.get(c) ?? 0;
    return s;
  };

  // --- renglones de cada celda con ajuste de texto, y filas que deben crecer para que no se corte nada
  const crecimiento = new Map<number, number>();
  for (const k of celdas) {
    const disponible = anchoDe(k.c1, k.c2) - 2 * RELLENO_HORIZONTAL;
    k.lineas = repartir(k.tramos, disponible, k.envolver, F, k.base);
    if (!k.envolver || k.lineas.length < 2) continue;
    const necesario = k.lineas.reduce((s, l) => s + l.alto, 0) + 2 * RELLENO_VERTICAL;
    let actual = 0;
    for (let r = k.r1; r <= k.r2; r++) actual += (alto.get(r) ?? 0) + (crecimiento.get(r) ?? 0);
    if (necesario > actual + TOLERANCIA) crecimiento.set(k.r2, (crecimiento.get(k.r2) ?? 0) + (necesario - actual));
  }
  for (const [r, extra] of crecimiento) alto.set(r, (alto.get(r) ?? 0) + extra);

  // --- posiciones acumuladas
  const x0 = new Map<number, number>();
  const y0 = new Map<number, number>();
  let acc = 0;
  for (let c = C1; c <= C2 + 1; c++) {
    x0.set(c, acc);
    acc += ancho.get(c) ?? 0;
  }
  const anchoTotal = x0.get(C2 + 1)!;
  acc = 0;
  for (let r = R1; r <= R2 + 1; r++) {
    y0.set(r, acc);
    acc += alto.get(r) ?? 0;
  }
  const altoTotal = y0.get(R2 + 1)!;

  // --- escala y posición en la página (como "ajustar a una página": solo se achica, nunca se agranda)
  const dispW = PAGINA_ANCHO - 2 * MARGEN;
  const dispH = PAGINA_ALTO - 2 * MARGEN;
  const esc = Math.min(1, dispW / anchoTotal, dispH / altoTotal);
  const desdeX = MARGEN + (dispW - anchoTotal * esc) / 2;
  const desdeY = MARGEN;
  const PX = (x: number) => desdeX + x * esc;
  const PY = (y: number) => PAGINA_ALTO - (desdeY + y * esc);

  const page = doc.addPage([PAGINA_ANCHO, PAGINA_ALTO]);

  // --- 1. rellenos
  for (let r = R1; r <= R2; r++) {
    for (let c = C1; c <= C2; c++) {
      if (esclava.has(`${r},${c}`)) continue;
      const cell = ws.getCell(r, c);
      const f = cell.fill as ExcelJS.FillPattern | undefined;
      if (f?.type !== 'pattern' || f.pattern !== 'solid') continue;
      const m = combinadas.get(`${r},${c}`) ?? { r1: r, c1: c, r2: r, c2: c };
      const color = colorDe(f.fgColor);
      if (color[0] === 1 && color[1] === 1 && color[2] === 1) continue; // blanco sobre papel blanco
      const xa = x0.get(m.c1)!;
      const xb = x0.get(m.c2 + 1)!;
      const ya = y0.get(m.r1)!;
      const yb = y0.get(m.r2 + 1)!;
      page.drawRectangle({ x: PX(xa), y: PY(yb), width: (xb - xa) * esc, height: (yb - ya) * esc, color: rgb(...color) });
    }
  }

  // --- 2. imágenes (logos), en su ancla de la hoja
  await dibujarImagenes(ws, wb, doc, page, { x0, y0, ancho, alto, C1, C2, R1, R2 }, PX, PY, esc);

  // --- 3. bordes
  dibujarBordes(ws, page, { x0, y0, C1, C2, R1, R2 }, combinadas, esclava, PX, PY, esc);

  // --- 4. textos
  for (const k of celdas) {
    const cx = x0.get(k.c1)!;
    const cw = anchoDe(k.c1, k.c2);
    const cy = y0.get(k.r1)!;
    const ch = y0.get(k.r2 + 1)! - cy;
    const lineas = k.lineas;
    if (!lineas.length) continue;
    let factor = 1;
    let sobrante = 0; // cuánto puede crecer el renglón hacia cada lado (texto que desborda sobre celdas vacías)

    if (!k.envolver) {
      const l = lineas[0];
      const disponible = cw - 2 * RELLENO_HORIZONTAL;
      if (l.ancho > disponible + TOLERANCIA) {
        const unaCelda = k.c1 === k.c2 && k.r1 === k.r2;
        const vacia = (c: number) => c >= C1 && c <= C2 && !conContenido.has(`${k.r1},${c}`);
        let derecha = 0;
        let izquierda = 0;
        if (unaCelda && !k.esNumero && !k.reducir) {
          for (let c = k.c2 + 1; vacia(c); c++) derecha += ancho.get(c) ?? 0;
          for (let c = k.c1 - 1; vacia(c); c--) izquierda += ancho.get(c) ?? 0;
        }
        sobrante = k.horizontal === 'center' ? Math.min(derecha, izquierda) * 2 : k.horizontal === 'right' ? izquierda : derecha;
        if (l.ancho > disponible + sobrante + TOLERANCIA) {
          const minimo = k.reducir ? TAMANO_MINIMO_AJUSTAR : TAMANO_MINIMO;
          const objetivo = (disponible + sobrante) / l.ancho;
          const tamMax = Math.max(...l.piezas.map((p) => p.est.size));
          factor = Math.max(objetivo, Math.min(1, minimo / tamMax));
          if (factor > 1) factor = 1;
        }
      }
    }

    // alto del bloque de texto
    const altoBloque = lineas.reduce((s, l) => s + l.alto * factor, 0);
    let yTop: number;
    if (k.vertical === 'top') yTop = cy + RELLENO_VERTICAL;
    else if (k.vertical === 'middle') yTop = cy + (ch - altoBloque) / 2;
    else yTop = cy + ch - RELLENO_VERTICAL - altoBloque;

    let yLinea = yTop;
    const disponibleH = cw - 2 * RELLENO_HORIZONTAL;
    for (const l of lineas) {
      const lAlto = l.alto * factor;
      const lAncho = l.ancho * factor;
      const mayus = ALTURA_MAYUSCULA[l.familia] * l.size * factor;
      const base = yLinea + lAlto / 2 + mayus / 2; // línea base (hacia abajo), mayúsculas centradas en el renglón
      let x: number;
      let extraEntrePalabras = 0;
      if (k.horizontal === 'center') x = cx + (cw - lAncho) / 2;
      else if (k.horizontal === 'right') x = cx + cw - RELLENO_HORIZONTAL - lAncho;
      else {
        x = cx + RELLENO_HORIZONTAL;
        if (k.horizontal === 'justify' && k.envolver && !l.finDeParrafo) {
          const huecos = l.piezas.filter((p) => p.espacio).length;
          if (huecos > 0 && lAncho < disponibleH) extraEntrePalabras = (disponibleH - lAncho) / huecos;
        }
      }
      dibujarLinea(page, F, l, x, base, factor, extraEntrePalabras, PX, PY, esc);
      yLinea += lAlto;
    }
  }

  doc.setTitle('Cuenta de cobro');
  doc.setCreator('Cuentas de cobro HOMO');
  doc.setProducer('Cuentas de cobro HOMO');
  return doc.save();
}

function dibujarLinea(
  page: PDFPage,
  F: Fuentes,
  l: Linea,
  xInicio: number,
  base: number,
  factor: number,
  extraEntrePalabras: number,
  PX: (x: number) => number,
  PY: (y: number) => number,
  esc: number,
) {
  let x = xInicio;
  const emitir = (texto: string, est: Estilo, ancho: number) => {
    const size = est.size * factor * esc;
    const font = F.obtener(est.familia, est.negrita);
    const limpio = F.limpiar(texto, est.familia, est.negrita);
    if (limpio.trim() !== '') {
      page.drawText(limpio, { x: PX(x), y: PY(base), size, font, color: rgb(...est.color) });
      if (est.subrayado) {
        const y = PY(base + est.size * factor * 0.13);
        page.drawLine({ start: { x: PX(x), y }, end: { x: PX(x + ancho), y }, thickness: Math.max(0.3, est.size * factor * 0.065 * esc), color: rgb(...est.color) });
      }
    }
    x += ancho;
  };

  if (extraEntrePalabras > 0) {
    // texto justificado: cada palabra va suelta y se reparte el espacio sobrante entre las palabras
    for (const p of l.piezas) {
      if (p.espacio) x += p.ancho * factor + extraEntrePalabras;
      else emitir(p.texto, p.est, p.ancho * factor);
    }
    return;
  }
  // se agrupan las piezas seguidas del mismo estilo para que el texto quede completo en el PDF
  let grupo = '';
  let grupoAncho = 0;
  let grupoEst: Estilo | null = null;
  const volcar = () => {
    if (grupoEst && grupo) emitir(grupo, grupoEst, grupoAncho);
    grupo = '';
    grupoAncho = 0;
  };
  for (const p of l.piezas) {
    if (grupoEst !== p.est) {
      volcar();
      grupoEst = p.est;
    }
    grupo += p.texto;
    grupoAncho += p.ancho * factor;
  }
  volcar();
}

interface Geometria {
  x0: Map<number, number>;
  y0: Map<number, number>;
  C1: number;
  C2: number;
  R1: number;
  R2: number;
}

function dibujarBordes(
  ws: ExcelJS.Worksheet,
  page: PDFPage,
  g: Geometria,
  combinadas: Map<string, { r1: number; c1: number; r2: number; c2: number }>,
  esclava: Set<string>,
  PX: (x: number) => number,
  PY: (y: number) => number,
  esc: number,
) {
  const { C1, C2, R1, R2 } = g;
  // a qué combinación pertenece cada celda (para no dibujar bordes por dentro de una combinada)
  const pertenece = new Map<string, string>();
  for (const [k, m] of combinadas) {
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) pertenece.set(`${r},${c}`, k);
  }
  void esclava;

  type Arista = { borde: Borde; peso: number } | null;
  const elegir = (a: Arista, b: Arista): Arista => (a && b ? (b.peso > a.peso ? b : a) : (a ?? b));
  const bordesDe = (r: number, c: number) => {
    const b = ws.getCell(r, c).border ?? {};
    return { top: bordeDe(b.top), bottom: bordeDe(b.bottom), left: bordeDe(b.left), right: bordeDe(b.right) };
  };
  const cache = new Map<string, ReturnType<typeof bordesDe>>();
  const get = (r: number, c: number) => {
    const k = `${r},${c}`;
    let v = cache.get(k);
    if (!v) {
      v = bordesDe(r, c);
      cache.set(k, v);
    }
    return v;
  };
  const mismaCombinada = (r1: number, c1: number, r2: number, c2: number) => {
    const a = pertenece.get(`${r1},${c1}`);
    return !!a && a === pertenece.get(`${r2},${c2}`);
  };

  // horizontales: borde i está sobre la fila i (i = R1 .. R2+1); verticales: borde j a la izquierda de la columna j
  const horiz = new Map<number, Arista[]>();
  const vert = new Map<number, Arista[]>();
  for (let i = R1; i <= R2 + 1; i++) {
    const fila: Arista[] = [];
    for (let c = C1; c <= C2; c++) {
      let a: Arista = null;
      if (i > R1 && i <= R2 && mismaCombinada(i - 1, c, i, c)) a = null;
      else a = elegir(i > R1 ? get(i - 1, c).bottom : null, i <= R2 ? get(i, c).top : null);
      fila.push(a);
    }
    horiz.set(i, fila);
  }
  for (let j = C1; j <= C2 + 1; j++) {
    const col: Arista[] = [];
    for (let r = R1; r <= R2; r++) {
      let a: Arista = null;
      if (j > C1 && j <= C2 && mismaCombinada(r, j - 1, r, j)) a = null;
      else a = elegir(j > C1 ? get(r, j - 1).right : null, j <= C2 ? get(r, j).left : null);
      col.push(a);
    }
    vert.set(j, col);
  }

  const mismo = (a: Arista, b: Arista) => !!a && !!b && a.borde.ancho === b.borde.ancho && a.borde.color.join() === b.borde.color.join() && String(a.borde.guiones) === String(b.borde.guiones);
  const trazo = (a: NonNullable<Arista>, xa: number, ya: number, xb: number, yb: number) => {
    const w = Math.max(0.3, a.borde.ancho * esc);
    page.drawLine({
      start: { x: xa, y: ya },
      end: { x: xb, y: yb },
      thickness: w,
      color: rgb(...a.borde.color),
      lineCap: a.borde.guiones ? LineCapStyle.Butt : LineCapStyle.Projecting,
      dashArray: a.borde.guiones?.map((d) => d * w),
    });
  };

  for (const [i, fila] of horiz) {
    let c = 0;
    while (c < fila.length) {
      const a = fila[c];
      if (!a) {
        c++;
        continue;
      }
      let e = c;
      while (e + 1 < fila.length && mismo(a, fila[e + 1])) e++;
      const y = PY(g.y0.get(i)!);
      trazo(a, PX(g.x0.get(C1 + c)!), y, PX(g.x0.get(C1 + e + 1)!), y);
      c = e + 1;
    }
  }
  for (const [j, col] of vert) {
    let r = 0;
    while (r < col.length) {
      const a = col[r];
      if (!a) {
        r++;
        continue;
      }
      let e = r;
      while (e + 1 < col.length && mismo(a, col[e + 1])) e++;
      const x = PX(g.x0.get(j)!);
      trazo(a, x, PY(g.y0.get(R1 + r)!), x, PY(g.y0.get(R1 + e + 1)!));
      r = e + 1;
    }
  }
}

async function dibujarImagenes(
  ws: ExcelJS.Worksheet,
  wb: ExcelJS.Workbook,
  doc: PDFDocument,
  page: PDFPage,
  g: { x0: Map<number, number>; y0: Map<number, number>; ancho: Map<number, number>; alto: Map<number, number>; C1: number; C2: number; R1: number; R2: number },
  PX: (x: number) => number,
  PY: (y: number) => number,
  esc: number,
) {
  const media = (wb.model as unknown as { media?: { type: string; extension: string; buffer: Buffer }[] }).media ?? [];
  const colEnHoja = (a: Anclaje): number => (a.nativeCol ?? Math.floor(a.col ?? 0)) + 1;
  const filaEnHoja = (a: Anclaje): number => (a.nativeRow ?? Math.floor(a.row ?? 0)) + 1;
  const posX = (a: Anclaje) => {
    const c = colEnHoja(a);
    const off = a.nativeColOff ?? ((a.col ?? 0) - Math.floor(a.col ?? 0)) * (g.ancho.get(c) ?? 0) * EMU_POR_PUNTO;
    return (g.x0.get(Math.min(Math.max(c, g.C1), g.C2 + 1)) ?? 0) + off / EMU_POR_PUNTO;
  };
  const posY = (a: Anclaje) => {
    const r = filaEnHoja(a);
    const off = a.nativeRowOff ?? ((a.row ?? 0) - Math.floor(a.row ?? 0)) * (g.alto.get(r) ?? 0) * EMU_POR_PUNTO;
    return (g.y0.get(Math.min(Math.max(r, g.R1), g.R2 + 1)) ?? 0) + off / EMU_POR_PUNTO;
  };
  const cache = new Map<number, PDFImage>();
  for (const im of ws.getImages()) {
    const med = media[Number(im.imageId)];
    if (!med?.buffer) continue;
    let img = cache.get(Number(im.imageId));
    if (!img) {
      img = /jpe?g/i.test(med.extension) ? await doc.embedJpg(med.buffer) : await doc.embedPng(med.buffer);
      cache.set(Number(im.imageId), img);
    }
    const rango = im.range as unknown as { tl: Anclaje; br?: Anclaje; ext?: { width: number; height: number } };
    const xa = posX(rango.tl);
    const ya = posY(rango.tl);
    let xb: number;
    let yb: number;
    if (rango.br) {
      xb = posX(rango.br);
      yb = posY(rango.br);
    } else if (rango.ext) {
      xb = xa + rango.ext.width * 0.75;
      yb = ya + rango.ext.height * 0.75;
    } else continue;
    page.drawImage(img, { x: PX(xa), y: PY(yb), width: (xb - xa) * esc, height: (yb - ya) * esc });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------------------------------------------

/** La cuenta de cobro como PDF de una sola página carta, lista para imprimir. Mismos datos que generarFacturaXlsx. */
export async function generarFacturaPdf(d: DatosFactura): Promise<Buffer> {
  const xlsx = await generarFacturaXlsx(d);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet('FACTURA');
  if (!ws) throw new Error('La plantilla no tiene la hoja FACTURA');
  const bytes = await dibujarHoja(ws, wb);
  return Buffer.from(bytes);
}

/** Igual que el nombre del .xlsx pero terminado en .pdf. */
export function nombreArchivoFacturaPdf(docNum: string, nombre: string): string {
  return nombreArchivoFactura(docNum, nombre).replace(/\.xlsx$/i, '.pdf');
}
