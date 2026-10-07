import Hoja, { type HojaDatos } from "./Hoja";

/** Pantalla de espera mientras se lee la planilla o se genera la cuenta de cobro: la hoja con barrido en lo que falta. */
export default function Cargando({ titulo, texto, hoja }: { titulo: string; texto: string; hoja: HojaDatos }) {
  return (
    <section>
      <div role="status" aria-live="polite">
        <h2 className="titulo-paso">{titulo}</h2>
        <p className="ayuda">{texto}</p>
      </div>
      <Hoja {...hoja} cargando />
    </section>
  );
}
