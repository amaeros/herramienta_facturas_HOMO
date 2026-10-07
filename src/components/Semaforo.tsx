import type { EstadoCarga } from "./tipos";

export function claseEstado(estado: EstadoCarga): "ok" | "rev" | "err" {
  return estado === "OK" ? "ok" : estado === "REVISAR" ? "rev" : "err";
}

interface Props {
  id?: string;
  clase: "ok" | "rev" | "err" | "gris";
  emoji: string;
  titulo: string;
  mensaje: string;
}

/** Caja grande con el emoji del semáforo, un título y el mensaje. El texto se pone como texto (nunca como HTML). */
export default function Semaforo({ id, clase, emoji, titulo, mensaje }: Props) {
  return (
    <div id={id} className={"semaforo " + clase} aria-live="polite">
      <span className="emoji" aria-hidden="true">{emoji}</span>
      <div className="titulo">{titulo}</div>
      <div className="msg">{mensaje}</div>
    </div>
  );
}
