"use client";

import { useId, useState } from "react";
import { AdminError, apiAdmin, textoError, type Parametros as ParametrosDatos } from "./apiAdmin";
import {
  erroresParamDeCampos, formDeParametros, NIVELES_RIESGO, parseEntero, payloadDeParametros, puntos, validarParametros,
  type CampoParam, type ErroresParam, type FormParametros,
} from "./helpers";
import { useDatos } from "./useDatos";
import css from "./admin.module.css";

interface CampoProps {
  id: CampoParam;
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  error?: string;
  sufijo?: string;
  prefijo?: string;
  hint?: string;
  inputMode?: "decimal" | "numeric" | "email";
  onBlur?: () => void;
  tipo?: "text" | "email";
}

function CampoNumero(p: CampoProps) {
  const id = "p-" + p.id;
  const describe = [p.error ? id + "-error" : "", p.hint ? id + "-hint" : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={css.campo}>
      <label className={css.etiqueta} htmlFor={id}>{p.etiqueta}</label>
      <div className={`${css.conSufijo} ${p.prefijo ? css.conPrefijo : ""}`}>
        {p.prefijo && <span className={css.prefijo} aria-hidden="true">{p.prefijo}</span>}
        <input
          id={id}
          type={p.tipo ?? "text"}
          inputMode={p.inputMode ?? "decimal"}
          autoComplete="off"
          className={`${css.texto} ${p.error ? css.invalido : ""}`}
          value={p.valor}
          onChange={(e) => p.onCambio(e.target.value)}
          onBlur={p.onBlur}
          aria-invalid={p.error ? true : undefined}
          aria-describedby={describe}
        />
        {p.sufijo && <span className={css.sufijo} aria-hidden="true">{p.sufijo}</span>}
      </div>
      {p.hint && <p id={id + "-hint"} className={css.pista}>{p.hint}</p>}
      {p.error && <p id={id + "-error"} className={css.errorCampo} role="alert">{p.error}</p>}
    </div>
  );
}

interface FormProps {
  inicial: ParametrosDatos;
  onGuardado: (p: ParametrosDatos) => void;
}

function FormParametrosPantalla({ inicial, onGuardado }: FormProps) {
  const idTitulo = useId();
  const [f, setF] = useState<FormParametros>(() => formDeParametros(inicial));
  const [errores, setErrores] = useState<ErroresParam>({});
  const [errorGeneral, setErrorGeneral] = useState("");
  const [exito, setExito] = useState("");
  const [ocupado, setOcupado] = useState(false);

  function poner<K extends Exclude<keyof FormParametros, "arl">>(k: K, v: FormParametros[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
    setErrores((prev) => ({ ...prev, [k]: undefined }));
    setExito("");
  }
  function ponerArl(n: string, v: string) {
    setF((prev) => ({ ...prev, arl: { ...prev.arl, [n]: v } }));
    setErrores((prev) => ({ ...prev, ["arl" + n]: undefined }));
    setExito("");
  }

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setExito("");
    setErrorGeneral("");
    const errs = validarParametros(f);
    const primero = Object.keys(errs)[0];
    if (primero) {
      setErrores(errs);
      setErrorGeneral("Hay valores por corregir. Revisa los campos marcados en rojo.");
      setTimeout(() => document.getElementById("p-" + primero)?.focus(), 0);
      return;
    }
    setErrores({});
    setOcupado(true);
    try {
      const guardado = await apiAdmin.guardarParametros(payloadDeParametros(inicial, f));
      setF(formDeParametros(guardado));
      onGuardado(guardado);
      setExito("Se guardaron los parámetros.");
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) return;
      const delServidor = e instanceof AdminError ? erroresParamDeCampos(e.campos) : {};
      const primero = Object.keys(delServidor)[0];
      if (primero) {
        setErrores(delServidor);
        setErrorGeneral("No se guardó. Revisa los campos marcados en rojo.");
        setTimeout(() => document.getElementById("p-" + primero)?.focus(), 0);
      } else {
        setErrorGeneral(textoError(e));
      }
    } finally {
      setOcupado(false);
    }
  }

  const e = errores;

  return (
    <div className={css.paginaForm} role="main" aria-labelledby={idTitulo}>
      <h1 id={idTitulo} className={css.h1}>Parámetros</h1>
      <p className={css.lead}>
        Son los porcentajes y valores con los que se calcula la seguridad social. Cámbialos solo si cambió la norma (por ejemplo, un salario mínimo nuevo).
      </p>

      {exito && <div className="aviso info" role="status">{exito}</div>}
      {errorGeneral && <div className="aviso error" role="alert">{errorGeneral}</div>}

      <form onSubmit={guardar} noValidate>
        <fieldset className={css.grupo}>
          <legend>Base y aportes</legend>
          <div className={css.rejilla}>
            <CampoNumero id="pctIbc" etiqueta="Base de cotización (IBC) sobre el honorario" valor={f.pctIbc} onCambio={(v) => poner("pctIbc", v)} error={e.pctIbc} sufijo="%"
              hint="Normalmente 40 %." />
            <CampoNumero id="smmlv" etiqueta="Salario mínimo (SMMLV)" valor={f.smmlv} onCambio={(v) => poner("smmlv", v)} error={e.smmlv} prefijo="$" inputMode="numeric"
              onBlur={() => { const n = parseEntero(f.smmlv); if (n !== null) setF((p) => ({ ...p, smmlv: puntos(n) })); }}
              hint="Ejemplo: 1.750.905" />
            <CampoNumero id="salud" etiqueta="Salud" valor={f.salud} onCambio={(v) => poner("salud", v)} error={e.salud} sufijo="%" hint="Ejemplo: 12,5" />
            <CampoNumero id="pension" etiqueta="Pensión" valor={f.pension} onCambio={(v) => poner("pension", v)} error={e.pension} sufijo="%" hint="Ejemplo: 16" />
            <CampoNumero id="ibcPisoMult" etiqueta="Base mínima (veces el salario mínimo)" valor={f.ibcPisoMult} onCambio={(v) => poner("ibcPisoMult", v)} error={e.ibcPisoMult}
              hint="Normalmente 1." />
            <CampoNumero id="ibcTechoMult" etiqueta="Base máxima (veces el salario mínimo)" valor={f.ibcTechoMult} onCambio={(v) => poner("ibcTechoMult", v)} error={e.ibcTechoMult}
              hint="Normalmente 25." />
          </div>
        </fieldset>

        <fieldset className={css.grupo}>
          <legend>ARL según el nivel de riesgo</legend>
          <div className={css.rejilla}>
            {NIVELES_RIESGO.map((n) => (
              <CampoNumero key={n} id={("arl" + n) as CampoParam} etiqueta={`Riesgo ${n}`} valor={f.arl[n]} onCambio={(v) => ponerArl(n, v)}
                error={e[("arl" + n) as CampoParam]} sufijo="%" />
            ))}
          </div>
        </fieldset>

        <fieldset className={css.grupo}>
          <legend>Avisos y correo</legend>
          <div className={css.rejilla}>
            <CampoNumero id="toleranciaSs" etiqueta="Diferencia que se perdona en la seguridad social" valor={f.toleranciaSs} onCambio={(v) => poner("toleranciaSs", v)} error={e.toleranciaSs}
              prefijo="$" inputMode="numeric"
              onBlur={() => { const n = parseEntero(f.toleranciaSs); if (n !== null) setF((p) => ({ ...p, toleranciaSs: puntos(n) || "0" })); }}
              hint="Si lo pagado se diferencia de lo esperado en menos de este valor, no se avisa. Ejemplo: 100" />
            <CampoNumero id="correoSupervisor" etiqueta="Correo del supervisor (opcional)" valor={f.correoSupervisor} onCambio={(v) => poner("correoSupervisor", v)} error={e.correoSupervisor}
              tipo="email" inputMode="email" hint="Recibe copia cuando una trabajadora envía su cuenta." />
          </div>
          <label className={css.check} style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={f.enviarCorreo} onChange={(ev) => poner("enviarCorreo", ev.target.checked)} />
            <span>Enviar correo con la cuenta de cobro cuando una trabajadora la genera</span>
          </label>
        </fieldset>

        <div className={css.accionesFin}>
          <button type="submit" className={css.btn} disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar parámetros"}</button>
          <button
            type="button"
            className={`${css.btn} ${css.btnSec}`}
            disabled={ocupado}
            onClick={() => { setF(formDeParametros(inicial)); setErrores({}); setErrorGeneral(""); setExito(""); }}
          >
            Deshacer cambios
          </button>
        </div>
      </form>
    </div>
  );
}

/** Pantalla "Parámetros": porcentajes legibles (12,5 %) y SMMLV con puntos; al guardar vuelven a fracciones. */
export default function Parametros() {
  const { datos, error, cargando, recargar, modificar } = useDatos("parametros", () => apiAdmin.parametros());

  if (datos) return <FormParametrosPantalla inicial={datos} onGuardado={(p) => modificar(() => p)} />;

  return (
    <div className={css.paginaForm} role="main">
      <h1 className={css.h1}>Parámetros</h1>
      {cargando && (
        <div className={css.cargandoCaja} role="status">
          Cargando los parámetros…
        </div>
      )}
      {error && (
        <div className="aviso error" role="alert">
          {error}{" "}
          <button type="button" className={css.btnLink} onClick={recargar}>Intentar de nuevo</button>
        </div>
      )}
    </div>
  );
}
