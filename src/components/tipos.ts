/** Tipos de las respuestas de la API (ver docs/ARQUITECTURA.md). */

export type EstadoCarga = "OK" | "REVISAR" | "ERROR";

export interface MesInfo {
  key: string; // 'AAAA-MM'
  label: string;
  inicio: string; // 'AAAA-MM-DD'
  corte: string;
  dias: number;
  valor: number;
  /** estadoTexto de la carga de ese mes ('✅ OK', '🟡 REVISAR'...) o '' si no se ha enviado */
  enviado: string;
}

export interface Resumen {
  nombre: string;
  numeroContrato: string;
  honorario: number;
  inicio: string;
  fin: string;
  riesgo: string;
  meses: MesInfo[];
  mesDefault: string;
}

/** Los 4 datos del contrato que la contratista puede cambiar (GET y PUT /api/mi-contrato). Fechas 'AAAA-MM-DD' o ''. */
export interface DatosMiContrato {
  inicio: string;
  fin: string;
  revisoNombre: string;
  revisoCargo: string;
}

export interface RespMiContrato {
  ok: true;
  datos: DatosMiContrato;
}

export interface RespGuardarMiContrato extends RespMiContrato {
  contrato: Resumen;
}

/** Datos de la planilla principal tal como van a /api/evaluar y /api/enviar. */
export interface Datos {
  numero: string;
  periodo: string; // 'AAAA-MM' o ''
  salud: number | null;
  pension: number | null;
  arl: number | null;
}

export interface Adicional {
  numero: string;
  periodo: string;
  valor: number;
  tempId: string;
}

export interface DiasManualPayload {
  dias: string;
  motivo: string;
}

/** Subconjunto de lo que devuelve Calc.evaluate que usa la pantalla. */
export interface Evaluacion {
  estado: EstadoCarga;
  estadoTexto: string;
  emoji: string;
  mensaje: string;
  bloquea: boolean;
}

export interface RespLogin {
  ok: true;
  contrato: Resumen;
}

export interface RespNombres {
  ok: true;
  nombres: string[];
}

export interface RespPlanilla {
  ok: true;
  tempId: string;
  leyo: boolean;
  confianza?: string;
  tipoDoc?: string;
  fuente?: "navegador" | "ninguna";
  notas?: string[];
  lectura?: {
    numero?: string | null;
    periodo?: string | null;
    salud?: number | null;
    pension?: number | null;
    arl?: number | null;
  } | null;
  evaluacion: Evaluacion | null;
  valor: number | null;
}

export interface RespEvaluar {
  ok: true;
  evaluacion: Evaluacion;
}

export interface RespEnviar {
  ok: true;
  estado: EstadoCarga;
  estadoTexto: string;
  emoji: string;
  mensaje: string;
  aviso?: string;
  correoContratista?: boolean;
  factura?: { nombre: string; url: string } | null;
}
