"use client";

import { useEffect, useState } from "react";
import { ApiError, esSesionVencida, mensajeDeError } from "./api";
import {
  cambiosDeMiContrato, erroresDeMiContrato, MI_CONTRATO_VACIO, primerCampoConError,
  type CampoMiContrato, type ErroresMiContrato,
} from "./miContrato";
import type { DatosMiContrato, Resumen } from "./tipos";

interface Props {
  cargar: () => Promise<DatosMiContrato>;
  guardar: (cambios: Partial<DatosMiContrato>) => Promise<Resumen>;
  avisar: (msg: string) => void;
  limpiarAviso: () => void;
  onVolver: () => void;
  onGuardado: (contrato: Resumen) => void;
}

type Carga = { estado: "cargando" } | { estado: "error"; msg: string } | { estado: "listo"; original: DatosMiContrato };

interface CampoProps {
  campo: CampoMiContrato;
  etiqueta: string;
  valor: string;
  error?: string;
  tipo: "date" | "text";
  onCambio: (v: string) => void;
}

function Campo({ campo, etiqueta, valor, error, tipo, onCambio }: CampoProps) {
  const id = "mc-" + campo;
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <input
        id={id}
        type={tipo}
        value={valor}
        maxLength={tipo === "text" ? 120 : undefined}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? id + "-error" : undefined}
        onChange={(e) => onCambio(e.target.value)}
      />
      {error && <p id={id + "-error"} className="error-campo">{error}</p>}
    </div>
  );
}

/** Vista "Mis datos del contrato": fechas del contrato y quién revisa la cuenta. Solo manda lo que cambió. */
export default function PasoMiContrato({ cargar, guardar, avisar, limpiarAviso, onVolver, onGuardado }: Props) {
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });
  const [intento, setIntento] = useState(0);
  const [form, setForm] = useState<DatosMiContrato>(MI_CONTRATO_VACIO);
  const [errores, setErrores] = useState<ErroresMiContrato>({});
  const [ocupado, setOcupado] = useState(false);
  const [sinCambios, setSinCambios] = useState(false);

  useEffect(() => {
    let cancelado = false;
    cargar()
      .then((datos) => {
        if (cancelado) return;
        setForm(datos);
        setCarga({ estado: "listo", original: datos });
      })
      .catch((e) => {
        // con 401 el padre ya nos llevó al paso 1
        if (!cancelado && !esSesionVencida(e)) setCarga({ estado: "error", msg: mensajeDeError(e) });
      });
    return () => { cancelado = true; };
    // `cargar` es una función nueva en cada pintada del padre: solo importa recargar al reintentar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intento]);

  function reintentar() {
    setCarga({ estado: "cargando" });
    setIntento((n) => n + 1);
  }

  function poner(campo: CampoMiContrato, valor: string) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setErrores((prev) => ({ ...prev, [campo]: undefined }));
    setSinCambios(false);
  }

  function enfocar(campo: CampoMiContrato) {
    setTimeout(() => document.getElementById("mc-" + campo)?.focus(), 0);
  }

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (carga.estado !== "listo" || ocupado) return;
    limpiarAviso();
    const cambios = cambiosDeMiContrato(carga.original, form);
    if (Object.keys(cambios).length === 0) {
      setSinCambios(true);
      return;
    }
    setErrores({});
    setOcupado(true);
    try {
      onGuardado(await guardar(cambios));
    } catch (e) {
      if (esSesionVencida(e)) return;
      const delServidor = e instanceof ApiError ? erroresDeMiContrato(e.campos) : {};
      const primero = primerCampoConError(delServidor);
      if (primero) {
        setErrores(delServidor);
        avisar("No se guardó. Revisa los campos marcados en rojo.");
        enfocar(primero);
      } else {
        avisar(mensajeDeError(e));
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section>
      <h2 className="titulo-paso">Mis datos del contrato</h2>
      <p className="ayuda">
        Cámbialos solo si tu contrato tiene otras fechas (por ejemplo, por una prórroga). Tu supervisor verá el cambio.
      </p>

      {carga.estado === "cargando" && <p className="ayuda" role="status">Cargando tus datos…</p>}

      {carga.estado === "error" && (
        <>
          <div className="aviso error" role="alert">{carga.msg}</div>
          <button type="button" className="link" onClick={reintentar}>Intentar de nuevo</button>
          <div className="relleno" aria-hidden="true" />
          <div className="barra-fija">
            <button type="button" className="btn sec" onClick={onVolver}>Volver</button>
          </div>
        </>
      )}

      {carga.estado === "listo" && (
        <form onSubmit={enviar} noValidate>
          <div className="seccion seccion-primera">
            <h3>Vigencia</h3>
            <Campo campo="inicio" etiqueta="Fecha de inicio del contrato" tipo="date" valor={form.inicio} error={errores.inicio} onCambio={(v) => poner("inicio", v)} />
            <Campo campo="fin" etiqueta="Fecha de fin del contrato" tipo="date" valor={form.fin} error={errores.fin} onCambio={(v) => poner("fin", v)} />
          </div>

          <div className="seccion">
            <h3>Revisión de tu cuenta</h3>
            <Campo campo="revisoNombre" etiqueta="Quién revisa tu cuenta (nombre)" tipo="text" valor={form.revisoNombre} error={errores.revisoNombre} onCambio={(v) => poner("revisoNombre", v)} />
            <Campo campo="revisoCargo" etiqueta="Cargo de quien revisa" tipo="text" valor={form.revisoCargo} error={errores.revisoCargo} onCambio={(v) => poner("revisoCargo", v)} />
          </div>

          {sinCambios && <p className="ayuda" role="status">Todavía no cambiaste nada.</p>}

          <div className="relleno" aria-hidden="true" />

          <div className="barra-fija">
            <button type="submit" className="btn" disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar cambios"}</button>
            <button type="button" className="btn sec" onClick={onVolver} disabled={ocupado}>Volver</button>
          </div>
        </form>
      )}
    </section>
  );
}
