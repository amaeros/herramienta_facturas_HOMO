/** Utilidades puras de la pantalla "Mis datos del contrato" (sin React). */

import type { DatosMiContrato } from "./tipos";

export const CAMPOS_MI_CONTRATO = ["inicio", "fin", "revisoNombre", "revisoCargo"] as const;
export type CampoMiContrato = (typeof CAMPOS_MI_CONTRATO)[number];
export type ErroresMiContrato = Partial<Record<CampoMiContrato, string>>;

export const MI_CONTRATO_VACIO: DatosMiContrato = { inicio: "", fin: "", revisoNombre: "", revisoCargo: "" };

/** Solo los campos que cambiaron respecto a lo guardado (ignora espacios al inicio y al final). */
export function cambiosDeMiContrato(original: DatosMiContrato, actual: DatosMiContrato): Partial<DatosMiContrato> {
  const out: Partial<DatosMiContrato> = {};
  for (const k of CAMPOS_MI_CONTRATO) {
    const nuevo = actual[k].trim();
    if (nuevo !== original[k].trim()) out[k] = nuevo;
  }
  return out;
}

/** Errores por campo del servidor ({ fin: "mensaje" }) a errores de la pantalla. Ignora campos que no existen. */
export function erroresDeMiContrato(campos: Record<string, string> | undefined): ErroresMiContrato {
  const out: ErroresMiContrato = {};
  for (const [k, v] of Object.entries(campos ?? {})) {
    if ((CAMPOS_MI_CONTRATO as readonly string[]).includes(k)) out[k as CampoMiContrato] = v;
  }
  return out;
}

/** El primer campo con error, en el orden en que se ven en la pantalla. */
export function primerCampoConError(errores: ErroresMiContrato): CampoMiContrato | null {
  return CAMPOS_MI_CONTRATO.find((k) => errores[k]) ?? null;
}
