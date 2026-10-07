/** Error con mensaje amable para la contratista (se muestra tal cual). `estado` = código HTTP. */
export class ErrorAmable extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado = 400) {
    super(mensaje);
    this.name = 'ErrorAmable';
    this.estado = estado;
  }
}

/**
 * Error de validación de un formulario del panel de admin: `campos` = { nombreDelCampo: mensaje }.
 * `message` es el primer mensaje (la ruta responde { ok:false, error, campos }).
 */
export class ErrorValidacion extends ErrorAmable {
  readonly campos: Record<string, string>;
  constructor(campos: Record<string, string>, estado = 400) {
    super(Object.values(campos)[0] ?? 'Revisa los datos.', estado);
    this.name = 'ErrorValidacion';
    this.campos = campos;
  }
}

export const MENSAJE_GENERICO =
  'Algo salió mal de nuestro lado. Intenta de nuevo en un momento. Si sigue igual, avisa a tu supervisor.';
export const MENSAJE_SESION = 'Tu sesión venció. Vuelve a entrar.';
