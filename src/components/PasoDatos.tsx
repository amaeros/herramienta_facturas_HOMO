"use client";

import type { ChangeEvent } from "react";
import { MAX_BYTES } from "./archivos";
import { fmtMoney, tituloNombre } from "./formato";
import Hoja, { type HojaDatos } from "./Hoja";
import type { MesInfo, Resumen } from "./tipos";

export interface PeriodoEstado {
  editable: boolean;
  inicio: string;
  corte: string;
}

export interface DiasEstado {
  activo: boolean;
  n: string;
  motivo: string;
}

interface Props {
  contrato: Resumen;
  mes: MesInfo;
  periodo: PeriodoEstado;
  dias: DiasEstado;
  hoja: HojaDatos;
  onMes: (key: string) => void;
  onPeriodo: (p: PeriodoEstado) => void;
  onDias: (d: DiasEstado) => void;
  onArchivo: (file: File) => void;
  onSalir: () => void;
}

/** Paso 2: mes a cobrar, periodo, días a mano (opcional) y la planilla. La hoja muestra mes, periodo y valor. */
export default function PasoDatos({ contrato: c, mes, periodo, dias, hoja, onMes, onPeriodo, onDias, onArchivo, onSalir }: Props) {
  const n = Number(dias.n);
  const calculoDias =
    n >= 1 && n <= 30 && Math.floor(n) === n
      ? "Se cobrarán " + n + " días: " + fmtMoney(Math.round((c.honorario * n) / 30)) + " (honorario × " + n + " ÷ 30)."
      : "";

  function alElegir(ev: ChangeEvent<HTMLInputElement>) {
    const input = ev.target;
    const file = input.files && input.files[0];
    input.value = "";
    if (file) onArchivo(file);
  }

  return (
    <section>
      <h2 className="titulo-paso">Hola, {tituloNombre(c.nombre.split(" ").slice(0, 2).join(" "))}</h2>
      <dl className="renglones">
        <div className="renglon"><dt>Contrato n.º</dt><dd className="cifra">{c.numeroContrato || "—"}</dd></div>
        <div className="renglon"><dt>Honorario mensual</dt><dd className="cifra">{fmtMoney(c.honorario)}</dd></div>
      </dl>

      <div className="seccion">
        <div className="campo">
          <label htmlFor="mes">Mes a cobrar</label>
          <select id="mes" value={mes.key} onChange={(e) => onMes(e.target.value)}>
            {c.meses.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label + (m.enviado ? "  (ya enviada " + m.enviado.split(" ")[0] + ")" : "")}
              </option>
            ))}
          </select>
        </div>
        {mes.enviado && (
          <div className="aviso warn">Ya enviaste este mes. Si subes otra planilla, reemplazará tu envío anterior.</div>
        )}

        {!periodo.editable ? (
          <button type="button" className="link" onClick={() => onPeriodo({ editable: true, inicio: mes.inicio, corte: mes.corte })}>
            ¿Tuviste una novedad? Cambiar fechas
          </button>
        ) : (
          <div>
            <div className="aviso info">Cambia las fechas solo si empezaste o terminaste a mitad de mes. Tu supervisor las revisará.</div>
            <div className="dos">
              <div className="campo">
                <label htmlFor="f-inicio">Desde</label>
                <input id="f-inicio" type="date" value={periodo.inicio} onChange={(e) => onPeriodo({ ...periodo, inicio: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="f-corte">Hasta</label>
                <input id="f-corte" type="date" value={periodo.corte} onChange={(e) => onPeriodo({ ...periodo, corte: e.target.value })} />
              </div>
            </div>
            <button type="button" className="link" onClick={() => onPeriodo({ editable: false, inicio: mes.inicio, corte: mes.corte })}>
              Volver a las fechas normales
            </button>
          </div>
        )}

        <div>
          {!dias.activo ? (
            <button type="button" className="link" onClick={() => onDias({ activo: true, n: "", motivo: "" })}>
              ¿Este mes se cobran días distintos? (suspensión, licencia, novedad)
            </button>
          ) : (
            <div>
              <div className="aviso info">
                Úsalo solo si este mes se cobran más o menos días que los normales. El valor será tu honorario × días ÷ 30. Tu supervisor lo revisará.
              </div>
              <div className="campo">
                <label htmlFor="dias-n">Días a cobrar (de 1 a 30)</label>
                <input
                  id="dias-n"
                  type="tel"
                  inputMode="numeric"
                  maxLength={2}
                  autoComplete="off"
                  placeholder="Ej. 20"
                  autoFocus
                  value={dias.n}
                  onChange={(e) => onDias({ ...dias, n: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                />
              </div>
              <div className="campo">
                <label htmlFor="dias-motivo">Motivo (obligatorio)</label>
                <input
                  id="dias-motivo"
                  type="text"
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Ej. Licencia no remunerada del 1 al 10"
                  value={dias.motivo}
                  onChange={(e) => onDias({ ...dias, motivo: e.target.value })}
                />
              </div>
              <p className="ayuda" aria-live="polite">{calculoDias}</p>
              <button type="button" className="link" onClick={() => onDias({ activo: false, n: "", motivo: "" })}>
                Volver a los días normales
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="seccion">
        <h3>Sube tu planilla de seguridad social</h3>
        <p className="ayuda">
          Es la planilla PILA que pagaste (PDF o una foto clara). La resumida o la detallada sirven; el comprobante del banco no. Normalmente es del mes que vas a cobrar o del mes anterior. Si pagaste más de una planilla (una corrección, por ejemplo), sube aquí la principal y después podrás agregar las otras.
        </p>
        <input id="archivo" className="oculto" type="file" accept="application/pdf,image/*" onChange={alElegir} />
        <label className="zona-subida foco-archivo" htmlFor="archivo">
          <span className="zona-subida-titulo">Elegir PDF o foto</span>
          <span className="zona-subida-ayuda">Máximo {MAX_BYTES / (1024 * 1024)} MB. Solo PDF, JPG o PNG.</span>
        </label>
        <input id="archivo-cam" className="oculto" type="file" accept="image/*" capture="environment" onChange={alElegir} />
        <label className="btn sec foco-archivo" htmlFor="archivo-cam">Tomar una foto ahora</label>
      </div>

      <Hoja {...hoja} />

      <button type="button" className="link" onClick={onSalir}>Salir</button>

      <div className="relleno" aria-hidden="true" />

      <div className="barra-fija">
        <label className="btn foco-archivo" htmlFor="archivo">Elegir PDF o foto</label>
      </div>
    </section>
  );
}
