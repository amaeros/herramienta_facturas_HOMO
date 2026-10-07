/**
 * Lo que la contratista elige cobrar en el paso 2: el mes completo o solo unos días (un rango dentro del mes).
 * Funciones puras, sin React. Las reglas (mes comercial de 30 días, valor, fechas) viven en src/lib/calc.ts.
 */
import { commercialDays, daysInMonth, parseMonth, parseYMD, periodValue } from "../lib/calc";
import { fmtFecha, labelMes } from "./formato";
import type { DiasManualPayload, MesInfo } from "./tipos";

export type OpcionPeriodo = "completo" | "dias";

/** Lo que la persona tiene marcado y escrito en "¿Qué vas a cobrar?". */
export interface EleccionPeriodo {
  opcion: OpcionPeriodo;
  /** AAAA-MM-DD */
  del: string;
  al: string;
  motivo: string;
}

export const MES_COMPLETO: EleccionPeriodo = { opcion: "completo", del: "", al: "", motivo: "" };

/** Al marcar "Solo unos días" las fechas arrancan en las del mes completo, para que el calendario abra en el mes correcto. */
export function eleccionSoloDias(mes: Pick<MesInfo, "inicio" | "corte">): EleccionPeriodo {
  return { opcion: "dias", del: mes.inicio, al: mes.corte, motivo: "" };
}

export interface VigenciaContrato {
  /** AAAA-MM-DD */
  inicio: string;
  fin: string;
  honorario: number;
}

export interface PeriodoElegido {
  /** AAAA-MM-DD */
  inicio: string;
  corte: string;
  dias: number;
  valor: number;
}

export interface PeriodoInvalido {
  error: string;
  /** a qué campo pertenece el error, para mostrarlo junto a él (si no, va debajo de los dos) */
  campo?: "del" | "al";
}

export function esError(r: PeriodoElegido | PeriodoInvalido): r is PeriodoInvalido {
  return "error" in r;
}

/** Primer y último día que se pueden elegir en "Del" y "Al": el mes, recortado a la vigencia del contrato. */
export function limitesDelMes(mesKey: string, contrato: Pick<VigenciaContrato, "inicio" | "fin">): { min: string; max: string } {
  const o = parseMonth(mesKey);
  if (!o) return { min: "", max: "" };
  const primero = mesKey + "-01";
  const ultimo = mesKey + "-" + String(daysInMonth(o.y, o.m)).padStart(2, "0");
  const min = contrato.inicio && contrato.inicio > primero ? contrato.inicio : primero;
  const max = contrato.fin && contrato.fin < ultimo ? contrato.fin : ultimo;
  return { min, max };
}

/**
 * El periodo que se cobraría con lo que eligió la persona.
 * - "completo": el periodo esperado del mes tal como lo trae el Resumen (ya cuenta inicio y fin del contrato).
 * - "dias": el rango Del / Al, que debe ser del mes, estar dentro del contrato y no ir al revés.
 */
export function periodoElegido(
  mes: Pick<MesInfo, "key" | "inicio" | "corte" | "dias" | "valor">,
  contrato: VigenciaContrato,
  opcion: OpcionPeriodo,
  del: string,
  al: string,
): PeriodoElegido | PeriodoInvalido {
  if (opcion === "completo") {
    return { inicio: mes.inicio, corte: mes.corte, dias: mes.dias, valor: mes.valor };
  }

  const nombreMes = labelMes(mes.key);
  if (!del) return { error: "Escoge desde qué día cobras.", campo: "del" };
  if (!al) return { error: "Escoge hasta qué día cobras.", campo: "al" };
  const fDel = parseYMD(del);
  const fAl = parseYMD(al);
  if (!fDel) return { error: "Esa fecha no es válida. Escógela del calendario.", campo: "del" };
  if (!fAl) return { error: "Esa fecha no es válida. Escógela del calendario.", campo: "al" };

  if (del.slice(0, 7) !== mes.key) return { error: "Escoge un día de " + nombreMes + ".", campo: "del" };
  if (al.slice(0, 7) !== mes.key) return { error: "Escoge un día de " + nombreMes + ".", campo: "al" };

  const vig = "Tu contrato va del " + fmtFecha(contrato.inicio) + " al " + fmtFecha(contrato.fin) + ".";
  if (contrato.inicio && del < contrato.inicio) return { error: "Ese día es antes de que empezara tu contrato. " + vig, campo: "del" };
  if (contrato.fin && del > contrato.fin) return { error: "Ese día es después de que terminara tu contrato. " + vig, campo: "del" };
  if (contrato.fin && al > contrato.fin) return { error: "Ese día es después de que terminara tu contrato. " + vig, campo: "al" };
  if (contrato.inicio && al < contrato.inicio) return { error: "Ese día es antes de que empezara tu contrato. " + vig, campo: "al" };

  if (al < del) return { error: "El último día no puede ser antes del primero. Cambia «Al» o «Del».", campo: "al" };

  const dias = commercialDays(del, al);
  if (dias === null || dias < 1) return { error: "No pudimos contar los días. Revisa las dos fechas.", campo: "al" };
  return { inicio: del, corte: al, dias, valor: periodValue(contrato.honorario, dias) };
}

/**
 * El motivo no tiene campo propio en la API: solo viaja dentro de `diasManual` ({ dias, motivo }).
 * Se manda únicamente cuando eligió "Solo unos días" con un rango válido y escribió un motivo; los días van
 * ya contados por la herramienta (los mismos del rango), nunca escritos a mano. Si no, null.
 */
export function diasManualDeMotivo(
  opcion: OpcionPeriodo,
  elegido: PeriodoElegido | PeriodoInvalido,
  motivo: string,
): DiasManualPayload | null {
  const m = motivo.replace(/\s+/g, " ").trim();
  if (opcion !== "dias" || !m || esError(elegido)) return null;
  if (!Number.isInteger(elegido.dias) || elegido.dias < 1 || elegido.dias > 30) return null;
  return { dias: String(elegido.dias), motivo: m };
}
