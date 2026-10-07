"use client";

import AdicionalesCard from "./AdicionalesCard";
import AyudaPlanilla from "./AyudaPlanilla";
import { dinero, soloNumero } from "./formato";
import Hoja, { type HojaDatos } from "./Hoja";
import { datosDeInputs, type Inputs } from "./lectura";
import Semaforo, { claseEstado, type ClaseEstado } from "./Semaforo";
import SelectorPeriodo from "./SelectorPeriodo";
import type { Adicional, Evaluacion, RespPlanilla } from "./tipos";

interface Props {
  /** lo que la hoja ya sabe (mes, periodo, valor y lo leído de la planilla) */
  hoja: HojaDatos;
  mesKey: string;
  inputs: Inputs;
  onInputs: (cambio: Partial<Inputs>) => void;
  edicion: boolean;
  /** hay cambios sin revisar (o la revisión falló) */
  sucio: boolean;
  evaluando: boolean;
  evaluacion: Evaluacion | null;
  leyo: boolean;
  nota: string;
  adicionales: Adicional[];
  subirAdicional: (file: File) => Promise<RespPlanilla>;
  onAgregarAdicional: (a: Adicional) => void;
  onQuitarAdicional: (i: number) => void;
  onCorregir: () => void;
  onRevisar: () => void;
  onEnviar: () => void;
  onOtra: () => void;
}

/** Paso 3: la hoja con lo leído, el estado de la revisión, los campos para corregir y las planillas adicionales. */
export default function PasoVerificar(p: Props) {
  const { inputs, evaluacion: ev } = p;
  const d = datosDeInputs(inputs);

  // Estado de la revisión (franja de color + frase)
  let clase: ClaseEstado = "gris";
  let frase = "";
  let mensaje = "";
  let nota = "";
  if (p.sucio) {
    frase = "Cambiaste algún dato";
    mensaje = p.evaluando
      ? "Estamos revisando tus cambios…"
      : "Estamos por revisar tus cambios. También puedes tocar «Revisar de nuevo».";
  } else if (!ev) {
    frase = "Falta revisar";
    mensaje = "Escribe los datos de tu planilla y toca «Revisar de nuevo».";
  } else {
    clase = claseEstado(ev.estado);
    mensaje = ev.mensaje;
    if (ev.bloquea) {
      frase = "Hay un problema";
      nota = "Falta algo para generar tu cuenta de cobro.";
    } else if (ev.estado === "OK") {
      frase = "Todo cuadra";
    } else if (ev.estado === "REVISAR") {
      frase = "Revisa esto";
      nota = "Tu supervisor lo revisará.";
    } else {
      frase = "Hay un problema";
      nota = "Tu cuenta de cobro se genera igual y tu supervisor recibe la alerta.";
    }
  }
  // Las alertas (revisar / problema) NO bloquean: solo falta de datos obligatorios o formato imposible (ev.bloquea)
  const noEnviar = !ev || ev.bloquea === true || p.sucio || p.evaluando;
  const estadoHoja: ClaseEstado | null = p.sucio || !ev ? null : clase;

  const formatear = (campo: "salud" | "pension" | "arl") => () => {
    const n = soloNumero(inputs[campo]);
    if (n !== null) p.onInputs({ [campo]: dinero(n) });
  };

  return (
    <section>
      <h2 className="titulo-paso">Esto leímos de tu planilla</h2>
      {p.nota && <div className="aviso info">{p.nota}</div>}

      <Hoja {...p.hoja} estado={estadoHoja} />

      <div style={{ marginTop: 16 }}>
        <Semaforo clase={clase} frase={frase} mensaje={mensaje} nota={nota} />
      </div>

      <div className="seccion seccion-primera">
        {!p.edicion ? (
          <button type="button" className="btn sec" onClick={p.onCorregir}>Corregir datos</button>
        ) : (
          <div>
            <h3>Corrige los datos de tu planilla</h3>
            <div className={"dato" + (!d.numero ? " falta" : "")}>
              <label className="et" htmlFor="i-numero">N.º de planilla (solo números)</label>
              <input
                id="i-numero" type="tel" inputMode="numeric" autoComplete="off" placeholder="Ej. 9509633245"
                aria-invalid={!d.numero ? true : undefined} aria-describedby={!d.numero ? "e-numero" : undefined}
                value={inputs.numero} onChange={(e) => p.onInputs({ numero: e.target.value })}
              />
              {!d.numero && <p id="e-numero" className="error-campo">Falta el número de la planilla. Búscalo arriba en tu planilla.</p>}
            </div>
            <div className={"dato" + (!d.periodo ? " falta" : "")}>
              <span className="et">Mes cotizado</span>
              <SelectorPeriodo
                idMes="i-mes" idAnio="i-anio" mesKey={p.mesKey} mes={inputs.mes} anio={inputs.anio}
                onMes={(v) => p.onInputs({ mes: v })} onAnio={(v) => p.onInputs({ anio: v })}
              />
              {!d.periodo && <p className="error-campo">Falta el mes cotizado. Escoge el mes y el año.</p>}
            </div>
            <div className={"dato" + (d.salud === null ? " falta" : "")}>
              <label className="et" htmlFor="i-salud">Salud ($)</label>
              <input
                id="i-salud" type="tel" inputMode="numeric" autoComplete="off" placeholder="Ej. 358.700"
                aria-invalid={d.salud === null ? true : undefined} aria-describedby={d.salud === null ? "e-salud" : undefined}
                value={inputs.salud} onChange={(e) => p.onInputs({ salud: e.target.value })} onBlur={formatear("salud")}
              />
              {d.salud === null && <p id="e-salud" className="error-campo">Falta el valor de salud. Escribe solo números.</p>}
            </div>
            <div className={"dato" + (d.pension === null ? " falta" : "")}>
              <label className="et" htmlFor="i-pension">Pensión ($)</label>
              <input
                id="i-pension" type="tel" inputMode="numeric" autoComplete="off" placeholder="Ej. 459.200"
                aria-invalid={d.pension === null ? true : undefined} aria-describedby={d.pension === null ? "e-pension" : undefined}
                value={inputs.pension} onChange={(e) => p.onInputs({ pension: e.target.value })} onBlur={formatear("pension")}
              />
              {d.pension === null && <p id="e-pension" className="error-campo">Falta el valor de pensión. Escribe solo números.</p>}
            </div>
            <div className={"dato" + (d.arl === null ? " falta" : "")}>
              <label className="et" htmlFor="i-arl">ARL ($)</label>
              <input
                id="i-arl" type="tel" inputMode="numeric" autoComplete="off" placeholder="Ej. 70.000"
                aria-invalid={d.arl === null ? true : undefined} aria-describedby={d.arl === null ? "e-arl" : undefined}
                value={inputs.arl} onChange={(e) => p.onInputs({ arl: e.target.value })} onBlur={formatear("arl")}
              />
              {d.arl === null && <p id="e-arl" className="error-campo">Falta el valor de ARL. Escribe solo números.</p>}
            </div>
            <p className="ayuda">
              Escribe solo el valor de <strong>salud, pensión y ARL</strong>. No sumes caja de compensación ni intereses de mora.
            </p>
          </div>
        )}
        {(p.edicion || p.sucio) && (
          <button type="button" className="btn sec" style={{ marginTop: p.edicion ? 0 : 12 }} disabled={p.evaluando} onClick={p.onRevisar}>
            Revisar de nuevo
          </button>
        )}
        <AyudaPlanilla abierta={!p.leyo} />
      </div>

      <AdicionalesCard
        adicionales={p.adicionales}
        mesKey={p.mesKey}
        subir={p.subirAdicional}
        onAgregar={p.onAgregarAdicional}
        onQuitar={p.onQuitarAdicional}
      />

      <div className="seccion">
        <button type="button" className="btn sec" onClick={p.onOtra}>Subir otra planilla</button>
      </div>

      <div className="relleno" aria-hidden="true" />

      <div className="barra-fija">
        <button type="button" className="btn" disabled={noEnviar} onClick={p.onEnviar}>
          Enviar y generar mi cuenta de cobro
        </button>
      </div>
    </section>
  );
}
