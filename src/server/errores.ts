/** Error con mensaje amable para la contratista (se muestra tal cual). `estado` = código HTTP. */
export class ErrorAmable extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado = 400) {
    super(mensaje);
    this.name = 'ErrorAmable';
    this.estado = estado;
  }
}

export const MENSAJE_GENERICO =
  'Algo salió mal de nuestro lado. Intenta de nuevo en un momento. Si sigue igual, avisa a tu supervisor.';
export const MENSAJE_SESION = 'Tu sesión venció. Vuelve a entrar.';
