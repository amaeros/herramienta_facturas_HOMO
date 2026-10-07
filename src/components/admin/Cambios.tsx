"use client";

import { useId, useState } from "react";
import { apiAdmin, type CambioContrato } from "./apiAdmin";
import { contarDeContratistas, fmtFechaHoraCambio, lineaCambio, TEXTO_ALERTA_CAMBIO, textoAutorCambio } from "./helpers";
import { useDatos } from "./useDatos";
import css from "./admin.module.css";

interface TablaProps {
  lista: CambioContrato[];
  /** En la lista general, una columna con el nombre de la trabajadora. */
  conNombre?: boolean;
}

/**
 * Tabla de cambios al contrato. La franja de color marca los que hizo la contratista (para revisar);
 * los que tienen alerta (valor total distinto al esperado) llevan además el texto que lo dice.
 */
function TablaCambios({ lista, conNombre }: TablaProps) {
  return (
    <div className={css.tablaCaja}>
      <table className={css.tabla}>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            {conNombre && <th scope="col">Trabajadora</th>}
            <th scope="col">Quién</th>
            <th scope="col">Cambio</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((c) => (
            <tr key={c.id} className={c.alerta || c.autor === "contratista" ? css.estRev : css.estNeutro}>
              <td data-label="Fecha">{fmtFechaHoraCambio(c.creado)}</td>
              {conNombre && <td data-label="Trabajadora" className={css.nombreFila}>{c.nombre}</td>}
              <td data-label="Quién"><span className={css.estadoTxt}>{textoAutorCambio(c.autor)}</span></td>
              <td data-label="Cambio">
                {lineaCambio(c)}
                {c.alerta && <span className={css.alertaCambio}>{TEXTO_ALERTA_CAMBIO}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sección "Historial de cambios" dentro del panel de una trabajadora. */
export function HistorialCambios({ contratoId }: { contratoId: number }) {
  const idTitulo = useId();
  const { datos, error, cargando, recargar } = useDatos(`cambios-${contratoId}`, () => apiAdmin.cambios(contratoId));

  return (
    <section className={css.historial} aria-labelledby={idTitulo}>
      <h3 id={idTitulo} className={css.h2}>Historial de cambios</h3>
      {cargando && <p className={css.pista} role="status">Cargando el historial…</p>}
      {error && (
        <div className="aviso error" role="alert">
          {error}{" "}
          <button type="button" className={css.btnLink} onClick={recargar}>Intentar de nuevo</button>
        </div>
      )}
      {datos && (datos.length === 0 ? <p className={css.pista}>Sin cambios registrados.</p> : <TablaCambios lista={datos} />)}
    </section>
  );
}

/**
 * "Cambios recientes" de la página Trabajadoras: los últimos 10 de todas.
 * Se abre sola cuando hay cambios hechos por contratistas, que son los que el supervisor debe mirar.
 */
export function CambiosRecientes({ version }: { version: number }) {
  const { datos, error, cargando, recargar } = useDatos(`cambios-recientes-${version}`, async () => (await apiAdmin.cambios()).slice(0, 10));
  const [abierto, setAbierto] = useState<boolean | null>(null);
  const deContratistas = datos ? contarDeContratistas(datos) : 0;

  return (
    <details
      className={css.recientes}
      open={abierto ?? deContratistas > 0}
      onToggle={(e) => setAbierto(e.currentTarget.open)}
    >
      <summary className={css.recientesResumen}>
        Cambios recientes
        {deContratistas > 0 && (
          <span className={css.recientesNota}>
            {deContratistas === 1 ? "1 hecho por una contratista" : `${deContratistas} hechos por contratistas`}
          </span>
        )}
      </summary>
      <div className={css.recientesCuerpo}>
        {cargando && <p className={css.pista} role="status">Cargando los cambios…</p>}
        {error && (
          <div className="aviso error" role="alert">
            {error}{" "}
            <button type="button" className={css.btnLink} onClick={recargar}>Intentar de nuevo</button>
          </div>
        )}
        {datos && (datos.length === 0 ? <p className={css.pista}>Sin cambios registrados.</p> : <TablaCambios lista={datos} conNombre />)}
      </div>
    </details>
  );
}
