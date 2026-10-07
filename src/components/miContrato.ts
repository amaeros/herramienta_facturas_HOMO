/** Utilidades puras de la pantalla "Mis datos del contrato" y de "Antes de empezar" (sin React). */

import { dinero, soloNumero } from "./formato";
import { NIVELES_RIESGO } from "./registro";
import type { DatosMiContrato } from "./tipos";

/** En el orden en que se ven en la pantalla. */
export const CAMPOS_MI_CONTRATO = [
  "direccion", "telefono", "ciudad", "correo",
  "cargo", "linea", "numeroContrato", "objeto", "inicio", "fin", "honorario", "riesgo", "valorTotal",
  "revisoNombre", "revisoCargo",
] as const;
export type CampoMiContrato = (typeof CAMPOS_MI_CONTRATO)[number];

/** Lo que se escribe en el formulario: todo texto (el honorario y el valor total como '44.099.000'). */
export type FormMiContrato = Record<CampoMiContrato, string>;
export type ErroresMiContrato = Partial<Record<CampoMiContrato, string>>;

export const MI_CONTRATO_VACIO: FormMiContrato = {
  direccion: "", telefono: "", ciudad: "", correo: "",
  cargo: "", linea: "", numeroContrato: "", objeto: "", inicio: "", fin: "", honorario: "", riesgo: "", valorTotal: "",
  revisoNombre: "", revisoCargo: "",
};

/** Los únicos campos que se pueden dejar vacíos. */
export const OPCIONALES: readonly CampoMiContrato[] = ["correo", "linea"];

/** Los que el supervisor mira con cuidado: si cambian, se le avisa a la contratista antes de guardar. */
export const CAMPOS_QUE_VE_EL_SUPERVISOR: readonly CampoMiContrato[] = ["honorario", "riesgo"];

/** Cuánto puede medir cada texto (igual que el servidor). */
export const LARGO_MAXIMO: Partial<Record<CampoMiContrato, number>> = {
  direccion: 150, ciudad: 80, cargo: 120, linea: 120, numeroContrato: 60, objeto: 1500,
  revisoNombre: 120, revisoCargo: 120, correo: 200,
};

const PIDE: Record<Exclude<CampoMiContrato, "correo" | "linea">, string> = {
  direccion: "Escribe tu dirección.",
  telefono: "Escribe tu teléfono.",
  ciudad: "Escribe tu ciudad.",
  cargo: "Escribe tu cargo.",
  numeroContrato: "Escribe el número de tu contrato.",
  objeto: "Escribe el objeto de tu contrato.",
  inicio: "Escribe la fecha de inicio de tu contrato.",
  fin: "Escribe la fecha de fin de tu contrato.",
  honorario: "Escribe tu honorario mensual.",
  valorTotal: "Escribe el valor total de tu contrato.",
  riesgo: "Escoge el riesgo ARL de tu planilla (I a V).",
  revisoNombre: "Escribe el nombre de quien revisa tu cuenta.",
  revisoCargo: "Escribe el cargo de quien revisa tu cuenta.",
};

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Los campos que son plata: se comparan y se revisan como número. */
const CAMPOS_DINERO: readonly CampoMiContrato[] = ["honorario", "valorTotal"];

/** Lo guardado en el servidor, listo para el formulario (el honorario y el valor total con puntos de miles). */
export function formDeDatos(d: DatosMiContrato): FormMiContrato {
  return {
    direccion: d.direccion, telefono: d.telefono, ciudad: d.ciudad, correo: d.correo,
    cargo: d.cargo, linea: d.linea, numeroContrato: d.numeroContrato, objeto: d.objeto, inicio: d.inicio, fin: d.fin,
    honorario: dinero(d.honorario),
    valorTotal: dinero(d.valorTotal),
    riesgo: d.riesgo,
    revisoNombre: d.revisoNombre, revisoCargo: d.revisoCargo,
  };
}

function igual(campo: CampoMiContrato, a: string, b: string): boolean {
  if (CAMPOS_DINERO.includes(campo)) {
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

/** true si cambió el honorario o el riesgo ARL: el supervisor verá ese cambio. */
export function cambiaAlgoQueVeElSupervisor(original: FormMiContrato, actual: FormMiContrato): boolean {
  return CAMPOS_QUE_VE_EL_SUPERVISOR.some((k) => !igual(k, original[k], actual[k]));
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
    if (OPCIONALES.includes(k)) continue;
    if (v(k) === "") e[k] = PIDE[k as keyof typeof PIDE];
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
  if (!e.honorario) {
    const n = soloNumero(v("honorario"));
    if (n === null || n <= 0) e.honorario = "Escribe el honorario en pesos. Ejemplo: 4.009.000";
  }
  if (!e.valorTotal) {
    const n = soloNumero(v("valorTotal"));
    if (n === null || n <= 0) e.valorTotal = "Escribe el valor total en pesos. Ejemplo: 44.099.000";
  }
  if (!e.honorario && !e.valorTotal && (soloNumero(v("valorTotal")) as number) < (soloNumero(v("honorario")) as number)) {
    e.valorTotal = "El valor total del contrato no puede ser menor que el honorario mensual.";
  }
  if (!e.riesgo && !(NIVELES_RIESGO as readonly string[]).includes(v("riesgo"))) e.riesgo = PIDE.riesgo;
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
