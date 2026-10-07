"use client";

import { useId, useState } from "react";
import { AdminError, apiAdmin, textoError, type Contrato } from "./apiAdmin";
import CambioGuiado, { type TipoCambioGuiado } from "./CambioGuiado";
import CampoAdmin, { type CampoAdminProps } from "./CampoAdmin";
import {
  campoDeMensaje, CAMPOS_TEXTO, erroresDeCampos, formDeContrato, formVacio, NIVELES_RIESGO, parseEntero, payloadDeForm, puntos, validarForm,
  type CampoForm, type ErroresForm, type FormContrato,
} from "./helpers";
import { HistorialCambios } from "./Cambios";
import VerificarDocumento from "./VerificarDocumento";
import css from "./admin.module.css";

interface Props {
  /** null = trabajadora nueva. Con `solicitud`, es la solicitud de cuenta que se está revisando. */
  inicial: Contrato | null;
  /**
   * Revisión de una solicitud de cuenta: el botón principal es «Aprobar» (manda también lo corregido) y hay «Rechazar».
   * No hay historial ni estado: al aprobar, la cuenta queda activa.
   */
  solicitud?: { onRechazar: () => void };
  /** `mensaje` = lo que se le dice al supervisor al volver a la lista (si no, el de siempre). */
  onGuardado: (c: Contrato, mensaje?: string) => void;
  onCancelar: () => void;
  /**
   * "Verificar con documento" cambió el contrato sin cerrar el panel (copió un dato del documento o la marcó verificada):
   * la lista de atrás se pone al día con este contrato.
   */
  onActualizada?: (c: Contrato) => void;
}

/** Formulario para crear o editar una trabajadora, o revisar una solicitud, agrupado como en docs/ADMIN.md. */
export default function FormularioTrabajadora({ inicial, solicitud, onGuardado, onCancelar, onActualizada }: Props) {
  const idTitulo = useId();
  const [f, setF] = useState<FormContrato>(() => (inicial ? formDeContrato(inicial) : formVacio()));
  const [errores, setErrores] = useState<ErroresForm>({});
  const [errorGeneral, setErrorGeneral] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [guiado, setGuiado] = useState<TipoCambioGuiado | null>(null);
  // el contrato como está ahora (cambia si se copia un dato de un documento): lo usan "otrosí" y "contrato nuevo"
  const [vigente, setVigente] = useState<Contrato | null>(inicial);

  /** Se copió un dato del documento (o se marcó verificada): el campo del formulario toma el valor nuevo; lo demás que se esté escribiendo no se toca. */
  function alCambiarContrato(c: Contrato, campo?: string) {
    setVigente(c);
    if (campo && (CAMPOS_TEXTO as readonly string[]).includes(campo)) {
      const k = campo as CampoForm;
      setF((prev) => ({ ...prev, [k]: formDeContrato(c)[k] }));
      setErrores((prev) => ({ ...prev, [k]: undefined }));
    }
    onActualizada?.(c);
  }

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
      if (inicial && solicitud) {
        const c = await apiAdmin.aprobarSolicitud(inicial.id, payload);
        onGuardado(c, `${c.nombre} quedó aprobada. Ya puede entrar con su nombre y su PIN.`);
        return;
      }
      const c = inicial ? await apiAdmin.editarContrato(inicial.id, payload) : await apiAdmin.crearContrato(payload);
      onGuardado(c);
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) return; // el panel vuelve a pedir la contraseña
      const msg = textoError(e);
      const delServidor = e instanceof AdminError ? erroresDeCampos(e.campos) : {};
      const primero = Object.keys(delServidor)[0] as CampoForm | undefined;
      if (primero) {
        setErrores(delServidor);
        setErrorGeneral(solicitud ? "No se aprobó. Revisa los campos marcados en rojo." : "No se guardó. Revisa los campos marcados en rojo.");
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
  const campo = (c: CampoForm, etiqueta: string, extra: Partial<CampoAdminProps> = {}) => (
    <CampoAdmin campo={c} etiqueta={etiqueta} valor={f[c]} onCambio={(v) => poner(c, v)} error={e[c]} {...extra} />
  );

  // otrosí o contrato nuevo: pantalla corta dentro del mismo panel; al volver, lo que había en el formulario sigue ahí
  if (guiado && inicial) {
    return (
      <CambioGuiado
        tipo={guiado}
        contrato={vigente ?? inicial}
        onGuardado={onGuardado}
        onVolver={() => setGuiado(null)}
      />
    );
  }

  const titulo = solicitud && inicial ? `Solicitud de ${inicial.nombre}` : inicial ? `Editar a ${inicial.nombre}` : "Nueva trabajadora";

  return (
    <div className={css.panelCuerpo}>
      <div className={css.panelCabecera}>
        <h2 id={idTitulo} className={css.h1}>{titulo}</h2>
        <button type="button" className={css.volver} onClick={onCancelar}>Cerrar</button>
      </div>
      <p className={css.lead}>
        {solicitud
          ? "Revisa los datos. Puedes corregir lo que haga falta y tocar «Aprobar»: la cuenta queda activa y podrá entrar con su nombre y su PIN (los últimos 4 números de su cédula)."
          : "Llena los datos y toca «Guardar». Los campos con «opcional» pueden quedar vacíos."}
      </p>

      {inicial && !solicitud && (
        <div className={css.accionesContrato}>
          <p className={css.pista} style={{ margin: "0 0 10px" }}>
            Cambios del contrato, paso a paso. Las cuentas de cobro ya enviadas no cambian.
          </p>
          <div className={css.acciones}>
            <button type="button" className={`${css.btn} ${css.btnSec} ${css.btnChico}`} onClick={() => setGuiado("otrosi")}>
              Registrar otrosí
            </button>
            <button type="button" className={`${css.btn} ${css.btnSec} ${css.btnChico}`} onClick={() => setGuiado("nuevo")}>
              Registrar contrato nuevo
            </button>
          </div>
        </div>
      )}

      {errorGeneral && <div className="aviso error" role="alert">{errorGeneral}</div>}

      <form onSubmit={guardar} noValidate>
        <fieldset className={css.grupo}>
          <legend>Datos personales</legend>
          <div className={css.rejilla2}>
            {campo("nombre", "Nombre completo", { ancho: true, hint: "Con este nombre la trabajadora entra desde el celular.", autoComplete: "off" })}
            {campo("cedula", "Cédula", { inputMode: "numeric", hint: "Solo números, sin puntos. Los últimos 4 son el PIN de la trabajadora." })}
            {campo("cargo", "Cargo de la trabajadora", { opcional: true, hint: "El de su contrato. Sale en la cuenta de cobro debajo de su nombre." })}
            {campo("telefono", "Teléfono", { tipo: "tel", inputMode: "tel", opcional: true })}
            {campo("direccion", "Dirección", { opcional: true })}
            {campo("ciudad", "Ciudad", { opcional: true })}
            {campo("correo", "Correo electrónico", { tipo: "email", inputMode: "email", opcional: true, hint: "Aquí se le puede enviar copia de su cuenta de cobro." })}
          </div>
        </fieldset>

        <fieldset className={css.grupo}>
          <legend>Contrato</legend>
          <div className={css.rejilla2}>
            {campo("numeroContrato", "Número del contrato", { opcional: true })}
            {campo("linea", "Equipo o línea", { opcional: true, ancho: true })}
            {campo("objeto", "Objeto del contrato", { area: true, ancho: true, opcional: true, hint: "Es el texto que sale en la cuenta de cobro." })}
            {campo("inicio", "Fecha de inicio", { tipo: "date", opcional: true })}
            {campo("fin", "Fecha de terminación", { tipo: "date", opcional: true })}
            {campo("honorario", "Honorario mensual", { inputMode: "numeric", simbolo: "$", onBlur: () => formatearDinero("honorario"), opcional: true, hint: "Ejemplo: 7.174.000" })}
            {campo("valorTotal", "Valor total del contrato", { inputMode: "numeric", simbolo: "$", onBlur: () => formatearDinero("valorTotal"), opcional: true, hint: "Ejemplo: 64.566.000" })}
          </div>
          <p className={css.pista} style={{ marginTop: 0, marginBottom: 14 }}>
            Si faltan las fechas o el honorario, la trabajadora todavía no podrá entrar desde el celular.
          </p>
          {!solicitud && (
            <p className={css.pista} style={{ marginTop: 0, marginBottom: 14 }}>
              ¿Hay otrosí (prórroga o adición)? Usa «Registrar otrosí» arriba, o cambia aquí solo la fecha de fin y el valor total (valor inicial + adiciones). La fecha de inicio no cambia: el acumulado sigue sumando desde el inicio del contrato.
            </p>
          )}
        </fieldset>

        <fieldset className={css.grupo}>
          <legend>ARL (riesgo)</legend>
          <div className={css.rejilla2}>
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
            {campo("riesgoDesde", "El riesgo nuevo aplica desde", { tipo: "date", disabled: !f.riesgoNuevo, hint: "Debe ser el día 1 de un mes (por ejemplo, 01/06/2026)." })}
          </div>
        </fieldset>

        <fieldset className={css.grupo}>
          <legend>Quién revisó</legend>
          <div className={css.rejilla2}>
            {campo("revisoNombre", "Nombre de quien revisó", { opcional: true })}
            {campo("revisoCargo", "Cargo de quien revisó", { opcional: true })}
          </div>
        </fieldset>

        {!solicitud && (
          <fieldset className={css.grupo}>
            <legend>Estado</legend>
            <label className={css.check} style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={f.activo} onChange={(ev) => poner("activo", ev.target.checked)} />
              <span>Activa (aparece en la lista del celular)</span>
            </label>
          </fieldset>
        )}

        {inicial && <VerificarDocumento contratoId={inicial.id} onContrato={alCambiarContrato} />}

        {inicial && !solicitud && <HistorialCambios contratoId={inicial.id} />}

        <div className={css.panelBarra}>
          <button type="submit" className={css.btn} disabled={ocupado}>
            {solicitud ? (ocupado ? "Aprobando…" : "Aprobar") : ocupado ? "Guardando…" : "Guardar"}
          </button>
          {solicitud && (
            <button type="button" className={`${css.btn} ${css.btnPeligro}`} onClick={solicitud.onRechazar} disabled={ocupado}>
              Rechazar
            </button>
          )}
          <button type="button" className={`${css.btn} ${css.btnSec}`} onClick={onCancelar} disabled={ocupado}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
