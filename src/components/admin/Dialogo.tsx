"use client";

import { useEffect, useId, useRef } from "react";
import css from "./admin.module.css";

interface Props {
  abierto: boolean;
  titulo: string;
  /** Pinta el título en rojo (acciones que borran). */
  peligro?: boolean;
  /** Se llama al cerrar con Esc o con el botón de cancelar. */
  onCerrar: () => void;
  children: React.ReactNode;
}

/** Ventana de confirmación basada en <dialog>: el navegador se encarga del foco, de Esc y de bloquear lo de atrás. */
export default function Dialogo({ abierto, titulo, peligro, onCerrar, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog ref={ref} className={css.dialogo} aria-labelledby={idTitulo} onClose={onCerrar}>
      {abierto && (
        <div className={css.dialogoCuerpo}>
          <h2 id={idTitulo} className={`${css.dialogoTitulo} ${peligro ? css.dialogoTituloPeligro : ""}`}>
            {titulo}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
