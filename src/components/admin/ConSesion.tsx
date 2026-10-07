"use client";

import { createContext, useContext } from "react";

/** true cuando el supervisor ya entró en esta visita (se mantiene aunque la sesión venza, para no perder lo que estaba haciendo). */
export const YaEntroContext = createContext(false);

/**
 * Las pantallas del panel se ponen dentro de esto: no se dibujan ni piden datos hasta que haya sesión.
 * (El contenedor sí deja pasar `children` siempre, porque Next 16 valida que cada segmento se renderice.)
 */
export default function ConSesion({ children }: { children: React.ReactNode }) {
  const yaEntro = useContext(YaEntroContext);
  return yaEntro ? <>{children}</> : null;
}
