/** Utilidades puras de la pantalla "Mis datos del contrato" y de "Antes de empezar" (sin React). */

import { dinero, soloNumero } from "./formato";
import type { DatosMiContrato } from "./tipos";

/** En el orden en que se ven en la pantalla. */
export const CAMPOS_MI_CONTRATO = [
  "direccion", "telefono", "ciudad", "correo",
  "cargo", "objeto", "inicio", "fin", "valorTotal",
  "revisoNombre", "revisoCargo",
] as const;
export type CampoMiContrato = (typeof CAMPOS_MI_CONTRATO)[number];

/** Lo que se escribe en el formulario: todo texto (el valor total como '44.099.000'). */
export type FormMiContrato = Record<CampoMiContrato, string>;
export type ErroresMiContrato = Partial<Record<CampoMiContrato, string>>;

export const MI_CONTRATO_VACIO: FormMiContrato = {
  direccion: "", telefono: "", ciudad: "", correo: "",
  cargo: "", objeto: "", inicio: "", fin: "", valorTotal: "",
  revisoNombre: "", revisoCargo: "",
};

/** El correo es el único campo opcional. */
export const OPCIONALES: readonly CampoMiContrato[] = ["correo"];

/** Cuánto puede medir cada texto (igual que el servidor). */
export const LARGO_MAXIMO: Partial<Record<CampoMiContrato, number>> = {
  direccion: 150, ciudad: 80, cargo: 120, objeto: 1500, revisoNombre: 120, revisoCargo: 120, correo: 200,
};

const PIDE: Record<Exclude<CampoMiContrato, "correo">, string> = {
  direccion: "Escribe tu dirección.",
  telefono: "Escribe tu teléfono.",
  ciudad: "Escribe tu ciudad.",
  cargo: "Escribe tu cargo.",
  objeto: "Escribe el objeto de tu contrato.",
  inicio: "Escribe la fecha de inicio de tu contrato.",
  fin: "Escribe la fecha de fin de tu contrato.",
  valorTotal: "Escribe el valor total de tu contrato.",
  revisoNombre: "Escribe el nombre de quien revisa tu cuenta.",
  revisoCargo: "Escribe el cargo de quien revisa tu cuenta.",
};

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lo guardado en el servidor, listo para el formulario (el valor total con puntos de miles). */
export function formDeDatos(d: DatosMiContrato): FormMiContrato {
  return {
    direccion: d.direccion, telefono: d.telefono, ciudad: d.ciudad, correo: d.correo,
    cargo: d.cargo, objeto: d.objeto, inicio: d.inicio, fin: d.fin,
    valorTotal: dinero(d.valorTotal),
    revisoNombre: d.revisoNombre, revisoCargo: d.revisoCargo,
  };
}

function igual(campo: CampoMiContrato, a: string, b: string): boolean {
  if (campo === "valorTotal") {
    const x = soloNumero(a);
    const y = soloNumero(b);
    if (x !== null && y !== null) return x === y;
  }
  return a.trim() === b.trim();
}

/** Solo los campos que cambiaron respecto a lo guardado (ignora espacios al inicio y al final). */
export function cambiosDeMiContrato(original: FormMiContrato, actual: FormMiContrato): Partial<FormMiContrato> {
  const out: Partial<FormMiContrato> = {};
  for (const k of CAMPOS_MI_CONTRATO) {
    if (!igual(k, original[k], actual[k])) out[k] = actual[k].trim();
  }
  return out;
}

/** Todos los campos, recortados: es lo que manda "Antes de empezar" (así el servidor revisa todo de una vez). */
export function formCompleto(actual: FormMiContrato): FormMiContrato {
  const out = { ...MI_CONTRATO_VACIO };
  for (const k of CAMPOS_MI_CONTRATO) out[k] = actual[k].trim();
  return out;
}

/** Escribe el valor con puntos de miles si se entiende ('44099000' -> '44.099.000'); si no, lo deja como está. */
export function formatearValorTotal(s: string): string {
  const n = soloNumero(s);
  return n === null || n <= 0 ? s : dinero(n);
}

/** Revisa lo que se puede revisar sin el servidor (lo obligatorio y los formatos). El servidor repite y manda la última palabra. */
export function validarMiContrato(form: FormMiContrato): ErroresMiContrato {
  const e: ErroresMiContrato = {};
  const v = (k: CampoMiContrato) => form[k].trim();

  for (const k of CAMPOS_MI_CONTRATO) {
    if (k === "correo") continue;
    if (v(k) === "") e[k] = PIDE[k];
  }
  for (const [k, max] of Object.entries(LARGO_MAXIMO) as Array<[CampoMiContrato, number]>) {
    if (!e[k] && v(k).length > max) e[k] = `Es demasiado largo (máximo ${max} caracteres).`;
  }
  if (!e.telefono) {
    const t = v("telefono");
    if (!/^[\d\s+]+$/.test(t) || !/^\d{7,15}$/.test(t.replace(/[\s+]/g, ""))) {
      e.telefono = "El teléfono solo lleva números, espacios o el signo +, entre 7 y 15 dígitos. Ejemplo: 300 123 4567";
    }
  }
  if (v("correo") !== "" && !RE_CORREO.test(v("correo"))) e.correo = "El correo no parece válido. Ejemplo: nombre@correo.com";
  if (!e.inicio && !e.fin && v("fin") < v("inicio")) e.fin = "La fecha de fin no puede ser antes de la fecha de inicio.";
  if (!e.valorTotal) {
    const n = soloNumero(v("valorTotal"));
    if (n === null || n <= 0) e.valorTotal = "Escribe el valor total en pesos. Ejemplo: 44.099.000";
  }
  return e;
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
