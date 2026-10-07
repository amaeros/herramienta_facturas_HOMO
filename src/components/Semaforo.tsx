import type { EstadoCarga } from "./tipos";

export type ClaseEstado = "ok" | "rev" | "err" | "gris";

export function claseEstado(estado: EstadoCarga): "ok" | "rev" | "err" {
  return estado === "OK" ? "ok" : estado === "REVISAR" ? "rev" : "err";
}

/** La frase corta de cada estado (la misma en la hoja y en la franja de revisión). */
export function fraseEstado(clase: ClaseEstado): string {
  return clase === "ok" ? "Todo cuadra" : clase === "rev" ? "Revisa esto" : clase === "err" ? "Hay un problema" : "Sin revisar";
}

interface Props {
  id?: string;
  clase: ClaseEstado;
  /** Frase que encabeza la franja. Si no se pasa, se usa la frase corta del estado. */
  frase?: string;
  /** Texto que explica el estado. Se pone como texto (nunca como HTML) y puede traer emoji del servidor. */
  mensaje?: string;
  /** Línea aparte con lo que pasa después (por ejemplo, que el supervisor lo revisará). */
  nota?: string;
}

/** Franja de color con una frase: "Todo cuadra", "Revisa esto: …", "Hay un problema: …". */
export default function Semaforo({ id, clase, frase, mensaje, nota }: Props) {
  const f = frase ?? fraseEstado(clase);
  return (
    <div id={id} className={"estado " + clase} aria-live="polite">
      <p>
        <span className="estado-frase">{f}</span>
        {mensaje ? ": " : "."}
        {mensaje && <span className="estado-mensaje">{mensaje}</span>}
      </p>
      {nota && <p>{nota}</p>}
    </div>
  );
}
