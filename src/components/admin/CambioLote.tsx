"use client";

import { useState } from "react";
import { AdminError, apiAdmin, textoError, type Contrato, type RespuestaLote } from "./apiAdmin";
import CampoAdmin from "./CampoAdmin";
import { resumenLote } from "./helpers";
import css from "./admin.module.css";

interface Props {
  /** Las trabajadoras que se escogieron en la tabla. */
  escogidas: Contrato[];
  /** `huboCambios` = al menos una se cambió (la lista se vuelve a pedir). */
  onTerminar: (huboCambios: boolean) => void;
}

type Errores = { fin?: string; inicio?: string };

/** "Cambiar a varias": la fecha de fin y/o la de inicio de las trabajadoras escogidas, con un resumen de lo que pasó con cada una. */
export default function CambioLote({ escogidas, onTerminar }: Props) {
  const [fin, setFin] = useState("");
  const [inicio, setInicio] = useState("");
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<RespuestaLote | null>(null);

  async function aplicar(ev: React.FormEvent) {
    ev.preventDefault();
    setErrorGeneral("");
    const e: Errores = {};
    if (!fin && !inicio) e.fin = "Escribe la fecha de fin, la de inicio o las dos.";
    else if (fin && inicio && fin < inicio) e.fin = "La fecha de fin no puede ser anterior a la de inicio.";
    if (e.fin || e.inicio) {
      setErrores(e);
      setErrorGeneral("Hay datos por corregir. Revisa los campos marcados en rojo.");
      setTimeout(() => document.getElementById("l-fin")?.focus(), 0);
      return;
    }
    setErrores({});
    setOcupado(true);
    try {
      const cambios: { fin?: string; inicio?: string } = {};
      if (fin) cambios.fin = fin;
      if (inicio) cambios.inicio = inicio;
      setResultado(await apiAdmin.lote(escogidas.map((c) => c.id), cambios));
    } catch (x) {
      if (x instanceof AdminError && x.status === 401) return; // el panel vuelve a pedir la contraseña
      const delServidor = x instanceof AdminError ? (x.campos ?? {}) : {};
      if (delServidor.fin || delServidor.inicio) setErrores({ fin: delServidor.fin, inicio: delServidor.inicio });
      setErrorGeneral(textoError(x));
    } finally {
      setOcupado(false);
    }
  }

  if (resultado) {
    const fallos = resultado.resultados.filter((r) => !r.ok);
    return (
      <div className={css.panelCuerpo}>
        <div className={css.panelCabecera}>
          <h2 className={css.h1}>Cambiar a varias</h2>
        </div>
        <div className={`aviso ${fallos.length === 0 ? "info" : "warn"}`} role="status">
          <strong>{resumenLote(resultado.aplicadas, resultado.resultados.length)}</strong>
        </div>
        {fallos.length > 0 && (
          <div className={css.bloque}>
            <h3 className={css.h2}>Estas no se cambiaron</h3>
            <ul className={css.items}>
              {fallos.map((r) => (
                <li key={r.id}>
                  <strong>{r.nombre || "Trabajadora"}</strong>
                  <span className={css.sub}>{r.error}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className={css.panelBarra}>
          <button type="button" className={css.btn} onClick={() => onTerminar(resultado.aplicadas > 0)}>Listo</button>
        </div>
      </div>
    );
  }

  const n = escogidas.length;
  return (
    <div className={css.panelCuerpo}>
      <div className={css.panelCabecera}>
        <h2 className={css.h1}>Cambiar a varias</h2>
        <button type="button" className={css.volver} onClick={() => onTerminar(false)}>Cerrar</button>
      </div>
      <p className={css.lead}>
        Cambia la fecha de fin, la de inicio o las dos de {n === 1 ? "la trabajadora escogida" : `las ${n} trabajadoras escogidas`}. Solo se cambia lo que escribas.
      </p>

      <details className={css.recientes} style={{ marginTop: 0 }}>
        <summary className={css.recientesResumen}>{n === 1 ? "1 trabajadora escogida" : `${n} trabajadoras escogidas`}</summary>
        <ul className={css.items}>
          {escogidas.map((c) => <li key={c.id}>{c.nombre}</li>)}
        </ul>
      </details>

      {errorGeneral && <div className="aviso error" role="alert">{errorGeneral}</div>}

      <form onSubmit={aplicar} noValidate>
        <div className={css.rejilla2} style={{ marginTop: 16 }}>
          <CampoAdmin
            campo="fin"
            prefijo="l-"
            etiqueta="Nueva fecha de fin"
            valor={fin}
            onCambio={(v) => { setFin(v); setErrores((p) => ({ ...p, fin: undefined })); }}
            error={errores.fin}
            tipo="date"
            opcional
            hint="Para una prórroga igual para todas."
          />
          <CampoAdmin
            campo="inicio"
            prefijo="l-"
            etiqueta="Nueva fecha de inicio"
            valor={inicio}
            onCambio={(v) => { setInicio(v); setErrores((p) => ({ ...p, inicio: undefined })); }}
            error={errores.inicio}
            tipo="date"
            opcional
            hint="El acumulado se suma desde esta fecha."
          />
        </div>
        <p className={css.pista} style={{ marginTop: 0 }}>
          A cada una se le aplican las mismas revisiones que al editarla. Cada cambio queda en su historial y los acumulados se recalculan. Las cuentas de cobro ya enviadas no cambian.
        </p>
        <div className={css.panelBarra}>
          <button type="submit" className={css.btn} disabled={ocupado}>
            {ocupado ? "Aplicando…" : n === 1 ? "Aplicar a 1 trabajadora" : `Aplicar a ${n} trabajadoras`}
          </button>
          <button type="button" className={`${css.btn} ${css.btnSec}`} onClick={() => onTerminar(false)} disabled={ocupado}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
