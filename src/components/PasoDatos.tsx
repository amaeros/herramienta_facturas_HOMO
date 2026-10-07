"use client";

import type { ChangeEvent } from "react";
import { MAX_BYTES } from "./archivos";
import { fmtFecha, fmtMoney, tituloNombre } from "./formato";
import Hoja, { type HojaDatos } from "./Hoja";
import {
  eleccionSoloDias, esError, limitesDelMes, MES_COMPLETO, type EleccionPeriodo, type PeriodoElegido, type PeriodoInvalido,
} from "./periodo";
import type { MesInfo, Resumen } from "./tipos";

interface Props {
  contrato: Resumen;
  mes: MesInfo;
  eleccion: EleccionPeriodo;
  /** lo que resulta de la elección (o por qué no se puede) */
  elegido: PeriodoElegido | PeriodoInvalido;
  hoja: HojaDatos;
  onMes: (key: string) => void;
  onEleccion: (e: EleccionPeriodo) => void;
  onArchivo: (file: File) => void;
  onSalir: () => void;
  onMiContrato: () => void;
}

/** Paso 2: mes a cobrar, qué se cobra (mes completo o solo unos días) y la planilla. La hoja muestra mes, periodo y valor. */
export default function PasoDatos({ contrato: c, mes, eleccion, elegido, hoja, onMes, onEleccion, onArchivo, onSalir, onMiContrato }: Props) {
  const lim = limitesDelMes(mes.key, c);
  // los campos arrancan con fechas válidas, así que cualquier error es de algo que la persona cambió: se muestra de una
  const mostrarDel = esError(elegido) && elegido.campo === "del" ? elegido.error : "";
  const mostrarAl = esError(elegido) && elegido.campo === "al" ? elegido.error : "";

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
        <div className="renglon"><dt>Vigencia</dt><dd className="cifra">{fmtFecha(c.inicio)} a {fmtFecha(c.fin)}</dd></div>
      </dl>
      <button type="button" className="link" onClick={onMiContrato}>Revisar mis datos del contrato</button>

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

        <fieldset className="opciones">
          <legend>¿Qué vas a cobrar?</legend>

          <label className={"opcion" + (eleccion.opcion === "completo" ? " marcada" : "")}>
            <input
              type="radio"
              name="que-cobras"
              value="completo"
              checked={eleccion.opcion === "completo"}
              onChange={() => onEleccion(MES_COMPLETO)}
            />
            <span className="opcion-texto">
              <span className="opcion-titulo">El mes completo</span>
              <span className="opcion-detalle cifra">
                Del {fmtFecha(mes.inicio)} al {fmtFecha(mes.corte)}, {mes.dias} {mes.dias === 1 ? "día" : "días"}
              </span>
            </span>
          </label>

          <label className={"opcion" + (eleccion.opcion === "dias" ? " marcada" : "")}>
            <input
              type="radio"
              name="que-cobras"
              value="dias"
              checked={eleccion.opcion === "dias"}
              onChange={() => onEleccion(eleccionSoloDias(mes))}
            />
            <span className="opcion-texto">
              <span className="opcion-titulo">Solo unos días</span>
              <span className="opcion-detalle">Por ejemplo, si tuviste una suspensión o una licencia.</span>
            </span>
          </label>
        </fieldset>

        {eleccion.opcion === "dias" && (
          <div className="rango">
            <div className="dos">
              <div className="campo">
                <label htmlFor="f-del">Del</label>
                <input
                  id="f-del"
                  type="date"
                  min={lim.min}
                  max={lim.max}
                  value={eleccion.del}
                  aria-invalid={mostrarDel ? true : undefined}
                  aria-describedby={mostrarDel ? "f-del-error" : undefined}
                  onChange={(e) => onEleccion({ ...eleccion, del: e.target.value })}
                />
              </div>
              <div className="campo">
                <label htmlFor="f-al">Al</label>
                <input
                  id="f-al"
                  type="date"
                  min={eleccion.del && eleccion.del > lim.min && eleccion.del <= lim.max ? eleccion.del : lim.min}
                  max={lim.max}
                  value={eleccion.al}
                  aria-invalid={mostrarAl ? true : undefined}
                  aria-describedby={mostrarAl ? "f-al-error" : undefined}
                  onChange={(e) => onEleccion({ ...eleccion, al: e.target.value })}
                />
              </div>
            </div>
            {mostrarDel && <p id="f-del-error" className="error-campo" role="alert">Del: {mostrarDel}</p>}
            {mostrarAl && <p id="f-al-error" className="error-campo" role="alert">Al: {mostrarAl}</p>}

            <p className="rango-cuenta cifra" aria-live="polite">
              {!esError(elegido) ? elegido.dias + " " + (elegido.dias === 1 ? "día" : "días") + ": " + fmtMoney(elegido.valor) : ""}
            </p>
            <p className="ayuda ayuda-campo">Contamos los días con mes de 30 días. El 31 cuenta como 30.</p>
          </div>
        )}
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
