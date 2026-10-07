"use client";

import { useEffect, useRef } from "react";
import css from "./admin.module.css";

interface Props {
  abierto: boolean;
  /** Nombre del panel para quien usa lector de pantalla. */
  titulo: string;
  /** Se llama al cerrar con Esc. */
  onCerrar: () => void;
  children: React.ReactNode;
}

/** Panel que entra por la derecha (pantalla completa en celular). Usa <dialog>: el navegador cuida el foco y la tecla Esc. */
export default function PanelLateral({ abierto, titulo, onCerrar, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog ref={ref} className={css.panel} aria-label={titulo} onClose={onCerrar}>
      {abierto && children}
    </dialog>
  );
}
