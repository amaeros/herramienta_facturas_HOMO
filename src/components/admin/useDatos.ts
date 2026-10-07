"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { textoError } from "./apiAdmin";
import { mesActualBogota, mesPorDefecto } from "./helpers";

interface Estado<T> {
  clave: string;
  version: number;
  datos?: T;
  error?: string;
}

/**
 * Carga datos del servidor cuando cambia `clave` (null = todavía no cargar).
 * `cargando` se calcula (no se guarda), así no hace falta cambiar estado dentro del efecto.
 */
export function useDatos<T>(clave: string | null, cargar: () => Promise<T>) {
  const [estado, setEstado] = useState<Estado<T> | null>(null);
  const [version, setVersion] = useState(0);
  const cargarRef = useRef(cargar);
  useEffect(() => {
    cargarRef.current = cargar;
  });

  useEffect(() => {
    if (clave === null) return;
    let vivo = true;
    cargarRef
      .current()
      .then((datos) => {
        if (vivo) setEstado({ clave, version, datos });
      })
      .catch((e) => {
        if (vivo) setEstado({ clave, version, error: textoError(e) });
      });
    return () => {
      vivo = false;
    };
  }, [clave, version]);

  const actual = estado && estado.clave === clave && estado.version === version ? estado : null;

  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  /** Cambia los datos ya cargados (por ejemplo, tras guardar una fila) sin volver a pedirlos. */
  const modificar = useCallback((f: (d: T) => T) => {
    setEstado((prev) => (prev && prev.datos !== undefined ? { ...prev, datos: f(prev.datos) } : prev));
  }, []);

  return {
    datos: actual?.datos,
    error: actual?.error,
    cargando: clave !== null && !actual,
    recargar,
    modificar,
  };
}

const sinSuscripcion = () => () => {};

/** Mes por defecto (el anterior al actual, hora de Bogotá). Vacío en el servidor: la hora solo se lee en el navegador. */
export function useMesPorDefecto(): string {
  return useSyncExternalStore(sinSuscripcion, () => mesPorDefecto(new Date()), () => "");
}

/** Mes actual 'AAAA-MM' en Bogotá. Vacío en el servidor. */
export function useMesActual(): string {
  return useSyncExternalStore(sinSuscripcion, () => mesActualBogota(new Date()), () => "");
}
