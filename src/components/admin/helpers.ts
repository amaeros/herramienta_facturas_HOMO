/** Utilidades puras del panel del supervisor (formato, lectura de números, formularios). Sin React. */

import { dinero, labelMes, pad2 } from "../formato";
import type { CambioContrato, Contrato, ContratoPayload, Parametros } from "./apiAdmin";

// --- texto ----------------------------------------------------------------------------------

/** Minúsculas, sin tildes y con espacios simples: para buscar y comparar nombres. */
export function normalizarTexto(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** '1234567890' -> '…7890'. Nunca muestra la cédula completa. */
export function enmascararCedula(c: string | null | undefined): string {
  const d = String(c ?? "").replace(/\D/g, "");
  return d.length >= 4 ? "…" + d.slice(-4) : "—";
}

/** La vista previa de importación ya manda solo los 4 últimos: devolver siempre '…1234'. */
export function ultimos4(s: string | null | undefined): string {
  const d = String(s ?? "").replace(/\D/g, "");
  return d ? "…" + d.slice(-4) : "—";
}

// --- dinero y porcentajes -------------------------------------------------------------------

/** 7174000 -> '$ 7.174.000'; vacío -> '—'. */
export function pesos(n: number | null | undefined): string {
  return n === null || n === undefined || isNaN(Number(n)) ? "—" : "$ " + dinero(Math.round(Number(n)));
}

/** 7174000 -> '7.174.000'; vacío -> ''. */
export function puntos(n: number | null | undefined): string {
  return n === null || n === undefined || isNaN(Number(n)) ? "" : dinero(Math.round(Number(n)));
}

/** Entero escrito como '7.174.000', '$ 7.174.000' o '7174000'. null si no es un entero válido. */
export function parseEntero(s: string | number | null | undefined): number | null {
  const t = String(s ?? "").replace(/[$\s]/g, "");
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  return null;
}

/** Decimal escrito con coma o punto ('1,5', '25'). null si no es válido. */
export function parseDecimal(s: string | number | null | undefined): number | null {
  const t = String(s ?? "").replace(/\s/g, "");
  if (!/^\d+([.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(",", "."));
}

/** 0.125 -> '12,5'. */
export function fraccionAPorcentaje(f: number): string {
  const p = Math.round(f * 100 * 1e6) / 1e6;
  return String(p).replace(".", ",");
}

/** '12,5' (o '12.5 %') -> 0.125. null si no es un número. */
export function porcentajeAFraccion(s: string): number | null {
  const p = parseDecimal(String(s ?? "").replace("%", ""));
  return p === null ? null : Math.round((p / 100) * 1e8) / 1e8;
}

export function decimalATexto(n: number): string {
  return String(n).replace(".", ",");
}

export function fmtPct(f: number | null | undefined): string {
  return f === null || f === undefined || isNaN(Number(f)) ? "—" : fraccionAPorcentaje(f) + " %";
}

// --- meses ----------------------------------------------------------------------------------

/** Mes actual 'AAAA-MM' en hora de Bogotá. */
export function mesActualBogota(ahora: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit" })
    .formatToParts(ahora);
  const y = partes.find((p) => p.type === "year")?.value ?? "1970";
  const m = partes.find((p) => p.type === "month")?.value ?? "01";
  return y + "-" + m;
}

export function mesAnterior(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? y - 1 + "-12" : y + "-" + pad2(m - 1);
}

/** Mes que se está cobrando normalmente: el anterior al actual. */
export function mesPorDefecto(ahora: Date): string {
  return mesAnterior(mesActualBogota(ahora));
}

/** `n` meses hacia atrás desde `hasta` (incluido), del más nuevo al más viejo. */
export function ultimosMeses(hasta: string, n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  let k = hasta;
  for (let i = 0; i < n; i++) {
    out.push({ key: k, label: labelMes(k) });
    k = mesAnterior(k);
  }
  return out;
}

/** '2026-10-02T15:04:00Z' -> '02/10/2026, 10:04 a. m.' (hora de Bogotá). */
export function fmtFechaHora(iso: string | null | undefined): string {
  const d = new Date(String(iso ?? ""));
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });
}

// --- bitácora de cambios --------------------------------------------------------------------

/** '2026-10-07T15:04:00Z' -> '07/10/2026, 10:04 a. m.' (hora de Bogotá, año completo). */
export function fmtFechaHoraCambio(iso: string | null | undefined): string {
  const d = new Date(String(iso ?? ""));
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CO", {
    timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

const SIN_VALOR = "(vacío)";

/** Quién hizo el cambio, en palabras. */
export function textoAutorCambio(autor: string): string {
  return autor === "contratista" ? "La contratista" : "Supervisor";
}

/** 'Fecha de fin: de 30/09/2026 a 30/11/2026'. Si antes o después estaban vacíos, lo dice sin "de (vacío)". */
export function lineaCambio(c: Pick<CambioContrato, "etiqueta" | "antes" | "despues">): string {
  const antesVacio = !c.antes || c.antes === SIN_VALOR;
  const despuesVacio = !c.despues || c.despues === SIN_VALOR;
  if (antesVacio && despuesVacio) return `${c.etiqueta}: cambió`;
  if (antesVacio) return `${c.etiqueta}: ahora es ${c.despues}`;
  if (despuesVacio) return `${c.etiqueta}: se borró ${c.antes}`;
  return `${c.etiqueta}: de ${c.antes} a ${c.despues}`;
}

/** Cuántos de estos cambios los hizo la contratista. */
export function contarDeContratistas(lista: Pick<CambioContrato, "autor">[]): number {
  return lista.filter((c) => c.autor === "contratista").length;
}

export function etiquetaLectura(l: string): string {
  return l === "auto" ? "Leída automáticamente" : l === "corregido" ? "Leída y corregida a mano" : l === "manual" ? "Escrita a mano" : l || "—";
}

export function etiquetaEstado(estado: string): string {
  return estado === "OK" ? "Todo bien" : estado === "REVISAR" ? "Para revisar" : "Con error";
}

// --- trabajadoras: formulario ---------------------------------------------------------------

export const CAMPOS_TEXTO = [
  "nombre", "cedula", "direccion", "telefono", "ciudad", "correo",
  "numeroContrato", "objeto", "cargo", "linea",
  "inicio", "fin", "honorario", "valorTotal",
  "riesgo", "riesgoNuevo", "riesgoDesde",
  "revisoNombre", "revisoCargo",
] as const;
export type CampoForm = (typeof CAMPOS_TEXTO)[number];

export type FormContrato = Record<CampoForm, string> & { activo: boolean };
export type ErroresForm = Partial<Record<CampoForm, string>>;

export const NIVELES_RIESGO = ["I", "II", "III", "IV", "V"] as const;

export function formVacio(): FormContrato {
  return {
    nombre: "", cedula: "", direccion: "", telefono: "", ciudad: "", correo: "",
    numeroContrato: "", objeto: "", cargo: "", linea: "",
    inicio: "", fin: "", honorario: "", valorTotal: "",
    riesgo: "I", riesgoNuevo: "", riesgoDesde: "",
    revisoNombre: "", revisoCargo: "",
    activo: true,
  };
}

export function formDeContrato(c: Contrato): FormContrato {
  return {
    nombre: c.nombre, cedula: c.cedula, direccion: c.direccion, telefono: c.telefono, ciudad: c.ciudad,
    correo: c.correo, numeroContrato: c.numeroContrato, objeto: c.objeto, cargo: c.cargo, linea: c.linea,
    inicio: c.inicio ?? "", fin: c.fin ?? "",
    honorario: puntos(c.honorario), valorTotal: puntos(c.valorTotal),
    riesgo: c.riesgo || "I", riesgoNuevo: c.riesgoNuevo, riesgoDesde: c.riesgoDesde ?? "",
    revisoNombre: c.revisoNombre, revisoCargo: c.revisoCargo,
    activo: c.activo,
  };
}

/** Cédula como la guarda el servidor: sin puntos ni espacios. */
export function limpiarCedula(s: string): string {
  return String(s ?? "").replace(/[.\s]/g, "");
}

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mismas reglas que el servidor (docs/ADMIN.md), para avisar antes de enviar. */
export function validarForm(f: FormContrato): ErroresForm {
  const e: ErroresForm = {};
  if (!f.nombre.trim()) e.nombre = "Escribe el nombre completo.";

  const ced = limpiarCedula(f.cedula);
  if (!ced) e.cedula = "Escribe la cédula.";
  else if (!/^\d+$/.test(ced)) e.cedula = "La cédula solo lleva números.";
  else if (ced.length < 6 || ced.length > 10) e.cedula = "La cédula debe tener entre 6 y 10 números.";

  if (f.correo.trim() && !RE_CORREO.test(f.correo.trim())) e.correo = "Ese correo no parece válido. Ejemplo: nombre@correo.com";

  if (f.inicio && f.fin && f.fin < f.inicio) e.fin = "La fecha de fin no puede ser anterior a la de inicio.";

  let hono: number | null = null;
  if (f.honorario.trim()) {
    hono = parseEntero(f.honorario);
    if (hono === null || hono <= 0) e.honorario = "Escribe el honorario mensual en pesos. Ejemplo: 7.174.000";
  }
  if (f.valorTotal.trim()) {
    const vt = parseEntero(f.valorTotal);
    if (vt === null || vt <= 0) e.valorTotal = "Escribe el valor total del contrato en pesos. Ejemplo: 64.566.000";
    else if (hono !== null && hono > 0 && vt < hono) e.valorTotal = "El valor total no puede ser menor que el honorario mensual.";
  }

  if (f.riesgoNuevo) {
    if (!f.riesgoDesde) e.riesgoDesde = "Indica desde qué mes aplica el riesgo nuevo.";
    else if (!/^\d{4}-\d{2}-01$/.test(f.riesgoDesde)) e.riesgoDesde = "Debe ser el día 1 de un mes (por ejemplo, 01/06/2026).";
  }
  return e;
}

export function payloadDeForm(f: FormContrato): ContratoPayload {
  const t = (s: string) => s.trim();
  return {
    nombre: t(f.nombre),
    cedula: limpiarCedula(f.cedula),
    direccion: t(f.direccion),
    telefono: t(f.telefono),
    ciudad: t(f.ciudad),
    correo: t(f.correo),
    numeroContrato: t(f.numeroContrato),
    objeto: t(f.objeto),
    cargo: t(f.cargo),
    linea: t(f.linea),
    inicio: f.inicio || null,
    fin: f.fin || null,
    honorario: f.honorario.trim() ? parseEntero(f.honorario) : null,
    valorTotal: f.valorTotal.trim() ? parseEntero(f.valorTotal) : null,
    riesgo: f.riesgo || "I",
    riesgoNuevo: f.riesgoNuevo,
    riesgoDesde: f.riesgoNuevo ? f.riesgoDesde || null : null,
    revisoNombre: t(f.revisoNombre),
    revisoCargo: t(f.revisoCargo),
    activo: f.activo,
  };
}

/** Payload de un contrato existente (para activar/desactivar sin tocar lo demás). */
export function payloadDeContrato(c: Contrato, cambios: Partial<ContratoPayload> = {}): ContratoPayload {
  const resto: Partial<Contrato> = { ...c };
  delete resto.id;
  delete resto.cargas;
  return { ...(resto as ContratoPayload), ...cambios };
}

/** Errores por campo que manda el servidor ({ cedula: "mensaje" }) -> errores del formulario. Ignora campos que no existen. */
export function erroresDeCampos(campos: Record<string, string> | undefined): ErroresForm {
  const out: ErroresForm = {};
  for (const [k, v] of Object.entries(campos ?? {})) {
    if ((CAMPOS_TEXTO as readonly string[]).includes(k)) out[k as CampoForm] = v;
  }
  return out;
}

/** Último recurso: intenta saber a qué campo se refiere un mensaje de error suelto. */
export function campoDeMensaje(mensaje: string): CampoForm | null {
  const m = normalizarTexto(mensaje);
  if (/valor total/.test(m)) return "valorTotal";
  if (/honorario/.test(m)) return "honorario";
  if (/cedula/.test(m)) return "cedula";
  if (/correo|email/.test(m)) return "correo";
  if (/desde/.test(m) && /riesgo/.test(m)) return "riesgoDesde";
  if (/riesgo nuevo|nuevo riesgo/.test(m)) return "riesgoNuevo";
  if (/riesgo/.test(m)) return "riesgo";
  if (/\bfin\b|terminacion|finaliza/.test(m)) return "fin";
  if (/inicio/.test(m)) return "inicio";
  if (/nombre/.test(m)) return "nombre";
  if (/telefono/.test(m)) return "telefono";
  if (/direccion/.test(m)) return "direccion";
  if (/ciudad/.test(m)) return "ciudad";
  return null;
}

/** ¿Escribió el nombre completo para confirmar el borrado? (sin tildes, mayúsculas ni espacios repetidos) */
export function nombreCoincide(escrito: string, nombre: string): boolean {
  return normalizarTexto(escrito) !== "" && normalizarTexto(escrito) === normalizarTexto(nombre);
}

export function filtrarContratos(lista: Contrato[], busqueda: string): Contrato[] {
  const q = normalizarTexto(busqueda);
  if (!q) return lista;
  return lista.filter((c) => normalizarTexto([c.nombre, c.numeroContrato, c.cargo, c.linea].join(" ")).includes(q));
}

// --- importación ----------------------------------------------------------------------------

const ETIQUETAS_CAMPO: Record<string, string> = {
  nombre: "Nombre",
  numerocontrato: "N.º de contrato",
  honorario: "Honorario",
  riesgo: "Riesgo ARL",
  linea: "Línea de política pública",
};

export function etiquetaCampo(campo: string): string {
  const clave = campo.replace(/[_\s]/g, "").toLowerCase();
  return ETIQUETAS_CAMPO[clave] ?? campo;
}

export function valorCambio(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "(vacío)";
  const clave = campo.replace(/[_\s]/g, "").toLowerCase();
  if (clave === "honorario" && !isNaN(Number(v))) return pesos(Number(v));
  return String(v);
}

// --- parámetros -----------------------------------------------------------------------------

export type CampoParam =
  | "pctIbc" | "salud" | "pension" | "smmlv" | "ibcPisoMult" | "ibcTechoMult" | "toleranciaSs" | "correoSupervisor"
  | "arlI" | "arlII" | "arlIII" | "arlIV" | "arlV";

export interface FormParametros {
  pctIbc: string;
  salud: string;
  pension: string;
  smmlv: string;
  ibcPisoMult: string;
  ibcTechoMult: string;
  toleranciaSs: string;
  correoSupervisor: string;
  enviarCorreo: boolean;
  arl: Record<string, string>;
}
export type ErroresParam = Partial<Record<CampoParam, string>>;

export function formDeParametros(p: Parametros): FormParametros {
  const arl: Record<string, string> = {};
  for (const n of NIVELES_RIESGO) arl[n] = fraccionAPorcentaje(p.arl[n] ?? 0);
  return {
    pctIbc: fraccionAPorcentaje(p.pctIbc),
    salud: fraccionAPorcentaje(p.salud),
    pension: fraccionAPorcentaje(p.pension),
    smmlv: puntos(p.smmlv),
    ibcPisoMult: decimalATexto(p.ibcPisoMult),
    ibcTechoMult: decimalATexto(p.ibcTechoMult),
    toleranciaSs: puntos(p.toleranciaSs) || "0",
    correoSupervisor: p.correoSupervisor,
    enviarCorreo: p.enviarCorreo,
    arl,
  };
}

export function validarParametros(f: FormParametros): ErroresParam {
  const e: ErroresParam = {};
  const pct = (clave: "pctIbc" | "salud" | "pension", max: number, texto: string) => {
    const v = porcentajeAFraccion(f[clave]);
    if (v === null || v < 0 || v > max) e[clave] = texto;
  };
  const rango = "Escribe un porcentaje entre 0 y 100. Ejemplo: 12,5";
  pct("pctIbc", 1, rango);
  pct("salud", 1, rango);
  pct("pension", 1, rango);
  for (const n of NIVELES_RIESGO) {
    const v = porcentajeAFraccion(f.arl[n]);
    if (v === null || v < 0 || v > 0.2) e[("arl" + n) as CampoParam] = "Escribe un porcentaje entre 0 y 20. Ejemplo: 2,436";
  }
  const s = parseEntero(f.smmlv);
  if (s === null || s <= 0) e.smmlv = "Escribe el salario mínimo en pesos. Ejemplo: 1.750.905";
  const piso = parseDecimal(f.ibcPisoMult);
  if (piso === null || piso <= 0) e.ibcPisoMult = "Escribe un número mayor que 0. Ejemplo: 1";
  const techo = parseDecimal(f.ibcTechoMult);
  if (techo === null || techo <= 0) e.ibcTechoMult = "Escribe un número mayor que 0. Ejemplo: 25";
  else if (piso !== null && piso > 0 && techo < piso) e.ibcTechoMult = "La base máxima no puede ser menor que la mínima.";
  const tol = parseEntero(f.toleranciaSs);
  if (tol === null || tol < 0) e.toleranciaSs = "Escribe un valor en pesos, 0 o más. Ejemplo: 100";
  if (f.correoSupervisor.trim() && !RE_CORREO.test(f.correoSupervisor.trim())) e.correoSupervisor = "Ese correo no parece válido.";
  return e;
}

/** Errores por campo del servidor ('arl.I' -> 'arlI') -> errores de la pantalla de parámetros. */
export function erroresParamDeCampos(campos: Record<string, string> | undefined): ErroresParam {
  const validos = ["pctIbc", "salud", "pension", "smmlv", "ibcPisoMult", "ibcTechoMult", "toleranciaSs", "correoSupervisor"];
  const out: ErroresParam = {};
  for (const [k, v] of Object.entries(campos ?? {})) {
    const m = /^arl\.(I|II|III|IV|V)$/.exec(k);
    if (m) out[("arl" + m[1]) as CampoParam] = v;
    else if (validos.includes(k)) out[k as CampoParam] = v;
  }
  return out;
}

/** Convierte lo escrito de vuelta a fracciones. Conserva cualquier campo extra que tuviera `base`. */
export function payloadDeParametros(base: Parametros, f: FormParametros): Parametros {
  const arl: Record<string, number> = { ...base.arl };
  for (const n of NIVELES_RIESGO) arl[n] = porcentajeAFraccion(f.arl[n]) ?? 0;
  return {
    ...base,
    pctIbc: porcentajeAFraccion(f.pctIbc) ?? 0,
    salud: porcentajeAFraccion(f.salud) ?? 0,
    pension: porcentajeAFraccion(f.pension) ?? 0,
    smmlv: parseEntero(f.smmlv) ?? 0,
    ibcPisoMult: parseDecimal(f.ibcPisoMult) ?? 0,
    ibcTechoMult: parseDecimal(f.ibcTechoMult) ?? 0,
    arl,
    enviarCorreo: f.enviarCorreo,
    correoSupervisor: f.correoSupervisor.trim(),
    toleranciaSs: parseEntero(f.toleranciaSs) ?? 0,
  };
}
