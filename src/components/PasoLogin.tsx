"use client";

import { useEffect, useState } from "react";
import { llamar, mensajeDeError } from "./api";
import { tituloNombre } from "./formato";
import type { RespNombres } from "./tipos";

interface Props {
  avisar: (msg: string) => void;
  limpiarAviso: () => void;
  onEntrar: (nombre: string, pin: string) => Promise<void>;
}

type Lista = { estado: "cargando" } | { estado: "error" } | { estado: "ok"; nombres: string[] };

/** Paso 1: nombre + PIN (últimos 4 de la cédula). */
export default function PasoLogin({ avisar, limpiarAviso, onEntrar }: Props) {
  const [lista, setLista] = useState<Lista>({ estado: "cargando" });
  const [intento, setIntento] = useState(0);
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  const [verPin, setVerPin] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    llamar<RespNombres>("/api/contratistas")
      .then((r) => { if (!cancelado) setLista({ estado: "ok", nombres: r.nombres }); })
      .catch((e) => {
        if (cancelado) return;
        setLista({ estado: "error" });
        avisar(mensajeDeError(e));
      });
    return () => { cancelado = true; };
  }, [intento, avisar]);

  function reintentar() {
    limpiarAviso();
    setLista({ estado: "cargando" });
    setIntento((n) => n + 1);
  }

  async function entrar(ev: React.FormEvent) {
    ev.preventDefault();
    limpiarAviso();
    const p = pin.trim();
    if (!nombre) { avisar("Escoge tu nombre en la lista."); return; }
    if (!/^\d{4}$/.test(p)) { avisar("Escribe tu PIN: son 4 números (los últimos 4 de tu cédula)."); return; }
    setOcupado(true);
    try {
      await onEntrar(nombre, p);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section>
      <p className="paso">Paso 1 de 4 · Entrar</p>
      <h2>¿Quién eres?</h2>
      <form className="card" onSubmit={entrar} noValidate>
        <div className="campo">
          <label htmlFor="nombre">Escoge tu nombre</label>
          <select id="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)}>
            {lista.estado === "cargando" && <option value="">Cargando la lista…</option>}
            {lista.estado === "error" && <option value="">No se pudo cargar la lista</option>}
            {lista.estado === "ok" && (
              <>
                <option value="">Escoge tu nombre…</option>
                {lista.nombres.map((n) => (
                  <option key={n} value={n}>{tituloNombre(n)}</option>
                ))}
              </>
            )}
          </select>
          {lista.estado === "error" && (
            <button type="button" className="link" onClick={reintentar}>Intentar de nuevo</button>
          )}
        </div>
        <div className="campo">
          <label htmlFor="pin">Tu PIN (4 números)</label>
          <div className="pin-wrap">
            <input
              id="pin"
              type={verPin ? "text" : "password"}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="off"
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
            <button
              type="button"
              aria-label="Mostrar u ocultar el PIN"
              aria-pressed={verPin}
              onClick={() => setVerPin((v) => !v)}
            >
              {verPin ? "Ocultar" : "Ver"}
            </button>
          </div>
          <p className="ayuda" style={{ marginTop: 6 }}>
            Tu PIN son los <strong>últimos 4 números de tu cédula</strong>.
          </p>
        </div>
        <button className="btn" type="submit" disabled={ocupado} style={{ marginBottom: 0 }}>Entrar</button>
      </form>
    </section>
  );
}
