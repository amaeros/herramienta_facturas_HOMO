"use client";

import AdicionalesCard from "./AdicionalesCard";
import AyudaPlanilla from "./AyudaPlanilla";
import { dinero, fmtMoney, labelMes, soloNumero } from "./formato";
import { datosDeInputs, type Inputs } from "./lectura";
import Semaforo, { claseEstado } from "./Semaforo";
import SelectorPeriodo from "./SelectorPeriodo";
import type { Adicional, Evaluacion, RespPlanilla } from "./tipos";

interface Props {
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

function valorOGuion(n: number | null, f: (n: number) => string): string {
  return n === null ? "—" : f(n);
}

/** Paso 3: revisa lo leído, corrige si hace falta, agrega planillas adicionales y mira el semáforo. */
export default function PasoVerificar(p: Props) {
  const { inputs, evaluacion: ev } = p;
  const d = datosDeInputs(inputs);

  // Semáforo (réplica de pintarSemaforo del legacy)
  let clase: "ok" | "rev" | "err" | "gris" = "gris";
  let emoji = "📝";
  let titulo = "";
  let mensaje = "";
  if (p.sucio) {
    titulo = "Cambiaste algún dato";
    mensaje = p.evaluando
      ? "Estamos revisando tus cambios…"
      : "Estamos por revisar tus cambios. También puedes tocar «Revisar de nuevo».";
  } else if (!ev) {
    titulo = "Falta revisar";
    mensaje = "Escribe los datos de tu planilla y toca «Revisar de nuevo».";
  } else {
    clase = claseEstado(ev.estado);
    emoji = ev.emoji;
    if (ev.bloquea) titulo = "Falta algo para generar tu cuenta de cobro";
    else if (ev.estado === "OK") titulo = "Todo en orden";
    else if (ev.estado === "REVISAR") titulo = "Tu supervisor lo revisará";
    else titulo = "Alerta para tu supervisor (tu cuenta de cobro se genera igual)";
    mensaje = ev.mensaje;
  }
  // Las alertas (🟡 / 🔴) NO bloquean: solo falta de datos obligatorios o formato imposible (ev.bloquea)
  const noEnviar = !ev || ev.bloquea === true || p.sucio || p.evaluando;

  const formatear = (campo: "salud" | "pension" | "arl") => () => {
    const n = soloNumero(inputs[campo]);
    if (n !== null) p.onInputs({ [campo]: dinero(n) });
  };

  return (
    <section>
      <p className="paso">Paso 3 de 4 · Revisa</p>
      <h2>Esto leímos de tu planilla</h2>
      {p.nota && <div className="aviso info">{p.nota}</div>}

      <div className="card">
        {!p.edicion ? (
          <div>
            <div className="fila"><span className="et">N.º de planilla</span><span className="val">{d.numero || "—"}</span></div>
            <div className="fila"><span className="et">Mes cotizado</span><span className="val">{d.periodo ? labelMes(d.periodo) : "—"}</span></div>
            <div className="fila"><span className="et">Salud</span><span className="val">{valorOGuion(d.salud, fmtMoney)}</span></div>
            <div className="fila"><span className="et">Pensión</span><span className="val">{valorOGuion(d.pension, fmtMoney)}</span></div>
            <div className="fila"><span className="et">ARL (riesgos laborales)</span><span className="val">{valorOGuion(d.arl, fmtMoney)}</span></div>
          </div>
        ) : (
          <div>
            <div className={"dato" + (!d.numero ? " falta" : "")}>
              <label className="et" htmlFor="i-numero">N.º de planilla (solo números)</label>
              <input
                id="i-numero" type="tel" inputMode="numeric" autoComplete="off" placeholder="Ej. 9509633245"
                value={inputs.numero} onChange={(e) => p.onInputs({ numero: e.target.value })}
              />
            </div>
            <div className={"dato" + (!d.periodo ? " falta" : "")}>
              <span className="et">Mes cotizado</span>
              <SelectorPeriodo
                idMes="i-mes" idAnio="i-anio" mesKey={p.mesKey} mes={inputs.mes} anio={inputs.anio}
                onMes={(v) => p.onInputs({ mes: v })} onAnio={(v) => p.onInputs({ anio: v })}
              />
            </div>
            <div className={"dato" + (d.salud === null ? " falta" : "")}>
              <label className="et" htmlFor="i-salud">Salud ($)</label>
              <input
                id="i-salud" type="tel" inputMode="numeric" autoComplete="off" placeholder="Ej. 358.700"
                value={inputs.salud} onChange={(e) => p.onInputs({ salud: e.target.value })} onBlur={formatear("salud")}
              />
            </div>
            <div className={"dato" + (d.pension === null ? " falta" : "")}>
              <label className="et" htmlFor="i-pension">Pensión ($)</label>
              <input
                id="i-pension" type="tel" inputMode="numeric" autoComplete="off" placeholder="Ej. 459.200"
                value={inputs.pension} onChange={(e) => p.onInputs({ pension: e.target.value })} onBlur={formatear("pension")}
              />
            </div>
            <div className={"dato" + (d.arl === null ? " falta" : "")}>
              <label className="et" htmlFor="i-arl">ARL ($)</label>
              <input
                id="i-arl" type="tel" inputMode="numeric" autoComplete="off" placeholder="Ej. 70.000"
                value={inputs.arl} onChange={(e) => p.onInputs({ arl: e.target.value })} onBlur={formatear("arl")}
              />
            </div>
            <p className="ayuda">
              Escribe solo el valor de <strong>salud, pensión y ARL</strong>. No sumes caja de compensación ni intereses de mora.
            </p>
          </div>
        )}
        {!p.edicion && (
          <button type="button" className="btn sec" style={{ marginTop: 12 }} onClick={p.onCorregir}>Corregir datos</button>
        )}
        {(p.edicion || p.sucio) && (
          <button type="button" className="btn" style={{ marginTop: p.edicion ? 0 : 12 }} disabled={p.evaluando} onClick={p.onRevisar}>
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

      <Semaforo clase={clase} emoji={emoji} titulo={titulo} mensaje={mensaje} />

      <button type="button" className="btn" disabled={noEnviar} onClick={p.onEnviar}>
        Enviar y generar mi cuenta de cobro
      </button>
      <button type="button" className="btn sec" onClick={p.onOtra}>Subir otra planilla</button>
    </section>
  );
}
