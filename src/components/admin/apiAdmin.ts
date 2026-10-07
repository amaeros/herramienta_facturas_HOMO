/**
 * Cliente tipado del panel del supervisor. Refleja docs/ADMIN.md.
 * Todas las rutas /api/admin/** responden `{ok:true, ...}` o `{ok:false, error}`.
 * Cualquier 401 (menos el del login) avisa a la pantalla para volver al formulario de contraseña.
 */

import type { EstadoCarga } from "../tipos";

export const MSG_SIN_CONEXION =
  "No pudimos conectarnos. Revisa el internet e intenta de nuevo.";
export const MSG_SESION_ADMIN_VENCIDA = "Tu sesión de administrador venció. Escribe la contraseña de nuevo.";
export const MSG_GENERICO = "No pudimos completar la acción. Intenta de nuevo.";

/** Error de la API con mensaje ya listo para mostrarle a Jacobo. */
export class AdminError extends Error {
  readonly status: number;
  /** Errores por campo del formulario ({ nombre: "mensaje" }) cuando el servidor los manda. */
  readonly campos?: Record<string, string>;
  constructor(mensaje: string, status: number, campos?: Record<string, string>) {
    super(mensaje);
    this.name = "AdminError";
    this.status = status;
    this.campos = campos;
  }
}

export function textoError(e: unknown): string {
  return e instanceof AdminError ? e.message : MSG_SIN_CONEXION;
}

export function esVencida(e: unknown): boolean {
  return e instanceof AdminError && e.status === 401;
}

// --- aviso global de sesión vencida -------------------------------------------------------

type Oyente = () => void;
const oyentes = new Set<Oyente>();

/** El contenedor del panel se suscribe aquí para volver al login cuando cualquier llamada recibe 401. */
export function alVencerSesion(fn: Oyente): () => void {
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
}

// --- tipos ----------------------------------------------------------------------------------

export interface Contrato {
  id: number;
  nombre: string;
  cedula: string;
  direccion: string;
  telefono: string;
  ciudad: string;
  correo: string;
  numeroContrato: string;
  objeto: string;
  cargo: string;
  linea: string;
  inicio: string | null;
  fin: string | null;
  honorario: number | null;
  valorTotal: number | null;
  riesgo: string;
  riesgoNuevo: string;
  riesgoDesde: string | null;
  revisoNombre: string;
  revisoCargo: string;
  activo: boolean;
  /** Cuántas cuentas (cargas) tiene enviadas. */
  cargas: number;
}

/** Lo que se envía al crear o editar (sin id ni n.º de cuentas). */
export type ContratoPayload = Omit<Contrato, "id" | "cargas">;

export interface AdicionalAdmin {
  numero: string;
  mes: string;
  valor: number;
  /** Si se subió el archivo de esta planilla (se ve con ?n=posición+1). */
  tieneArchivo: boolean;
}

export interface Carga {
  id: number;
  contratoId: number;
  nombre: string;
  mes: string;
  estado: EstadoCarga;
  emoji: string;
  mensaje: string;
  docNum: number | null;
  dias: number | null;
  valor: number | null;
  acumulado: number | null;
  /** Fracción 0..1 (acumulado / valor total del contrato). */
  pct: number | null;
  ssEsperada: number | null;
  ssDeclarada: number | null;
  planillaNumero: string;
  planillaMes: string;
  /** Si hay archivo de la planilla principal. */
  tienePlanilla: boolean;
  adicionales: AdicionalAdmin[];
  lectura: string;
  aprobado: boolean;
  observacion: string;
  actualizado: string;
}

export interface Faltante {
  contratoId: number;
  nombre: string;
}

export interface Parametros {
  pctIbc: number;
  salud: number;
  pension: number;
  smmlv: number;
  ibcPisoMult: number;
  ibcTechoMult: number;
  arl: Record<string, number>;
  enviarCorreo: boolean;
  correoSupervisor: string;
  toleranciaSs: number;
}

export interface CambioImportacion {
  campo: string;
  etiqueta?: string;
  antes: unknown;
  despues: unknown;
}

export interface ResumenImportacion {
  crear: { nombre: string; cedulaFinal4: string }[];
  actualizar: { id: number; nombre: string; cambios: CambioImportacion[] }[];
  sinCambios: number;
  errores: { fila: number; mensaje: string }[];
}

// --- llamadas -------------------------------------------------------------------------------

const TIMEOUT_MS = 60_000;

interface Opciones {
  /** En el login un 401 significa "contraseña incorrecta", no "sesión vencida". */
  sinAvisoDeVencida?: boolean;
}

async function llamarAdmin<T>(url: string, init: RequestInit = {}, op: Opciones = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctl.signal, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new AdminError(MSG_SIN_CONEXION, 0);
  } finally {
    clearTimeout(timer);
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* no era JSON (por ejemplo, un error de la plataforma) */
  }
  const obj = data && typeof data === "object" ? (data as { ok?: boolean; error?: string; campos?: unknown }) : null;

  if (res.status === 401 && !op.sinAvisoDeVencida) {
    oyentes.forEach((fn) => fn());
    throw new AdminError(MSG_SESION_ADMIN_VENCIDA, 401);
  }
  if (res.status === 413) throw new AdminError("El archivo pesa demasiado (máximo 1 MB).", 413);
  if (!obj) throw new AdminError(MSG_GENERICO, res.status);
  if (obj.ok === false || !res.ok) {
    throw new AdminError(
      typeof obj.error === "string" && obj.error ? obj.error : MSG_GENERICO,
      res.status,
      camposDeError(obj.campos),
    );
  }
  return data as T;
}

function camposDeError(c: unknown): Record<string, string> | undefined {
  if (!c || typeof c !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

function enJson(metodo: string, cuerpo: unknown): RequestInit {
  return { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) };
}

// --- normalizadores (aceptan camelCase o snake_case por si el servidor manda uno u otro) ------

type Crudo = Record<string, unknown>;

function tomar(o: Crudo, camel: string): unknown {
  if (camel in o) return o[camel];
  const snake = camel.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
  return snake in o ? o[snake] : undefined;
}
const txt = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const numONull = (v: unknown): number | null => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const fechaONull = (v: unknown): string | null => (typeof v === "string" && v ? v.slice(0, 10) : null);

export function normalizarContrato(raw: Crudo): Contrato {
  const g = (k: string) => tomar(raw, k);
  return {
    id: Number(g("id")),
    nombre: txt(g("nombre")),
    cedula: txt(g("cedula")),
    direccion: txt(g("direccion")),
    telefono: txt(g("telefono")),
    ciudad: txt(g("ciudad")),
    correo: txt(g("correo")),
    numeroContrato: txt(g("numeroContrato")),
    objeto: txt(g("objeto")),
    cargo: txt(g("cargo")),
    linea: txt(g("linea")),
    inicio: fechaONull(g("inicio")),
    fin: fechaONull(g("fin")),
    honorario: numONull(g("honorario")),
    valorTotal: numONull(g("valorTotal")),
    riesgo: txt(g("riesgo")) || "I",
    riesgoNuevo: txt(g("riesgoNuevo")),
    riesgoDesde: fechaONull(g("riesgoDesde")),
    revisoNombre: txt(g("revisoNombre")),
    revisoCargo: txt(g("revisoCargo")),
    activo: g("activo") !== false,
    cargas: Number(g("cargas")) || 0,
  };
}

export function normalizarCarga(raw: Crudo): Carga {
  const g = (k: string) => tomar(raw, k);
  const est = txt(g("estado")).toUpperCase();
  const adic = Array.isArray(g("adicionales")) ? (g("adicionales") as Crudo[]) : [];
  return {
    id: Number(g("id")),
    contratoId: Number(g("contratoId")),
    nombre: txt(g("nombre")),
    mes: txt(g("mes")),
    estado: est === "OK" || est === "REVISAR" ? est : "ERROR",
    emoji: txt(g("emoji")),
    mensaje: txt(g("mensaje")),
    docNum: numONull(g("docNum")),
    dias: numONull(g("dias")),
    valor: numONull(g("valor")),
    acumulado: numONull(g("acumulado")),
    pct: numONull(g("pct")),
    ssEsperada: numONull(g("ssEsperada")),
    ssDeclarada: numONull(g("ssDeclarada")),
    planillaNumero: txt(g("planillaNumero")),
    planillaMes: txt(g("planillaMes")),
    tienePlanilla: g("tienePlanilla") !== false,
    adicionales: adic.map((a) => ({
      numero: txt(a.numero),
      mes: txt(a.mes),
      valor: Number(a.valor) || 0,
      tieneArchivo: a.tieneArchivo === true,
    })),
    lectura: txt(g("lectura")),
    aprobado: g("aprobado") === true,
    observacion: txt(g("observacion")),
    actualizado: txt(g("actualizado")),
  };
}

/** La spec dice "la fila": puede venir como `{ok, parametros:{...}}` o con los campos sueltos. */
export function extraerParametros(r: unknown): Parametros {
  const base = (r && typeof r === "object" ? (r as Crudo) : {}) as Crudo;
  const raw: Crudo = (base.parametros ?? base.parametro ?? base) as Crudo;
  const arlRaw = (tomar(raw, "arl") ?? {}) as Record<string, unknown>;
  const arl: Record<string, number> = {};
  for (const n of ["I", "II", "III", "IV", "V"]) arl[n] = Number(arlRaw[n]) || 0;
  return {
    pctIbc: Number(tomar(raw, "pctIbc")) || 0,
    salud: Number(tomar(raw, "salud")) || 0,
    pension: Number(tomar(raw, "pension")) || 0,
    smmlv: Number(tomar(raw, "smmlv")) || 0,
    ibcPisoMult: Number(tomar(raw, "ibcPisoMult")) || 0,
    ibcTechoMult: Number(tomar(raw, "ibcTechoMult")) || 0,
    arl,
    enviarCorreo: tomar(raw, "enviarCorreo") === true,
    correoSupervisor: txt(tomar(raw, "correoSupervisor")),
    toleranciaSs: Number(tomar(raw, "toleranciaSs")) || 0,
  };
}

// --- API ------------------------------------------------------------------------------------

export const apiAdmin = {
  /** Sin sesión devuelve false (no avisa de "vencida"). */
  async hayEntrada(): Promise<boolean> {
    try {
      await llamarAdmin<{ ok: true; admin: true }>("/api/admin/sesion", {}, { sinAvisoDeVencida: true });
      return true;
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) return false;
      throw e;
    }
  },

  async entrar(password: string): Promise<void> {
    await llamarAdmin("/api/admin/login", enJson("POST", { password }), { sinAvisoDeVencida: true });
  },

  async salir(): Promise<void> {
    await llamarAdmin("/api/admin/logout", { method: "POST" }, { sinAvisoDeVencida: true });
  },

  async contratos(): Promise<Contrato[]> {
    const r = await llamarAdmin<{ ok: true; contratos: Crudo[] }>("/api/admin/contratos");
    return (r.contratos || []).map(normalizarContrato);
  },

  async crearContrato(p: ContratoPayload): Promise<Contrato> {
    const r = await llamarAdmin<{ ok: true; contrato: Crudo }>("/api/admin/contratos", enJson("POST", p));
    return normalizarContrato(r.contrato);
  },

  async editarContrato(id: number, p: ContratoPayload): Promise<Contrato> {
    const r = await llamarAdmin<{ ok: true; contrato: Crudo }>(`/api/admin/contratos/${id}`, enJson("PUT", p));
    return normalizarContrato(r.contrato);
  },

  async borrarContrato(id: number, confirmar?: string): Promise<void> {
    await llamarAdmin(`/api/admin/contratos/${id}`, enJson("DELETE", confirmar ? { confirmar } : {}));
  },

  async importar(archivo: File, aplicar: boolean): Promise<ResumenImportacion> {
    const fd = new FormData();
    fd.append("archivo", archivo);
    fd.append("aplicar", aplicar ? "1" : "0");
    const r = await llamarAdmin<Partial<ResumenImportacion> & { ok: true }>("/api/admin/importar", { method: "POST", body: fd });
    return {
      crear: r.crear ?? [],
      actualizar: r.actualizar ?? [],
      sinCambios: r.sinCambios ?? 0,
      errores: r.errores ?? [],
    };
  },

  async cargas(mes: string): Promise<{ cargas: Carga[]; faltan: Faltante[] }> {
    const r = await llamarAdmin<{ ok: true; cargas: Crudo[]; faltan: Faltante[] }>(
      `/api/admin/cargas?mes=${encodeURIComponent(mes)}`,
    );
    return { cargas: (r.cargas || []).map(normalizarCarga), faltan: r.faltan || [] };
  },

  async actualizarCarga(id: number, cambios: { aprobado?: boolean; observacion?: string }): Promise<Carga> {
    const r = await llamarAdmin<{ ok: true; carga: Crudo }>(`/api/admin/cargas/${id}`, enJson("PATCH", cambios));
    return normalizarCarga(r.carga);
  },

  async parametros(): Promise<Parametros> {
    return extraerParametros(await llamarAdmin("/api/admin/parametros"));
  },

  async guardarParametros(p: Parametros): Promise<Parametros> {
    return extraerParametros(await llamarAdmin("/api/admin/parametros", enJson("PUT", p)));
  },
};

/** Enlaces (descarga/ver archivo): los abre el navegador con la cookie de admin. */
export const urlFactura = (cargaId: number) => `/api/factura/${cargaId}`;
export const urlPlanilla = (cargaId: number, n: number) => `/api/admin/planilla/${cargaId}?n=${n}`;
