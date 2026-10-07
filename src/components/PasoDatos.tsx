"use client";

import type { ChangeEvent } from "react";
import { MAX_BYTES } from "./archivos";
import { fmtFecha, fmtMoney, tituloNombre } from "./formato";
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
  onMes: (key: string) => void;
  onPeriodo: (p: PeriodoEstado) => void;
  onDias: (d: DiasEstado) => void;
  onArchivo: (file: File) => void;
  onSalir: () => void;
}

/** Paso 2: mes a cobrar, periodo, días a mano (opcional) y la planilla. */
export default function PasoDatos({ contrato: c, mes, periodo, dias, onMes, onPeriodo, onDias, onArchivo, onSalir }: Props) {
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
      <p className="paso">Paso 2 de 4 · Mes y planilla</p>
      <h2>Hola, {tituloNombre(c.nombre.split(" ").slice(0, 2).join(" "))}</h2>
      <div className="card">
        <div className="fila"><span className="et">Contrato n.º</span><span className="val">{c.numeroContrato || "—"}</span></div>
        <div className="fila"><span className="et">Honorario mensual</span><span className="val">{fmtMoney(c.honorario)}</span></div>
      </div>

      <div className="card">
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
          <div>
            <div className="fila"><span className="et">Desde</span><span className="val">{fmtFecha(mes.inicio)}</span></div>
            <div className="fila"><span className="et">Hasta</span><span className="val">{fmtFecha(mes.corte)}</span></div>
            <div className="fila"><span className="et">Días · Valor del mes</span><span className="val">{mes.dias} días · {fmtMoney(mes.valor)}</span></div>
            <button type="button" className="link" onClick={() => onPeriodo({ editable: true, inicio: mes.inicio, corte: mes.corte })}>
              ¿Tuviste una novedad? Cambiar fechas
            </button>
          </div>
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

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Sube tu planilla de seguridad social</h3>
        <p className="ayuda">
          Es la planilla PILA que pagaste (PDF o una foto clara). Normalmente es del mes que vas a cobrar o del mes anterior. Si pagaste más de una planilla (una corrección, por ejemplo), sube aquí la principal y después podrás agregar las otras.
        </p>
        <input id="archivo" className="oculto" type="file" accept="application/pdf,image/*" onChange={alElegir} />
        <label className="btn" htmlFor="archivo">Elegir PDF o foto</label>
        <input id="archivo-cam" className="oculto" type="file" accept="image/*" capture="environment" onChange={alElegir} />
        <label className="btn sec" htmlFor="archivo-cam">Tomar una foto ahora</label>
        <p className="ayuda" style={{ margin: 0 }}>Máximo {MAX_BYTES / (1024 * 1024)} MB. Solo PDF, JPG o PNG.</p>
      </div>
      <button type="button" className="link" onClick={onSalir}>Salir</button>
    </section>
  );
}
