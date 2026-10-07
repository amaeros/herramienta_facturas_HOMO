"use client";

import Semaforo, { claseEstado } from "./Semaforo";
import type { RespEnviar } from "./tipos";

interface Props {
  resp: RespEnviar;
  ocupado: boolean;
  onOtroMes: () => void;
  onSalir: () => void;
}

/** Paso 4: resultado del envío y descarga del Excel (el link es del mismo sitio y responde con el .xlsx). */
export default function PasoFinal({ resp: r, ocupado, onOtroMes, onSalir }: Props) {
  const factura = r.factura && r.factura.url ? r.factura : null;
  const titulo = !factura
    ? "Enviado, pero falta la cuenta de cobro"
    : r.estado === "OK"
      ? "¡Listo! Todo en orden"
      : r.estado === "REVISAR"
        ? "Cuenta de cobro lista, tu supervisor la revisará"
        : "Cuenta de cobro lista, con una alerta para tu supervisor";

  return (
    <section>
      <p className="paso">Paso 4 de 4 · Listo</p>
      <Semaforo clase={claseEstado(r.estado)} emoji={r.emoji} titulo={titulo} mensaje={r.mensaje} />
      {r.aviso && <div className="aviso warn">{r.aviso}</div>}
      {factura ? (
        <div>
          <a className="btn" href={factura.url} download={factura.nombre || undefined}>
            Descargar cuenta de cobro (Excel)
          </a>
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
      <button type="button" className="btn sec" disabled={ocupado} onClick={onOtroMes}>Enviar otro mes</button>
      <button type="button" className="link" onClick={onSalir}>Salir</button>
    </section>
  );
}
