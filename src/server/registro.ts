// Registro propio de la contratista (POST /api/registro): crea una SOLICITUD (estado 'pendiente', activo = false) que el
// supervisor aprueba o rechaza desde /admin (ver src/server/solicitudes.ts). Hasta que la aprueba, no puede entrar.
// Defensas contra abuso: campo trampa `sitio_web`, tope de solicitudes pendientes y límite por IP (tabla intentos_pin).
// Nunca se dice si un nombre o una cédula existen más allá de los mensajes de "ya existe una cuenta". Ver docs/ARQUITECTURA.md.

import { count, eq, sql } from 'drizzle-orm';
import { validarContrato } from './admin';
import { registrarCambios } from './cambios';
import type { Db } from './db';
import { contratos, intentosPin } from './db/schema';
import { ErrorAmable, ErrorValidacion } from './errores';
import type { Deps } from './servicios';

export const MAX_SOLICITUDES_PENDIENTES = 30;
export const MAX_REGISTROS_POR_HORA = 5;
export const VENTANA_REGISTRO_MS = 60 * 60 * 1000;
/** Clave en `intentos_pin`: `__registro__:<ip>` (las de contratistas solo tienen a-z, 0-9 y '_', nunca ':'). */
export const PREFIJO_CLAVE_REGISTRO = '__registro__:';
/** Campo trampa: una persona no lo ve ni lo llena; un robot sí. */
export const CAMPO_TRAMPA = 'sitio_web';

export const MENSAJE_LIMITE_REGISTRO = 'Enviaste muchas solicitudes seguidas. Espera un rato e inténtalo de nuevo, o habla con tu supervisor.';
export const MENSAJE_TOPE_PENDIENTES = 'No se pueden recibir más solicitudes por ahora.';
const MSG_CEDULA_REPETIDA = 'Ya existe una cuenta con esa cédula. Si es tuya, habla con tu supervisor.';
const MSG_NOMBRE_REPETIDO = 'Ya existe una cuenta con ese nombre. Si es tuya, habla con tu supervisor.';

/** Los campos que manda quien se registra (los mismos del formulario del panel, sin activo ni estado). */
export const CAMPOS_REGISTRO = [
  'nombre',
  'cedula',
  'direccion',
  'telefono',
  'ciudad',
  'correo',
  'linea',
  'numeroContrato',
  'cargo',
  'objeto',
  'inicio',
  'fin',
  'honorario',
  'valorTotal',
  'riesgo',
  'revisoNombre',
  'revisoCargo',
] as const;
export type CampoRegistro = (typeof CAMPOS_REGISTRO)[number];

/** Todo es obligatorio salvo el correo. */
const OBLIGATORIOS: Record<Exclude<CampoRegistro, 'correo'>, string> = {
  nombre: 'Escribe tu nombre completo.',
  cedula: 'Escribe tu cédula (solo números).',
  direccion: 'Escribe tu dirección.',
  telefono: 'Escribe tu teléfono.',
  ciudad: 'Escribe tu ciudad.',
  linea: 'Escribe tu equipo o línea.',
  numeroContrato: 'Escribe el número de tu contrato.',
  cargo: 'Escribe tu cargo.',
  objeto: 'Escribe el objeto de tu contrato.',
  inicio: 'Escribe la fecha de inicio de tu contrato.',
  fin: 'Escribe la fecha de fin de tu contrato.',
  honorario: 'Escribe tu honorario mensual.',
  valorTotal: 'Escribe el valor total de tu contrato.',
  riesgo: 'Escoge el riesgo ARL de tu planilla (I a V).',
  revisoNombre: 'Escribe el nombre de quien revisa tu cuenta.',
  revisoCargo: 'Escribe el cargo de quien revisa tu cuenta.',
};

/** Mismos máximos que "Mi contrato" de la contratista (así lo que se registra se puede editar después sin sorpresas). */
const MAXIMOS: Array<[CampoRegistro, number, string]> = [
  ['direccion', 150, 'La dirección'],
  ['ciudad', 80, 'La ciudad'],
  ['cargo', 120, 'El cargo'],
  ['objeto', 1500, 'El objeto'],
  ['revisoNombre', 120, 'El nombre de quien revisa'],
  ['revisoCargo', 120, 'El cargo de quien revisa'],
];

const MENSAJE_TELEFONO = 'El teléfono solo lleva números, espacios o el signo +, entre 7 y 15 dígitos. Ejemplo: 300 123 4567';

// =================================================================== validación
/** Solo las claves del registro; los textos recortados (los números de honorario y valor total pasan tal cual). */
function limpiarEntrada(entrada: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS_REGISTRO) {
    const v = entrada[k];
    if (typeof v === 'string') out[k] = v.trim();
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else out[k] = '';
  }
  return out;
}

/**
 * Valida la solicitud con las mismas reglas del panel (nombre y cédula únicos entre TODAS las filas, incluidas las
 * pendientes) más lo obligatorio. Lanza ErrorValidacion con todos los errores por campo; devuelve los valores listos.
 */
export function validarRegistro(entrada: Record<string, unknown>, existentes: Array<typeof contratos.$inferSelect>) {
  const e = limpiarEntrada(entrada);
  const err: Record<string, string> = {};

  for (const [k, msg] of Object.entries(OBLIGATORIOS)) if (e[k] === '') err[k] = msg;
  for (const [k, max, etiqueta] of MAXIMOS) {
    if (!err[k] && String(e[k]).length > max) err[k] = `${etiqueta} es demasiado largo (máximo ${max} caracteres).`;
  }
  if (!err.telefono) {
    const t = String(e.telefono);
    if (!/^[\d\s+]+$/.test(t) || !/^\d{7,15}$/.test(t.replace(/[\s+]/g, ''))) err.telefono = MENSAJE_TELEFONO;
  }
  // el honorario y el valor total aceptan "7.174.000", "$ 7.174.000" o 7174000; el formato lo revisa validarContrato
  let valores: ReturnType<typeof validarContrato> | null = null;
  try {
    valores = validarContrato({ ...e, activo: false }, null, existentes, {
      nombreRepetido: MSG_NOMBRE_REPETIDO,
      cedulaRepetida: MSG_CEDULA_REPETIDA,
    });
  } catch (x) {
    if (!(x instanceof ErrorValidacion)) throw x;
    for (const [k, msg] of Object.entries(x.campos)) if (!err[k]) err[k] = msg;
  }
  if (Object.keys(err).length || !valores) throw new ErrorValidacion(err);
  return { ...valores, activo: false, estado: 'pendiente' as const };
}

// =================================================================== límite por IP
/** Primer valor de x-forwarded-for (la IP de quien llama); sin cabecera, 'desconocida'. */
export function ipDeSolicitud(cabecera: string | null | undefined): string {
  const primero = String(cabecera ?? '').split(',')[0].trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(primero) ? primero : 'desconocida';
}

/**
 * Cuenta un intento de registro de esta IP (de forma atómica) y falla si ya van más de 5 en la última hora.
 * Usa `intentos_pin`: `ultimo_fallo` guarda cuándo empezó la hora y `fallos` cuántos intentos van.
 */
export async function contarIntentoDeRegistro(db: Db, ip: string, ahora: Date): Promise<void> {
  const clave = PREFIJO_CLAVE_REGISTRO + ip;
  const iso = ahora.toISOString();
  const ventana = new Date(ahora.getTime() - VENTANA_REGISTRO_MS).toISOString();
  const dentro = sql`${intentosPin.ultimoFallo} > ${ventana}::timestamptz`;
  const [fila] = await db
    .insert(intentosPin)
    .values({ clave, fallos: 1, ultimoFallo: ahora, bloqueadoHasta: null })
    .onConflictDoUpdate({
      target: intentosPin.clave,
      set: {
        fallos: sql`CASE WHEN ${dentro} THEN ${intentosPin.fallos} + 1 ELSE 1 END`,
        ultimoFallo: sql`CASE WHEN ${dentro} THEN ${intentosPin.ultimoFallo} ELSE ${iso}::timestamptz END`,
      },
    })
    .returning({ fallos: intentosPin.fallos });
  if (fila.fallos > MAX_REGISTROS_POR_HORA) throw new ErrorAmable(MENSAJE_LIMITE_REGISTRO, 429);
}

// =================================================================== registrar
/**
 * Recibe una solicitud de cuenta. Devuelve `false` si el campo trampa venía lleno (no se guarda nada; la ruta responde
 * como si hubiera salido bien para no darle pistas al robot) y `true` si quedó guardada como pendiente.
 */
export async function registrarSolicitud(deps: Deps, entrada: Record<string, unknown>, ip: string): Promise<boolean> {
  const trampa = entrada[CAMPO_TRAMPA];
  if (trampa !== undefined && trampa !== null && String(trampa).trim() !== '') return false;

  const ahora = deps.ahora ? deps.ahora() : new Date();
  await contarIntentoDeRegistro(deps.db, ip, ahora);

  const [{ n }] = await deps.db.select({ n: count() }).from(contratos).where(eq(contratos.estado, 'pendiente'));
  if (Number(n) >= MAX_SOLICITUDES_PENDIENTES) throw new ErrorAmable(MENSAJE_TOPE_PENDIENTES, 429);

  const valores = validarRegistro(entrada, await deps.db.select().from(contratos));
  const [c] = await deps.db.insert(contratos).values(valores).returning({ id: contratos.id });
  await registrarCambios(deps, c.id, 'contratista', [{ campo: 'registro', antes: '', despues: 'Solicitud enviada' }]);
  return true;
}
