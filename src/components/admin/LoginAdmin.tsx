"use client";

import { useState } from "react";
import { apiAdmin, textoError } from "./apiAdmin";
import css from "./admin.module.css";

interface Props {
  /** Mensaje que explica por qué se pide la contraseña (por ejemplo, "Tu sesión de administrador venció"). */
  aviso?: string;
  onEntrar: () => void;
}

/** Formulario de contraseña del panel. */
export default function LoginAdmin({ aviso, onEntrar }: Props) {
  const [clave, setClave] = useState("");
  const [ver, setVer] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!clave) {
      setError("Escribe la contraseña.");
      return;
    }
    setError("");
    setOcupado(true);
    try {
      await apiAdmin.entrar(clave);
      setClave("");
      onEntrar();
    } catch (e) {
      setError(textoError(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className={css.paginaAngosta} role="main">
      <h1 className={css.h1}>Entra al panel</h1>
      <p className={css.lead}>Escribe la contraseña de administrador para ver las cuentas de cobro.</p>

      {aviso && (
        <div className="aviso warn" role="alert">
          {aviso}
        </div>
      )}

      <form onSubmit={enviar} noValidate>
        <div className={css.campo}>
          <label className={css.etiqueta} htmlFor="admin-clave">
            Contraseña
          </label>
          <div className="pin-wrap">
            <input
              id="admin-clave"
              type={ver ? "text" : "password"}
              autoComplete="current-password"
              autoFocus
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "admin-clave-error" : undefined}
            />
            <button type="button" aria-pressed={ver} aria-label="Mostrar u ocultar la contraseña" onClick={() => setVer((v) => !v)}>
              {ver ? "Ocultar" : "Ver"}
            </button>
          </div>
          {error && (
            <p id="admin-clave-error" className={css.errorCampo} role="alert">
              {error}
            </p>
          )}
        </div>
        <button className={`${css.btn} ${css.btnAncho}`} type="submit" disabled={ocupado}>
          {ocupado ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
