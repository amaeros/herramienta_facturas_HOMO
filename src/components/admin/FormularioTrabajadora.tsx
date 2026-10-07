"use client";

import { useId, useState } from "react";
import { AdminError, apiAdmin, textoError, type Contrato } from "./apiAdmin";
import {
  campoDeMensaje, erroresDeCampos, formDeContrato, formVacio, NIVELES_RIESGO, parseEntero, payloadDeForm, puntos, validarForm,
  type CampoForm, type ErroresForm, type FormContrato,
} from "./helpers";
import css from "./admin.module.css";

interface CampoProps {
  campo: CampoForm;
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  error?: string;
  tipo?: "text" | "date" | "email" | "tel";
  hint?: string;
  opcional?: boolean;
  inputMode?: "numeric" | "text" | "email" | "tel";
  prefijo?: string;
  ancho?: boolean;
  area?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
  autoComplete?: string;
}

function Campo(p: CampoProps) {
  const id = "f-" + p.campo;
  const idError = id + "-error";
  const idHint = id + "-hint";
  const describe = [p.error ? idError : "", p.hint ? idHint : ""].filter(Boolean).join(" ") || undefined;
  const comunes = {
    id,
    value: p.valor,
    disabled: p.disabled,
    "aria-invalid": p.error ? true : undefined,
    "aria-describedby": describe,
  } as const;
  return (
    <div className={`${css.campo} ${p.ancho ? css.ancho : ""}`}>
      <label className={css.etiqueta} htmlFor={id}>
        {p.etiqueta} {p.opcional && <span className={css.opcional}>(opcional)</span>}
      </label>
      {p.area ? (
        <textarea
          {...comunes}
          className={`${css.area} ${p.error ? css.invalido : ""}`}
          onChange={(e) => p.onCambio(e.target.value)}
        />
      ) : (
        <div className={p.prefijo ? css.conPrefijo : undefined} style={{ position: "relative" }}>
          {p.prefijo && <span className={css.prefijo} aria-hidden="true">{p.prefijo}</span>}
          <input
            {...comunes}
            type={p.tipo ?? "text"}
            inputMode={p.inputMode}
            autoComplete={p.autoComplete ?? "off"}
            className={`${css.texto} ${p.error ? css.invalido : ""}`}
            onChange={(e) => p.onCambio(e.target.value)}
            onBlur={p.onBlur}
          />
        </div>
      )}
      {p.hint && <p id={idHint} className={css.pista}>{p.hint}</p>}
      {p.error && <p id={idError} className={css.errorCampo} role="alert">{p.error}</p>}
    </div>
  );
}

interface Props {
  /** null = trabajadora nueva */
  inicial: Contrato | null;
  onGuardado: (c: Contrato) => void;
  onCancelar: () => void;
}

/** Formulario para crear o editar una trabajadora, agrupado como en docs/ADMIN.md. */
export default function FormularioTrabajadora({ inicial, onGuardado, onCancelar }: Props) {
  const idTitulo = useId();
  const [f, setF] = useState<FormContrato>(() => (inicial ? formDeContrato(inicial) : formVacio()));
  const [errores, setErrores] = useState<ErroresForm>({});
  const [errorGeneral, setErrorGeneral] = useState("");
  const [ocupado, setOcupado] = useState(false);

  function poner<K extends keyof FormContrato>(k: K, v: FormContrato[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
    if (k in errores) setErrores((prev) => ({ ...prev, [k]: undefined }));
  }

  function formatearDinero(k: "honorario" | "valorTotal") {
    const n = parseEntero(f[k]);
    if (n !== null) setF((prev) => ({ ...prev, [k]: puntos(n) }));
  }

  function enfocar(campo: CampoForm) {
    setTimeout(() => document.getElementById("f-" + campo)?.focus(), 0);
  }

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setErrorGeneral("");
    const errs = validarForm(f);
    const primero = Object.keys(errs)[0] as CampoForm | undefined;
    if (primero) {
      setErrores(errs);
      setErrorGeneral("Hay datos por corregir. Revisa los campos marcados en rojo.");
      enfocar(primero);
      return;
    }
    setErrores({});
    setOcupado(true);
    try {
      const payload = payloadDeForm(f);
      const c = inicial ? await apiAdmin.editarContrato(inicial.id, payload) : await apiAdmin.crearContrato(payload);
      onGuardado(c);
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) return; // el panel vuelve a pedir la contraseña
      const msg = textoError(e);
      const delServidor = e instanceof AdminError ? erroresDeCampos(e.campos) : {};
      const primero = Object.keys(delServidor)[0] as CampoForm | undefined;
      if (primero) {
        setErrores(delServidor);
        setErrorGeneral("No se guardó. Revisa los campos marcados en rojo.");
        enfocar(primero);
      } else {
        const campo = campoDeMensaje(msg);
        if (campo) {
          setErrores({ [campo]: msg });
          enfocar(campo);
        }
        setErrorGeneral(campo ? "No se guardó. Revisa el campo marcado en rojo." : msg);
      }
    } finally {
      setOcupado(false);
    }
  }

  const e = errores;

  return (
    <div className={css.pagina} role="main" aria-labelledby={idTitulo}>
      <button type="button" className={css.volver} onClick={onCancelar}>← Volver a la lista</button>
      <h1 id={idTitulo} className={css.h1}>{inicial ? `Editar a ${inicial.nombre}` : "Nueva trabajadora"}</h1>
      <p className={css.lead}>Llena los datos y toca «Guardar». Los campos con «opcional» pueden quedar vacíos.</p>

      {errorGeneral && <div className="aviso error" role="alert">{errorGeneral}</div>}

      <form onSubmit={guardar} noValidate>
        <fieldset className={css.grupo}>
          <legend>Datos personales</legend>
          <div className={css.rejilla}>
            <Campo campo="nombre" etiqueta="Nombre completo" valor={f.nombre} onCambio={(v) => poner("nombre", v)} error={e.nombre} ancho
              hint="Con este nombre la trabajadora entra desde el celular." autoComplete="off" />
            <Campo campo="cedula" etiqueta="Cédula" valor={f.cedula} onCambio={(v) => poner("cedula", v)} error={e.cedula} inputMode="numeric"
              hint="Solo números, sin puntos. Los últimos 4 son el PIN de la trabajadora." />
            <Campo campo="telefono" etiqueta="Teléfono" valor={f.telefono} onCambio={(v) => poner("telefono", v)} error={e.telefono} tipo="tel" inputMode="tel" opcional />
            <Campo campo="direccion" etiqueta="Dirección" valor={f.direccion} onCambio={(v) => poner("direccion", v)} error={e.direccion} opcional />
            <Campo campo="ciudad" etiqueta="Ciudad" valor={f.ciudad} onCambio={(v) => poner("ciudad", v)} error={e.ciudad} opcional />
            <Campo campo="correo" etiqueta="Correo electrónico" valor={f.correo} onCambio={(v) => poner("correo", v)} error={e.correo} tipo="email" inputMode="email" opcional
              hint="Aquí se le puede enviar copia de su cuenta de cobro." />
          </div>
        </fieldset>

        <fieldset className={css.grupo}>
          <legend>Contrato</legend>
          <div className={css.rejilla}>
            <Campo campo="numeroContrato" etiqueta="Número del contrato" valor={f.numeroContrato} onCambio={(v) => poner("numeroContrato", v)} error={e.numeroContrato} opcional />
            <Campo campo="cargo" etiqueta="Cargo" valor={f.cargo} onCambio={(v) => poner("cargo", v)} error={e.cargo} opcional />
            <Campo campo="linea" etiqueta="Línea de política pública" valor={f.linea} onCambio={(v) => poner("linea", v)} error={e.linea} opcional ancho />
            <Campo campo="objeto" etiqueta="Objeto del contrato" valor={f.objeto} onCambio={(v) => poner("objeto", v)} error={e.objeto} area ancho opcional
              hint="Es el texto que sale en la cuenta de cobro." />
            <Campo campo="inicio" etiqueta="Fecha de inicio" valor={f.inicio} onCambio={(v) => poner("inicio", v)} error={e.inicio} tipo="date" opcional />
            <Campo campo="fin" etiqueta="Fecha de terminación" valor={f.fin} onCambio={(v) => poner("fin", v)} error={e.fin} tipo="date" opcional />
            <Campo campo="honorario" etiqueta="Honorario mensual" valor={f.honorario} onCambio={(v) => poner("honorario", v)} error={e.honorario} inputMode="numeric"
              prefijo="$" onBlur={() => formatearDinero("honorario")} opcional hint="Ejemplo: 7.174.000" />
            <Campo campo="valorTotal" etiqueta="Valor total del contrato" valor={f.valorTotal} onCambio={(v) => poner("valorTotal", v)} error={e.valorTotal} inputMode="numeric"
              prefijo="$" onBlur={() => formatearDinero("valorTotal")} opcional hint="Ejemplo: 64.566.000" />
          </div>
          <p className={css.pista} style={{ marginTop: 0, marginBottom: 14 }}>
            Si faltan las fechas o el honorario, la trabajadora todavía no podrá entrar desde el celular.
          </p>
          <p className={css.pista} style={{ marginTop: 0, marginBottom: 14 }}>
            ¿Hay otrosí (prórroga o adición)? Cambia solo la fecha de fin y el valor total (valor inicial + adiciones). La fecha de inicio no cambia: el acumulado sigue sumando desde el inicio del contrato. Las cuentas de cobro ya enviadas no cambian.
          </p>
        </fieldset>

        <fieldset className={css.grupo}>
          <legend>ARL (riesgo)</legend>
          <div className={css.rejilla}>
            <div className={css.campo}>
              <label className={css.etiqueta} htmlFor="f-riesgo">Nivel de riesgo</label>
              <select id="f-riesgo" value={f.riesgo} onChange={(ev) => poner("riesgo", ev.target.value)} aria-invalid={e.riesgo ? true : undefined}>
                {NIVELES_RIESGO.map((n) => <option key={n} value={n}>Riesgo {n}</option>)}
              </select>
              {e.riesgo && <p className={css.errorCampo} role="alert">{e.riesgo}</p>}
            </div>
            <div className={css.campo}>
              <label className={css.etiqueta} htmlFor="f-riesgoNuevo">
                Riesgo nuevo <span className={css.opcional}>(opcional)</span>
              </label>
              <select
                id="f-riesgoNuevo"
                value={f.riesgoNuevo}
                onChange={(ev) => {
                  const v = ev.target.value;
                  setF((prev) => ({ ...prev, riesgoNuevo: v, riesgoDesde: v ? prev.riesgoDesde : "" }));
                  setErrores((prev) => ({ ...prev, riesgoNuevo: undefined, riesgoDesde: undefined }));
                }}
                aria-invalid={e.riesgoNuevo ? true : undefined}
              >
                <option value="">Sin cambio de riesgo</option>
                {NIVELES_RIESGO.map((n) => <option key={n} value={n}>Riesgo {n}</option>)}
              </select>
              <p className={css.pista}>Úsalo si el riesgo cambió a mitad del contrato.</p>
              {e.riesgoNuevo && <p className={css.errorCampo} role="alert">{e.riesgoNuevo}</p>}
            </div>
            <Campo campo="riesgoDesde" etiqueta="El riesgo nuevo aplica desde" valor={f.riesgoDesde} onCambio={(v) => poner("riesgoDesde", v)} error={e.riesgoDesde}
              tipo="date" disabled={!f.riesgoNuevo} hint="Debe ser el día 1 de un mes (por ejemplo, 01/06/2026)." />
          </div>
        </fieldset>

        <fieldset className={css.grupo}>
          <legend>Quién revisó</legend>
          <div className={css.rejilla}>
            <Campo campo="revisoNombre" etiqueta="Nombre de quien revisó" valor={f.revisoNombre} onCambio={(v) => poner("revisoNombre", v)} error={e.revisoNombre} opcional />
            <Campo campo="revisoCargo" etiqueta="Cargo de quien revisó" valor={f.revisoCargo} onCambio={(v) => poner("revisoCargo", v)} error={e.revisoCargo} opcional />
          </div>
        </fieldset>

        <fieldset className={css.grupo}>
          <legend>Estado</legend>
          <label className={css.check} style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={f.activo} onChange={(ev) => poner("activo", ev.target.checked)} />
            <span>Activa (aparece en la lista del celular)</span>
          </label>
        </fieldset>

        <div className={css.accionesFin}>
          <button type="submit" className={css.btn} disabled={ocupado}>{ocupado ? "Guardando…" : "💾 Guardar"}</button>
          <button type="button" className={`${css.btn} ${css.btnSec}`} onClick={onCancelar} disabled={ocupado}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
