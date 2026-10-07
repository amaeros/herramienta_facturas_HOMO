/** Llamadas a la API con mensajes amables en español. La sesión viaja en la cookie (mismo origen). */

export const MSG_SIN_CONEXION =
  "No pudimos conectarnos. Revisa tu internet e intenta de nuevo. Si sigue igual, avisa a tu supervisor.";
export const MSG_SESION_VENCIDA = "Tu sesión venció. Vuelve a entrar.";

export class ApiError extends Error {
  readonly status: number;
  /** true si el mensaje viene del servidor (o es nuestro) y se le puede mostrar tal cual a la contratista */
  readonly amable: boolean;
  /** Errores por campo ({ fin: "mensaje" }) cuando el servidor los manda. */
  readonly campos?: Record<string, string>;
  constructor(mensaje: string, status: number, amable: boolean, campos?: Record<string, string>) {
    super(mensaje);
    this.name = "ApiError";
    this.status = status;
    this.amable = amable;
    this.campos = campos;
  }
}

export function esSesionVencida(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

export function mensajeDeError(e: unknown): string {
  if (e instanceof ApiError) return e.amable ? e.message : MSG_SIN_CONEXION;
  return MSG_SIN_CONEXION;
}

const TIMEOUT_MS = 90_000;

/** Llama a la API y devuelve el JSON `{ok:true, ...}`. Lanza ApiError en cualquier otro caso. */
export async function llamar<T>(url: string, init: RequestInit = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctl.signal, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(MSG_SIN_CONEXION, 0, true);
  } finally {
    clearTimeout(timer);
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta que no es JSON (por ejemplo, un error de la plataforma) */
  }
  const obj = data && typeof data === "object" ? (data as { ok?: boolean; error?: string; campos?: unknown }) : null;

  if (res.status === 401) {
    throw new ApiError((obj && obj.error) || MSG_SESION_VENCIDA, 401, true);
  }
  if (res.status === 413) {
    throw new ApiError("El archivo pesa demasiado. Sube un PDF más liviano o una foto.", 413, true);
  }
  if (!obj) {
    throw new ApiError("No pudimos completar la acción. Intenta de nuevo.", res.status, true);
  }
  if (obj.ok === false || !res.ok) {
    throw new ApiError(obj.error || "No pudimos completar la acción. Intenta de nuevo.", res.status, true, camposDeError(obj.campos));
  }
  return data as T;
}

function camposDeError(c: unknown): Record<string, string> | undefined {
  if (!c || typeof c !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

export function postJson<T>(url: string, cuerpo: unknown): Promise<T> {
  return llamar<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

export function putJson<T>(url: string, cuerpo: unknown): Promise<T> {
  return llamar<T>(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}
