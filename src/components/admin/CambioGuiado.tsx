"use client";

import { useState } from "react";
import { AdminError, apiAdmin, textoError, type Contrato } from "./apiAdmin";
import CampoAdmin from "./CampoAdmin";
import {
  avisoInicioContratoNuevo, erroresGuiadoDeCampos, formContratoNuevoInicial, formOtrosiInicial, parseEntero, payloadContratoNuevo,
  payloadOtrosi, puntos, validarContratoNuevo, validarOtrosi,
  type CampoGuiado, type ErroresGuiado, type FormContratoNuevo, type FormOtrosi,
} from "./helpers";
import { fmtFecha, fmtMoney } from "../formato";
import css from "./admin.module.css";

export type TipoCambioGuiado = "otrosi" | "nuevo";

interface Props {
  tipo: TipoCambioGuiado;
  /** La trabajadora tal como está guardada. */
  contrato: Contrato;
  onGuardado: (c: Contrato, mensaje?: string) => void;
  onVolver: () => void;
}

/** Cómo se ve hoy el contrato (para que se sepa qué se está cambiando). */
function Vigente({ c }: { c: Contrato }) {
  return (
    <dl className={css.vigente}>
      <div><dt>Contrato</dt><dd>{c.numeroContrato || "Sin número"}</dd></div>
      <div><dt>Fechas</dt><dd>{c.inicio ? fmtFecha(c.inicio) : "—"} a {c.fin ? fmtFecha(c.fin) : "—"}</dd></div>
      <div><dt>Valor total</dt><dd>{c.valorTotal === null ? "—" : fmtMoney(c.valorTotal)}</dd></div>
    </dl>
  );
}

/**
 * Dos formularios cortos para lo que más se hace con un contrato: el otrosí (prórroga o adición: el acumulado sigue
 * sumando desde el inicio) y el contrato nuevo (el acumulado vuelve a empezar). Los dos usan la edición del panel,
 * así que quedan en la bitácora y los acumulados se recalculan. Las cuentas ya enviadas no cambian.
 */
export default function CambioGuiado({ tipo, contrato, onGuardado, onVolver }: Props) {
  const [otrosi, setOtrosi] = useState<FormOtrosi>(() => formOtrosiInicial(contrato));
  const [nuevo, setNuevo] = useState<FormContratoNuevo>(() => formContratoNuevoInicial(contrato));
  const [errores, setErrores] = useState<ErroresGuiado>({});
  const [errorGeneral, setErrorGeneral] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const esOtrosi = tipo === "otrosi";

  function poner(campo: CampoGuiado, valor: string) {
    if (esOtrosi) setOtrosi((p) => ({ ...p, [campo]: valor }));
    else setNuevo((p) => ({ ...p, [campo]: valor }));
    setErrores((p) => ({ ...p, [campo]: undefined }));
  }

  function formatearDinero(campo: "valorTotal" | "honorario") {
    const valor = esOtrosi ? otrosi.valorTotal : campo === "honorario" ? nuevo.honorario : nuevo.valorTotal;
    const n = parseEntero(valor);
    if (n !== null) poner(campo, puntos(n));
  }

  function enfocar(campo: CampoGuiado) {
    setTimeout(() => document.getElementById("g-" + campo)?.focus(), 0);
  }

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setErrorGeneral("");
    const errs = esOtrosi ? validarOtrosi(otrosi, contrato) : validarContratoNuevo(nuevo);
    const primero = Object.keys(errs)[0] as CampoGuiado | undefined;
    if (primero) {
      setErrores(errs);
      setErrorGeneral("Hay datos por corregir. Revisa los campos marcados en rojo.");
      enfocar(primero);
      return;
    }
    setErrores({});
    setOcupado(true);
    try {
      const payload = esOtrosi ? payloadOtrosi(contrato, otrosi) : payloadContratoNuevo(contrato, nuevo);
      const c = await apiAdmin.editarContrato(contrato.id, payload);
      onGuardado(
        c,
        esOtrosi ? `Se registró el otrosí de ${c.nombre}.` : `Se registró el contrato nuevo de ${c.nombre}.`,
      );
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) return; // el panel vuelve a pedir la contraseña
      const delServidor = e instanceof AdminError ? erroresGuiadoDeCampos(e.campos) : {};
      const primero = Object.keys(delServidor)[0] as CampoGuiado | undefined;
      if (primero) {
        setErrores(delServidor);
        setErrorGeneral("No se guardó. Revisa los campos marcados en rojo.");
        enfocar(primero);
      } else {
        setErrorGeneral(textoError(e));
      }
    } finally {
      setOcupado(false);
    }
  }

  const campo = (c: CampoGuiado, etiqueta: string, extra: { tipo?: "date" | "text"; hint?: string; dinero?: boolean; ancho?: boolean } = {}) => {
    const valor = esOtrosi ? (otrosi as unknown as Record<string, string>)[c] : (nuevo as unknown as Record<string, string>)[c];
    return (
      <CampoAdmin
        campo={c}
        prefijo="g-"
        etiqueta={etiqueta}
        valor={valor ?? ""}
        onCambio={(v) => poner(c, v)}
        error={errores[c]}
        tipo={extra.tipo}
        hint={extra.hint}
        ancho={extra.ancho}
        inputMode={extra.dinero ? "numeric" : undefined}
        simbolo={extra.dinero ? "$" : undefined}
        onBlur={extra.dinero ? () => formatearDinero(c as "valorTotal" | "honorario") : undefined}
      />
    );
  };

  const avisoInicio = esOtrosi ? "" : avisoInicioContratoNuevo(nuevo.inicio, contrato.fin);

  return (
    <div className={css.panelCuerpo}>
      <div className={css.panelCabecera}>
        <h2 className={css.h1}>{esOtrosi ? "Registrar otrosí" : "Registrar contrato nuevo"}</h2>
        <button type="button" className={css.volver} onClick={onVolver}>Volver</button>
      </div>
      <p className={css.lead} style={{ marginBottom: 12 }}>{contrato.nombre}</p>
      <Vigente c={contrato} />

      {errorGeneral && <div className="aviso error" role="alert">{errorGeneral}</div>}

      <form onSubmit={guardar} noValidate>
        {esOtrosi ? (
          <div className={css.rejilla2}>
            {campo("fin", "Nueva fecha de fin", { tipo: "date", hint: "La que dice el otrosí. Si solo hay adición de dinero, déjala como está." })}
            {campo("valorTotal", "Nuevo valor total del contrato", {
              dinero: true,
              hint: "El acumulado sigue sumando desde el inicio del contrato.",
            })}
          </div>
        ) : (
          <>
            <div className={css.rejilla2}>
              {campo("numeroContrato", "Número del contrato nuevo", { ancho: true })}
              {campo("inicio", "Fecha de inicio", { tipo: "date" })}
              {campo("fin", "Fecha de fin", { tipo: "date" })}
              {campo("honorario", "Honorario mensual", { dinero: true, hint: "Ejemplo: 7.174.000" })}
              {campo("valorTotal", "Valor total del contrato", { dinero: true, hint: "Ejemplo: 64.566.000" })}
            </div>
            {avisoInicio && <div className="aviso warn" role="status">{avisoInicio}</div>}
            <CampoAdmin
              campo="objeto"
              prefijo="g-"
              etiqueta="Objeto del contrato"
              valor={nuevo.objeto}
              onCambio={(v) => poner("objeto", v)}
              error={errores.objeto}
              area
              opcional
              hint="Viene el del contrato anterior; cámbialo si el nuevo es distinto."
            />
            <p className={css.pista} style={{ marginTop: 0 }}>
              El acumulado empieza de cero desde la nueva fecha de inicio. Las cuentas ya enviadas no cambian.
            </p>
          </>
        )}

        <div className={css.panelBarra}>
          <button type="submit" className={css.btn} disabled={ocupado}>
            {ocupado ? "Guardando…" : esOtrosi ? "Registrar otrosí" : "Registrar contrato nuevo"}
          </button>
          <button type="button" className={`${css.btn} ${css.btnSec}`} onClick={onVolver} disabled={ocupado}>Volver</button>
        </div>
      </form>
    </div>
  );
}
