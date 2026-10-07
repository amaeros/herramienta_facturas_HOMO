import { dinero, soloNumero } from "./formato";
import type { Datos, RespPlanilla } from "./tipos";

/** Lo que hay escrito en los campos del paso 3 (todo texto, como lo teclea la persona). */
export interface Inputs {
  numero: string;
  mes: string; // '01'..'12' o ''
  anio: string; // 'AAAA' o ''
  salud: string;
  pension: string;
  arl: string;
}

export const INPUTS_VACIOS: Inputs = { numero: "", mes: "", anio: "", salud: "", pension: "", arl: "" };

export function datosDeInputs(i: Inputs): Datos {
  return {
    numero: i.numero.replace(/\s/g, ""),
    periodo: i.mes && i.anio ? i.anio + "-" + i.mes : "",
    salud: soloNumero(i.salud),
    pension: soloNumero(i.pension),
    arl: soloNumero(i.arl),
  };
}

/** Pasa lo que leyó el servidor de la planilla a los campos de texto. */
export function inputsDeLectura(l: RespPlanilla["lectura"]): Inputs {
  const x = l || {};
  const per = typeof x.periodo === "string" && /^\d{4}-\d{2}$/.test(x.periodo) ? x.periodo : "";
  return {
    numero: x.numero ? String(x.numero) : "",
    mes: per ? per.slice(5, 7) : "",
    anio: per ? per.slice(0, 4) : "",
    salud: dinero(x.salud),
    pension: dinero(x.pension),
    arl: dinero(x.arl),
  };
}

/** ¿Falta algún dato obligatorio de la planilla principal? */
export function faltaAlgo(d: Datos): boolean {
  return !d.numero || !d.periodo || d.salud === null || d.pension === null || d.arl === null;
}
