/** Progreso de los 4 pasos: es una secuencia real, por eso va en segmentos. */
export default function Progreso({ paso }: { paso: 1 | 2 | 3 | 4 }) {
  return (
    <div className="progreso">
      <p className="progreso-texto">Paso {paso} de 4</p>
      <div className="progreso-segmentos" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= paso ? "hecho" : undefined} />
        ))}
      </div>
    </div>
  );
}
