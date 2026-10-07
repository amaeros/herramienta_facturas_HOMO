/** Pantalla de espera mientras se lee la planilla o se genera la cuenta de cobro. */
export default function Cargando({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <section>
      <div className="cargando" role="status" aria-live="polite">
        <div className="rueda" aria-hidden="true" />
        <h2>{titulo}</h2>
        <p className="ayuda">{texto}</p>
      </div>
    </section>
  );
}
