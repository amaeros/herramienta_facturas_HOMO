// Lector del Excel de control (importación de trabajadoras desde /admin). Lógica pura: recibe los bytes del .xlsx
// y devuelve filas limpias + errores por fila. No toca la base de datos ni guarda el archivo. Ver docs/ADMIN.md.
//
// Formato de referencia (hoja 1): encabezados en las primeras 10 filas con CEDULA y NOMBRE; además
// CONTRATO… (cualquier encabezado que empiece por "contrato"), HONORARIOS, RIESGO ARL y "Línea política pública".
// Las demás columnas (cálculos del mes) se ignoran. Los encabezados no distinguen tildes, mayúsculas ni espacios.

import ExcelJS from 'exceljs';
import { monto, normTxt } from './entrada';
import { ErrorAmable } from './errores';

export const MAX_BYTES_IMPORTAR = 1024 * 1024;
export const MAX_FILAS_IMPORTAR = 200;
const FILAS_BUSCAR_ENCABEZADO = 10;
const MAX_HONORARIO = 2_000_000_000;

export type FilaImportada = {
  /** Número de fila en el Excel (para los mensajes). */
  fila: number;
  /** Solo dígitos (6-10). Nunca sale de aquí hacia el navegador completa. */
  cedula: string;
  nombre: string;
  /** undefined = la columna no existe o la celda está vacía: no se cambia. */
  numeroContrato?: string;
  honorario?: number;
  riesgo?: string;
  linea?: string;
};

export type ErrorFila = { fila: number; mensaje: string };

export type ResultadoParseo = { filas: FilaImportada[]; errores: ErrorFila[]; filaEncabezados: number };

const ROMANOS = ['I', 'II', 'III', 'IV', 'V'];

// ------------------------------------------------------------------ utilidades de celdas
/** Encabezado comparable: sin tildes, en minúscula y sin espacios ni signos ("#Línea" -> "linea"). */
export function compactoEncabezado(v: unknown): string {
  return normTxt(valorCelda(v) ?? '').replace(/[^a-z0-9]+/g, '');
}

/** Valor de una celda de exceljs como texto o número (fórmulas -> su resultado; texto enriquecido -> texto plano). */
export function valorCelda(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  if (v instanceof Date) return null;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('');
    if ('result' in o) return valorCelda(o.result);
    if (typeof o.text === 'string') return o.text;
    if (o.text && typeof o.text === 'object') return valorCelda(o.text);
  }
  return null;
}

function textoLimpio(v: string | number | null): string {
  if (v === null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Cédula como número o texto con puntos/espacios -> solo dígitos (6 a 10). */
export function leerCedula(v: string | number | null): { ok: true; valor: string } | { ok: false; mensaje: string } {
  if (v === null || String(v).trim() === '') return { ok: false, mensaje: 'Falta la cédula.' };
  let s: string;
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) return { ok: false, mensaje: 'La cédula no es un número válido.' };
    s = String(v);
  } else {
    s = v.replace(/[\s.,]/g, '');
  }
  if (!/^\d{6,10}$/.test(s)) return { ok: false, mensaje: 'La cédula debe tener solo números (entre 6 y 10 dígitos).' };
  return { ok: true, valor: s };
}

/** Riesgo ARL: 1-5 o I-V ("III", "iii", "Riesgo 3", 3). */
export function leerRiesgo(v: string | number | null): { ok: true; valor: string } | { ok: false; mensaje: string } {
  const malo = { ok: false as const, mensaje: 'El riesgo ARL debe ser un número de 1 a 5 o I, II, III, IV, V.' };
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 5 ? { ok: true, valor: ROMANOS[v - 1] } : malo;
  const s = String(v ?? '')
    .toUpperCase()
    .replace(/RIESGO/g, '')
    .replace(/[\s.]/g, '');
  if (/^[1-5]$/.test(s)) return { ok: true, valor: ROMANOS[Number(s) - 1] };
  if (ROMANOS.includes(s)) return { ok: true, valor: s };
  return malo;
}

/** Honorario: número o texto ("$ 7.174.000"). */
export function leerHonorario(v: string | number | null): { ok: true; valor: number } | { ok: false; mensaje: string } {
  const n = monto(v);
  if (n === null || n <= 0 || n > MAX_HONORARIO) {
    return { ok: false, mensaje: 'El honorario debe ser un valor en pesos mayor que cero (por ejemplo 7.174.000).' };
  }
  return { ok: true, valor: n };
}

// ------------------------------------------------------------------ lectura del archivo
type Columnas = { cedula: number; nombre: number; contrato?: number; honorario?: number; riesgo?: number; linea?: number };

function primera(cols: Array<[number, string]>, ...preds: Array<(c: string) => boolean>): number | undefined {
  for (const p of preds) {
    const hit = cols.find(([, c]) => p(c));
    if (hit) return hit[0];
  }
  return undefined;
}

function detectarColumnas(cols: Array<[number, string]>): Columnas | null {
  const cedula = primera(cols, (c) => c === 'cedula', (c) => c.startsWith('cedula') || c === 'cc' || c === 'identificacion');
  const nombre = primera(cols, (c) => c === 'nombre', (c) => c.startsWith('nombre'));
  if (cedula === undefined || nombre === undefined) return null;
  return {
    cedula,
    nombre,
    contrato: primera(cols, (c) => c.startsWith('contrato')),
    honorario: primera(cols, (c) => c === 'honorarios' || c === 'honorario', (c) => c.startsWith('honorario')),
    riesgo: primera(cols, (c) => c.startsWith('riesgo')),
    // "#Línea" (solo un consecutivo) NO es esta columna: se exige "politica".
    linea: primera(cols, (c) => c.startsWith('linea') && c.includes('politica')),
  };
}

export async function parsearExcelControl(bytes: Uint8Array): Promise<ResultadoParseo> {
  if (!bytes || bytes.length === 0) throw new ErrorAmable('No recibimos el archivo. Vuelve a elegirlo.');
  if (bytes.length > MAX_BYTES_IMPORTAR) throw new ErrorAmable('El archivo pesa más de 1 MB. Sube solo la hoja de control.', 413);

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ExcelJS.Buffer);
  } catch {
    throw new ErrorAmable('No pudimos abrir el archivo. Tiene que ser un Excel .xlsx.', 415);
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ErrorAmable('El Excel no tiene hojas.');

  // --- encabezados: primera fila (de las 10 primeras) que tenga CEDULA y NOMBRE ---
  let columnas: Columnas | null = null;
  let filaEnc = 0;
  const tope = Math.min(FILAS_BUSCAR_ENCABEZADO, Math.max(ws.rowCount, 1));
  for (let r = 1; r <= tope && !columnas; r++) {
    const cols: Array<[number, string]> = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const c = compactoEncabezado(cell.value);
      if (c) cols.push([col, c]);
    });
    const d = detectarColumnas(cols);
    if (d) {
      columnas = d;
      filaEnc = r;
    }
  }
  if (!columnas) {
    throw new ErrorAmable(
      'No encontramos los encabezados CEDULA y NOMBRE en las primeras 10 filas de la primera hoja. Revisa que sea el Excel de control.',
    );
  }
  const k = columnas;

  const filas: FilaImportada[] = [];
  const errores: ErrorFila[] = [];
  const vistas = new Set<string>();
  let revisadas = 0;
  for (let r = filaEnc + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vCed = valorCelda(row.getCell(k.cedula).value);
    const vNom = valorCelda(row.getCell(k.nombre).value);
    const nombre = textoLimpio(vNom);
    if (textoLimpio(vCed) === '' && nombre === '') continue; // fila vacía o de totales sin identificar
    if (++revisadas > MAX_FILAS_IMPORTAR) {
      throw new ErrorAmable(`El archivo tiene más de ${MAX_FILAS_IMPORTAR} filas de trabajadoras. Divídelo en partes.`, 413);
    }

    const ced = leerCedula(vCed);
    if (!ced.ok) {
      errores.push({ fila: r, mensaje: ced.mensaje });
      continue;
    }
    if (!nombre) {
      errores.push({ fila: r, mensaje: 'Falta el nombre.' });
      continue;
    }
    if (vistas.has(ced.valor)) {
      errores.push({ fila: r, mensaje: 'Esta cédula está repetida en el archivo; se usa la primera fila.' });
      continue;
    }

    const f: FilaImportada = { fila: r, cedula: ced.valor, nombre };
    let falla = '';
    if (k.contrato !== undefined) {
      const t = textoLimpio(valorCelda(row.getCell(k.contrato).value));
      if (t) f.numeroContrato = t;
    }
    if (k.linea !== undefined) {
      const t = textoLimpio(valorCelda(row.getCell(k.linea).value));
      if (t) f.linea = t;
    }
    if (k.honorario !== undefined) {
      const v = valorCelda(row.getCell(k.honorario).value);
      if (v !== null && String(v).trim() !== '') {
        const h = leerHonorario(v);
        if (h.ok) f.honorario = h.valor;
        else falla = h.mensaje;
      }
    }
    if (!falla && k.riesgo !== undefined) {
      const v = valorCelda(row.getCell(k.riesgo).value);
      if (v !== null && String(v).trim() !== '') {
        const ri = leerRiesgo(v);
        if (ri.ok) f.riesgo = ri.valor;
        else falla = ri.mensaje;
      }
    }
    if (falla) {
      errores.push({ fila: r, mensaje: falla });
      continue;
    }
    vistas.add(ced.valor);
    filas.push(f);
  }
  return { filas, errores, filaEncabezados: filaEnc };
}
