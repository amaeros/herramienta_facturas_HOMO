/** Utilidades puras del formulario "Crea tu cuenta" (registro propio de la contratista). Sin React. */

import { soloNumero } from "./formato";

/** En el orden en que se ven en la pantalla. */
export const CAMPOS_REGISTRO = [
  "nombre", "cedula", "direccion", "telefono", "ciudad", "correo",
  "linea", "numeroContrato", "cargo", "objeto", "inicio", "fin", "honorario", "valorTotal", "riesgo",
  "revisoNombre", "revisoCargo",
] as const;
export type CampoRegistro = (typeof CAMPOS_REGISTRO)[number];

/** Lo que se escribe en el formulario: todo texto (el honorario como '4.009.000'). */
export type FormRegistro = Record<CampoRegistro, string>;
export type ErroresRegistro = Partial<Record<CampoRegistro, string>>;

export const REGISTRO_VACIO: FormRegistro = {
  nombre: "", cedula: "", direccion: "", telefono: "", ciudad: "", correo: "",
  linea: "", numeroContrato: "", cargo: "", objeto: "", inicio: "", fin: "", honorario: "", valorTotal: "", riesgo: "",
  revisoNombre: "", revisoCargo: "",
};

export const NIVELES_RIESGO = ["I", "II", "III", "IV", "V"] as const;

/** Cuánto puede medir cada texto (igual que el servidor). */
export const LARGO_MAXIMO_REGISTRO: Partial<Record<CampoRegistro, number>> = {
  nombre: 150, direccion: 150, ciudad: 80, cargo: 120, objeto: 1500, revisoNombre: 120, revisoCargo: 120,
  linea: 200, numeroContrato: 60, correo: 200,
};

/** Frase que sale cuando el campo obligatorio está vacío (la misma que manda el servidor). */
const PIDE: Record<Exclude<CampoRegistro, "correo">, string> = {
  nombre: "Escribe tu nombre completo.",
  cedula: "Escribe tu cédula (solo números).",
  direccion: "Escribe tu dirección.",
  telefono: "Escribe tu teléfono.",
  ciudad: "Escribe tu ciudad.",
  linea: "Escribe tu equipo o línea.",
  numeroContrato: "Escribe el número de tu contrato.",
  cargo: "Escribe tu cargo.",
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

/** Cédula como la guarda el servidor: sin puntos ni espacios. */
export function limpiarCedula(s: string): string {
  return String(s ?? "").replace(/[.\s]/g, "");
}

/** Los últimos 4 números de la cédula: el PIN para entrar. '' si todavía no hay 4. */
export function pinDeCedula(s: string): string {
  const d = limpiarCedula(s).replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : "";
}

/** Revisa lo que se puede revisar sin el servidor. El servidor repite y manda la última palabra (nombre y cédula repetidos). */
export function validarRegistro(form: FormRegistro): ErroresRegistro {
  const e: ErroresRegistro = {};
  const v = (k: CampoRegistro) => form[k].trim();

  for (const k of CAMPOS_REGISTRO) {
    if (k === "correo") continue;
    if (v(k) === "") e[k] = PIDE[k];
  }
  for (const [k, max] of Object.entries(LARGO_MAXIMO_REGISTRO) as Array<[CampoRegistro, number]>) {
    if (!e[k] && v(k).length > max) e[k] = `Es demasiado largo (máximo ${max} caracteres).`;
  }
  if (!e.cedula) {
    const c = limpiarCedula(v("cedula"));
    if (!/^\d+$/.test(c)) e.cedula = "La cédula solo lleva números.";
    else if (c.length < 6 || c.length > 10) e.cedula = "La cédula debe tener entre 6 y 10 números.";
  }
  if (!e.telefono) {
    const t = v("telefono");
    if (!/^[\d\s+]+$/.test(t) || !/^\d{7,15}$/.test(t.replace(/[\s+]/g, ""))) {
      e.telefono = "El teléfono solo lleva números, espacios o el signo +, entre 7 y 15 dígitos. Ejemplo: 300 123 4567";
    }
  }
  if (v("correo") !== "" && !RE_CORREO.test(v("correo"))) e.correo = "El correo no parece válido. Ejemplo: nombre@correo.com";
  if (!e.inicio && !e.fin && v("fin") < v("inicio")) e.fin = "La fecha de fin no puede ser antes de la fecha de inicio.";
  for (const k of ["honorario", "valorTotal"] as const) {
    if (e[k]) continue;
    const n = soloNumero(v(k));
    if (n === null || n <= 0) e[k] = "Escribe el valor en pesos. Ejemplo: 4.009.000";
  }
  if (!e.honorario && !e.valorTotal) {
    if ((soloNumero(v("valorTotal")) as number) < (soloNumero(v("honorario")) as number)) {
      e.valorTotal = "El valor total del contrato no puede ser menor que el honorario mensual.";
    }
  }
  if (!e.riesgo && !(NIVELES_RIESGO as readonly string[]).includes(v("riesgo"))) e.riesgo = PIDE.riesgo;
  return e;
}

/** Lo que se manda a POST /api/registro: todo recortado, la cédula solo con números y los montos como número. */
export function payloadDeRegistro(form: FormRegistro, trampa = ""): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const k of CAMPOS_REGISTRO) out[k] = form[k].trim();
  out.cedula = limpiarCedula(form.cedula);
  out.honorario = soloNumero(form.honorario.trim()) ?? form.honorario.trim();
  out.valorTotal = soloNumero(form.valorTotal.trim()) ?? form.valorTotal.trim();
  out.sitio_web = trampa;
  return out;
}

/** Errores por campo del servidor ({ cedula: "mensaje" }) a errores de la pantalla. Ignora campos que no existen. */
export function erroresDeRegistro(campos: Record<string, string> | undefined): ErroresRegistro {
  const out: ErroresRegistro = {};
  for (const [k, v] of Object.entries(campos ?? {})) {
    if ((CAMPOS_REGISTRO as readonly string[]).includes(k)) out[k as CampoRegistro] = v;
  }
  return out;
}

/** El primer campo con error, en el orden en que se ven en la pantalla. */
export function primerCampoConErrorRegistro(errores: ErroresRegistro): CampoRegistro | null {
  return CAMPOS_REGISTRO.find((k) => errores[k]) ?? null;
}
