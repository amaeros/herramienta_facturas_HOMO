"use client";

import Hoja, { type HojaDatos } from "./Hoja";
import Semaforo, { claseEstado } from "./Semaforo";
import type { RespEnviar } from "./tipos";

interface Props {
  resp: RespEnviar;
  /** lo que la hoja ya sabe: mes, periodo, valor y lo leído de la planilla */
  hoja: HojaDatos;
  ocupado: boolean;
  onOtroMes: () => void;
  onSalir: () => void;
}

/** Paso 4: la hoja completa con su sello, el resultado del envío y la descarga del Excel (el link es del mismo sitio y responde con el .xlsx). */
export default function PasoFinal({ resp: r, hoja, ocupado, onOtroMes, onSalir }: Props) {
  const factura = r.factura && r.factura.url ? r.factura : null;
  const clase = claseEstado(r.estado);
  const frase = !factura
    ? "Enviado, pero falta la cuenta de cobro"
    : r.estado === "OK"
      ? "Todo cuadra"
      : r.estado === "REVISAR"
        ? "Revisa esto"
        : "Hay un problema";
  const nota = !factura
    ? ""
    : r.estado === "REVISAR"
      ? "Tu cuenta de cobro está lista y tu supervisor la revisará."
      : r.estado === "ERROR"
        ? "Tu cuenta de cobro está lista, con una alerta para tu supervisor."
        : "";

  return (
    <section>
      <h2 className="titulo-paso">{factura ? "Tu cuenta de cobro está lista" : "Recibimos tu planilla"}</h2>

      <Hoja {...hoja} estado={clase} completa={!!factura} />

      <div style={{ marginTop: 16 }}>
        <Semaforo clase={clase} frase={frase} mensaje={r.mensaje} nota={nota} />
      </div>
      {r.aviso && <div className="aviso warn">{r.aviso}</div>}

      {factura ? (
        <div>
          <div className="aviso info">
            <strong>Recuerda:</strong> firma la cuenta de cobro y entrégala con tu informe de actividades.
          </div>
          {r.correoContratista && <p className="ayuda">También te la enviamos a tu correo.</p>}
        </div>
      ) : (
        <div className="aviso info">
          No pudimos crear la cuenta de cobro (Excel) en este momento. Tu envío quedó registrado y tu supervisor puede generarla desde su panel.
        </div>
      )}

      {factura && (
        <button type="button" className="btn sec" disabled={ocupado} onClick={onOtroMes}>
          Enviar otro mes
        </button>
      )}
      <button type="button" className="link" onClick={onSalir}>Salir</button>

      <div className="relleno" aria-hidden="true" />

      <div className="barra-fija">
        {factura ? (
          <a className="btn" href={factura.url} download={factura.nombre || undefined}>
            Descargar Excel
          </a>
        ) : (
          <button type="button" className="btn" disabled={ocupado} onClick={onOtroMes}>
            Enviar otro mes
          </button>
        )}
      </div>
    </section>
  );
}
