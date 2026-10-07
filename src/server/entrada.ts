// Limpieza de lo que escribe o corrige la contratista (port de numero_, monto_, limpiarDatos_,
// limpiarAdicionales_, limpiarDiasManual_, fechaValida_ y mesValido_ del legacy Code.gs).

import { parseMonth, parseYMD } from '../lib/calc';
import { ErrorAmable } from './errores';

export type DatosPlanilla = {
  numero: string;
  periodo: string;
  salud: number | null;
  pension: number | null;
  arl: number | null;
};

export type AdicionalPedido = { numero: string; mesCotizado: string; valor: number | null; tempId: string };
export type DiasManualPedido = { dias: string; motivo: string };
export type Extras = { adicionales: AdicionalPedido[]; diasManual: DiasManualPedido | null };

/** Texto sin tildes, en minúscula, sin espacios repetidos (para comparar nombres). */
export function normTxt(s: unknown): string {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Monto en pesos escrito por una persona: "358.700", "$ 358,700", 358700 -> 358700; null si no es un número. */
export function monto(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.round(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[$\s]/g, '');
  if (!s) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  if (/^\d{1,3}([.,]\d{3})+[.,]\d{1,2}$/.test(s)) return Number(s.replace(/[.,]\d{1,2}$/, '').replace(/[.,]/g, ''));
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d+[.,]\d{1,2}$/.test(s)) return Math.round(Number(s.replace(',', '.')));
  return null;
}

function texto(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Datos de la planilla principal, limpios. */
export function limpiarDatos(d: unknown): DatosPlanilla {
  const o = objeto(d);
  const numero = texto(o.numero).replace(/\s/g, '');
  let periodo = texto(o.periodo).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) periodo = '';
  return { numero, periodo, salud: monto(o.salud), pension: monto(o.pension), arl: monto(o.arl) };
}

/** Planillas adicionales que manda el navegador: se descartan las vacías. */
export function limpiarAdicionales(lista: unknown): AdicionalPedido[] {
  const res: AdicionalPedido[] = [];
  if (!Array.isArray(lista)) return res;
  for (let i = 0; i < lista.length && res.length < 8; i++) {
    const a = objeto(lista[i]);
    const numero = texto(a.numero).replace(/\s/g, '');
    const valor = monto(a.valor);
    let per = texto(a.periodo || a.mesCotizado).trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(per)) per = '';
    if (!numero && valor === null) continue;
    res.push({ numero, mesCotizado: per, valor, tempId: texto(a.tempId) });
  }
  return res;
}

/** Días a cobrar a mano: { dias, motivo } o null si no se usó. */
export function limpiarDiasManual(d: unknown): DiasManualPedido | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  const dias = texto(o.dias).trim();
  const motivo = texto(o.motivo).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (dias === '' && motivo === '') return null;
  return { dias, motivo };
}

export function extrasDePedido(p: { adicionales?: unknown; diasManual?: unknown }): Extras {
  return { adicionales: limpiarAdicionales(p.adicionales), diasManual: limpiarDiasManual(p.diasManual) };
}

/** Mensajes de las fechas del contrato (los usan el panel de admin y "mi contrato" de la contratista). */
export const MENSAJE_FECHA_CONTRATO = {
  inicio: 'La fecha de inicio no es válida. Usa el formato AAAA-MM-DD.',
  fin: 'La fecha de fin no es válida. Usa el formato AAAA-MM-DD.',
} as const;
export const MENSAJE_FIN_ANTES_DE_INICIO = 'La fecha de fin no puede ser antes de la fecha de inicio.';

export function fechaValida(s: unknown): string {
  const t = texto(s).trim();
  return parseYMD(t) ? t : '';
}

export function mesValido(mes: unknown): string {
  const t = texto(mes).trim();
  if (!parseMonth(t)) throw new ErrorAmable('Escoge el mes a cobrar.');
  return t;
}

/** Texto de un campo JSON que llega como string (multipart); si no es JSON válido devuelve undefined. */
export function jsonSeguro(s: unknown): unknown {
  if (typeof s !== 'string' || !s.trim()) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
