"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, esSesionVencida, mensajeDeError } from "./api";
import CampoFormulario, { type CampoFormularioProps } from "./CampoFormulario";
import {
  cambiosDeMiContrato, erroresDeMiContrato, formCompleto, formatearValorTotal, formDeDatos, LARGO_MAXIMO,
  MI_CONTRATO_VACIO, primerCampoConError, validarMiContrato,
  type CampoMiContrato, type ErroresMiContrato, type FormMiContrato,
} from "./miContrato";
import type { DatosMiContrato, RespGuardarMiContrato, Resumen } from "./tipos";

interface Props {
  /** true: pantalla "Antes de empezar" (primera vez, perfil incompleto). false: "Mis datos del contrato". */
  inicial: boolean;
  cargar: () => Promise<DatosMiContrato>;
  guardar: (cambios: Partial<FormMiContrato>) => Promise<RespGuardarMiContrato>;
  avisar: (msg: string) => void;
  limpiarAviso: () => void;
  /** Solo en "Mis datos del contrato". */
  onVolver: () => void;
  /** Solo en "Antes de empezar". */
  onSalir: () => void;
  onGuardado: (contrato: Resumen) => void;
}

type Carga = { estado: "cargando" } | { estado: "error"; msg: string } | { estado: "listo"; original: FormMiContrato };
type Pendiente = { contrato: Resumen; aviso: string };

/**
 * Los datos del contrato que salen en la cuenta de cobro. Una sola pantalla para dos momentos:
 * "Antes de empezar" (primera vez: manda todo) y "Mis datos del contrato" (después: manda solo lo que cambió).
 */
export default function PasoMiContrato({ inicial, cargar, guardar, avisar, limpiarAviso, onVolver, onSalir, onGuardado }: Props) {
  const [carga, setCarga] = useState<Carga>({ estado: "cargando" });
  const [intento, setIntento] = useState(0);
  const [form, setForm] = useState<FormMiContrato>(MI_CONTRATO_VACIO);
  const [errores, setErrores] = useState<ErroresMiContrato>({});
  const [ocupado, setOcupado] = useState(false);
  const [sinCambios, setSinCambios] = useState(false);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const franja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelado = false;
    cargar()
      .then((datos) => {
        if (cancelado) return;
        const f = formDeDatos(datos);
        setForm(f);
        setCarga({ estado: "listo", original: f });
      })
      .catch((e) => {
        // con 401 el padre ya nos llevó al paso 1
        if (!cancelado && !esSesionVencida(e)) setCarga({ estado: "error", msg: mensajeDeError(e) });
      });
    return () => { cancelado = true; };
    // `cargar` es una función nueva en cada pintada del padre: solo importa recargar al reintentar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intento]);

  // el aviso del valor total aparece junto al campo: que se vea sin tener que buscarlo
  useEffect(() => {
    if (pendiente) franja.current?.scrollIntoView({ block: "center" });
  }, [pendiente]);

  function reintentar() {
    setCarga({ estado: "cargando" });
    setIntento((n) => n + 1);
  }

  function poner(campo: CampoMiContrato, valor: string) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setErrores((prev) => ({ ...prev, [campo]: undefined }));
    setSinCambios(false);
    setPendiente(null); // el aviso era sobre lo que ya se guardó: al editar, se vuelve a guardar y se revisa de nuevo
  }

  function enfocar(campo: CampoMiContrato) {
    setTimeout(() => document.getElementById("mc-" + campo)?.focus(), 0);
  }

  function seguir(contrato: Resumen) {
    if (inicial && !contrato.perfilCompleto) {
      avisar("Todavía falta: " + contrato.faltan.join(", ") + ".");
      return;
    }
    onGuardado(contrato);
  }

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (carga.estado !== "listo" || ocupado) return;
    limpiarAviso();

    const locales = validarMiContrato(form);
    const primeroLocal = primerCampoConError(locales);
    if (primeroLocal) {
      setErrores(locales);
      avisar("No se guardó. Revisa los campos marcados en rojo.");
      enfocar(primeroLocal);
      return;
    }

    const cambios = inicial ? formCompleto(form) : cambiosDeMiContrato(carga.original, form);
    if (Object.keys(cambios).length === 0) {
      setSinCambios(true);
      return;
    }
    setErrores({});
    setOcupado(true);
    try {
      const r = await guardar(cambios);
      const guardado = formDeDatos(r.datos);
      setForm(guardado);
      setCarga({ estado: "listo", original: guardado });
      if (r.aviso) setPendiente({ contrato: r.contrato, aviso: r.aviso });
      else seguir(r.contrato);
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

  const campo = (c: CampoMiContrato, etiqueta: string, extra: Partial<CampoFormularioProps> = {}) => (
    <CampoFormulario
      id={"mc-" + c}
      maxLength={LARGO_MAXIMO[c]}
      etiqueta={etiqueta}
      valor={form[c]}
      error={errores[c]}
      onCambio={(v) => poner(c, v)}
      {...extra}
    />
  );

  return (
    <section>
      <h2 className="titulo-paso">{inicial ? "Antes de empezar, completa tus datos" : "Mis datos del contrato"}</h2>
      <p className="ayuda">
        {inicial
          ? "Esto se hace una sola vez. Lo que escribas aquí sale en tu cuenta de cobro."
          : "Cámbialos solo si algo de tu contrato cambió, por ejemplo con una prórroga. Tu supervisor verá el cambio."}
      </p>
      <p className="ayuda">Los campos con * son obligatorios.</p>

      {carga.estado === "cargando" && <p className="ayuda" role="status">Cargando tus datos…</p>}

      {carga.estado === "error" && (
        <>
          <div className="aviso error" role="alert">{carga.msg}</div>
          <button type="button" className="link" onClick={reintentar}>Intentar de nuevo</button>
          <div className="relleno" aria-hidden="true" />
          <div className="barra-fija">
            <button type="button" className="btn sec" onClick={inicial ? onSalir : onVolver}>{inicial ? "Salir" : "Volver"}</button>
          </div>
        </>
      )}

      {carga.estado === "listo" && (
        <form onSubmit={enviar} noValidate>
          <div className="seccion seccion-primera">
            <h3>Tus datos</h3>
            {campo("direccion", "Dirección", { autoComplete: "street-address" })}
            {campo("telefono", "Teléfono", { tipo: "tel", autoComplete: "tel" })}
            {campo("ciudad", "Ciudad", { autoComplete: "address-level2" })}
            {campo("correo", "Correo", { tipo: "email", autoComplete: "email", opcional: true })}
          </div>

          <div className="seccion">
            <h3>Tu contrato</h3>
            {campo("cargo", "Cargo")}
            {campo("objeto", "Objeto del contrato", { tipo: "area" })}
            <div className="dos">
              {campo("inicio", "Fecha de inicio", { tipo: "date" })}
              {campo("fin", "Fecha de fin", { tipo: "date" })}
            </div>
            {campo("valorTotal", "Valor total del contrato", {
              tipo: "dinero",
              ayuda: "El que dice tu contrato o tu última acta de prórroga y adición, incluyendo las adiciones.",
              // solo le pone los puntos de miles; no toca el aviso (si no, desaparece al tocar "Continuar de todas formas")
              onSalida: () => setForm((prev) => ({ ...prev, valorTotal: formatearValorTotal(prev.valorTotal) })),
            })}
            {pendiente && (
              <div className="estado rev" role="status" ref={franja}>
                <p className="estado-frase">Revisa esto</p>
                <p>{pendiente.aviso}</p>
                <button type="button" className="btn sec btn-en-franja" onClick={() => seguir(pendiente.contrato)}>
                  Continuar de todas formas
                </button>
              </div>
            )}
          </div>

          <div className="seccion">
            <h3>Quién revisa tu cuenta</h3>
            {campo("revisoNombre", "Nombre")}
            {campo("revisoCargo", "Cargo de quien revisa")}
          </div>

          {sinCambios && <p className="ayuda" role="status">Todavía no cambiaste nada.</p>}

          {inicial && <button type="button" className="link" onClick={onSalir} disabled={ocupado}>Salir</button>}

          <div className="relleno" aria-hidden="true" />

          <div className="barra-fija">
            <button type="submit" className="btn" disabled={ocupado}>
              {ocupado ? "Guardando…" : inicial ? "Guardar y continuar" : "Guardar cambios"}
            </button>
            {!inicial && <button type="button" className="btn sec" onClick={onVolver} disabled={ocupado}>Volver</button>}
          </div>
        </form>
      )}
    </section>
  );
}
