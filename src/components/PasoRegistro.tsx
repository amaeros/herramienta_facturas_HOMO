"use client";

import { useState } from "react";
import { ApiError, mensajeDeError, postJson } from "./api";
import CampoFormulario, { type CampoFormularioProps } from "./CampoFormulario";
import { formatearValorTotal } from "./miContrato";
import {
  erroresDeRegistro, LARGO_MAXIMO_REGISTRO, NIVELES_RIESGO, payloadDeRegistro, primerCampoConErrorRegistro, REGISTRO_VACIO,
  validarRegistro, type CampoRegistro, type ErroresRegistro, type FormRegistro,
} from "./registro";

interface Props {
  avisar: (msg: string) => void;
  limpiarAviso: () => void;
  /** Vuelve a la pantalla de entrar. */
  onVolver: () => void;
}

/** "Crea tu cuenta": la contratista nueva llena sus datos y el supervisor los aprueba. Después de enviar muestra la confirmación. */
export default function PasoRegistro({ avisar, limpiarAviso, onVolver }: Props) {
  const [form, setForm] = useState<FormRegistro>(REGISTRO_VACIO);
  const [errores, setErrores] = useState<ErroresRegistro>({});
  const [ocupado, setOcupado] = useState(false);
  const [enviada, setEnviada] = useState(false);
  // campo trampa: una persona no lo ve; un robot sí lo llena
  const [trampa, setTrampa] = useState("");

  function poner(campo: CampoRegistro, valor: string) {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setErrores((prev) => ({ ...prev, [campo]: undefined }));
  }

  function enfocar(campo: CampoRegistro) {
    setTimeout(() => document.getElementById("rg-" + campo)?.focus(), 0);
  }

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (ocupado) return;
    limpiarAviso();

    const locales = validarRegistro(form);
    const primeroLocal = primerCampoConErrorRegistro(locales);
    if (primeroLocal) {
      setErrores(locales);
      avisar("No se envió. Revisa los campos marcados en rojo.");
      enfocar(primeroLocal);
      return;
    }
    setErrores({});
    setOcupado(true);
    try {
      await postJson("/api/registro", payloadDeRegistro(form, trampa));
      setEnviada(true);
      window.scrollTo(0, 0);
    } catch (e) {
      const delServidor = e instanceof ApiError ? erroresDeRegistro(e.campos) : {};
      const primero = primerCampoConErrorRegistro(delServidor);
      if (primero) {
        setErrores(delServidor);
        avisar("No se envió. Revisa los campos marcados en rojo.");
        enfocar(primero);
      } else {
        avisar(mensajeDeError(e));
      }
    } finally {
      setOcupado(false);
    }
  }

  if (enviada) {
    return (
      <section>
        <h2 className="titulo-paso">Tu solicitud quedó enviada</h2>
        <div className="estado gris" role="status">
          <p className="estado-frase">Falta la aprobación de tu supervisor</p>
          <p>Tu supervisor la revisará; cuando la apruebe podrás entrar con tu nombre y tu PIN.</p>
          <p>Tu PIN son los últimos 4 números de tu cédula.</p>
        </div>
        <div className="relleno" aria-hidden="true" />
        <div className="barra-fija">
          <button type="button" className="btn" onClick={onVolver}>Volver al inicio</button>
        </div>
      </section>
    );
  }

  const campo = (c: CampoRegistro, etiqueta: string, extra: Partial<CampoFormularioProps> = {}) => (
    <CampoFormulario
      id={"rg-" + c}
      maxLength={LARGO_MAXIMO_REGISTRO[c]}
      etiqueta={etiqueta}
      valor={form[c]}
      error={errores[c]}
      onCambio={(v) => poner(c, v)}
      {...extra}
    />
  );

  return (
    <section>
      <h2 className="titulo-paso">Crea tu cuenta</h2>
      <p className="ayuda">Llena tus datos una sola vez. Tu supervisor los revisa y aprueba tu cuenta. Los campos con * son obligatorios.</p>
      <div className="aviso info">Tu PIN para entrar serán los <strong>últimos 4 números de tu cédula</strong>.</div>

      <form onSubmit={enviar} noValidate>
        <div className="seccion seccion-primera">
          <h3>Tus datos</h3>
          {campo("nombre", "Nombre completo", { autoComplete: "name" })}
          {campo("cedula", "Cédula", { autoComplete: "off", ayuda: "Solo números, sin puntos." })}
          {campo("cargo", "Tu cargo", { ayuda: "El de tu contrato, por ejemplo: Profesional universitaria o Apoyo técnico. Sale en tu cuenta de cobro debajo de tu nombre." })}
          {campo("direccion", "Dirección", { autoComplete: "street-address" })}
          {campo("telefono", "Teléfono", { tipo: "tel", autoComplete: "tel" })}
          {campo("ciudad", "Ciudad", { autoComplete: "address-level2" })}
          {campo("correo", "Correo", { tipo: "email", autoComplete: "email", opcional: true })}
        </div>

        <div className="seccion">
          <h3>Tu contrato</h3>
          {campo("linea", "Equipo o línea")}
          {campo("numeroContrato", "Número de contrato")}
          {campo("objeto", "Objeto del contrato", { tipo: "area" })}
          <div className="dos">
            {campo("inicio", "Fecha de inicio", { tipo: "date" })}
            {campo("fin", "Fecha de fin", { tipo: "date" })}
          </div>
          {campo("honorario", "Honorario mensual", {
            tipo: "dinero",
            ayuda: "Ejemplo: 4.009.000",
            onSalida: () => setForm((prev) => ({ ...prev, honorario: formatearValorTotal(prev.honorario) })),
          })}
          {campo("valorTotal", "Valor total del contrato", {
            tipo: "dinero",
            ayuda: "El que dice tu contrato o tu última acta de prórroga y adición, incluyendo las adiciones.",
            onSalida: () => setForm((prev) => ({ ...prev, valorTotal: formatearValorTotal(prev.valorTotal) })),
          })}
          <div className="campo">
            <label htmlFor="rg-riesgo">
              Riesgo ARL<span className="marca-obligatorio" aria-hidden="true"> *</span>
            </label>
            <p id="rg-riesgo-ayuda" className="ayuda ayuda-campo">El que aparece en tu planilla de seguridad social (I a V).</p>
            <select
              id="rg-riesgo"
              value={form.riesgo}
              aria-required="true"
              aria-invalid={errores.riesgo ? true : undefined}
              aria-describedby={"rg-riesgo-ayuda" + (errores.riesgo ? " rg-riesgo-error" : "")}
              onChange={(e) => poner("riesgo", e.target.value)}
            >
              <option value="">Escoge el riesgo…</option>
              {NIVELES_RIESGO.map((n) => <option key={n} value={n}>Riesgo {n}</option>)}
            </select>
            {errores.riesgo && <p id="rg-riesgo-error" className="error-campo">{errores.riesgo}</p>}
          </div>
        </div>

        <div className="seccion">
          <h3>Quién revisa tu cuenta</h3>
          {campo("revisoNombre", "Nombre")}
          {campo("revisoCargo", "Cargo de quien revisa")}
        </div>

        {/* campo trampa: no se ve, no se alcanza con el teclado y debe quedar vacío */}
        <div className="oculto" aria-hidden="true">
          <label htmlFor="rg-sitio_web">No llenes este campo</label>
          <input
            id="rg-sitio_web"
            name="sitio_web"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={trampa}
            onChange={(e) => setTrampa(e.target.value)}
          />
        </div>

        <div className="relleno" aria-hidden="true" />

        <div className="barra-fija">
          <button type="submit" className="btn" disabled={ocupado}>{ocupado ? "Enviando…" : "Enviar solicitud"}</button>
          <button type="button" className="btn sec" onClick={onVolver} disabled={ocupado}>Volver</button>
        </div>
      </form>
    </section>
  );
}
