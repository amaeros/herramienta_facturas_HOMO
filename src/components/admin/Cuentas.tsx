"use client";

import { useId, useState } from "react";
import { apiAdmin, textoError, urlFactura, urlPlanilla, type Carga } from "./apiAdmin";
import { etiquetaEstado, etiquetaLectura, fmtFechaHora, fmtPct, pesos, ultimosMeses } from "./helpers";
import { useDatos, useMesActual, useMesPorDefecto } from "./useDatos";
import { labelMes } from "../formato";
import css from "./admin.module.css";

type Guardado = { tipo: "nada" } | { tipo: "guardando" } | { tipo: "ok" } | { tipo: "error"; msg: string };

function Indicador({ g }: { g: Guardado }) {
  return (
    <div className={css.guardado} role="status" aria-live="polite">
      {g.tipo === "guardando" && <span className={css.gAviso}>Guardando…</span>}
      {g.tipo === "ok" && <span className={css.gOk}>✓ Guardado</span>}
      {g.tipo === "error" && <span className={css.gErr}>{g.msg}</span>}
    </div>
  );
}

function clasePastilla(estado: string): string {
  return estado === "OK" ? css.pOk : estado === "REVISAR" ? css.pRev : css.pErr;
}

function FilaCuenta({ c }: { c: Carga }) {
  const idDetalle = useId();
  const idObs = useId();
  const [abierta, setAbierta] = useState(false);
  const [aprobado, setAprobado] = useState(c.aprobado);
  const [gAprob, setGAprob] = useState<Guardado>({ tipo: "nada" });
  const [obs, setObs] = useState(c.observacion);
  const [obsGuardada, setObsGuardada] = useState(c.observacion);
  const [gObs, setGObs] = useState<Guardado>({ tipo: "nada" });

  async function cambiarAprobado(nuevo: boolean) {
    setAprobado(nuevo);
    setGAprob({ tipo: "guardando" });
    try {
      await apiAdmin.actualizarCarga(c.id, { aprobado: nuevo });
      setGAprob({ tipo: "ok" });
    } catch (e) {
      setAprobado(!nuevo);
      setGAprob({ tipo: "error", msg: "No se pudo guardar. " + textoError(e) });
    }
  }

  async function guardarObs() {
    if (obs === obsGuardada) return;
    const texto = obs;
    setGObs({ tipo: "guardando" });
    try {
      await apiAdmin.actualizarCarga(c.id, { observacion: texto });
      setObsGuardada(texto);
      setGObs({ tipo: "ok" });
    } catch (e) {
      setGObs({ tipo: "error", msg: "No se pudo guardar. " + textoError(e) });
    }
  }

  const dif = c.ssEsperada !== null && c.ssDeclarada !== null ? c.ssDeclarada - c.ssEsperada : null;
  const adicionalesConArchivo = c.adicionales
    .map((a, i) => ({ a, n: i + 1 }))
    .filter(({ a }) => a.tieneArchivo);

  return (
    <>
      <tr>
        <td data-label="Estado">
          <span>
            <span className={css.emoji} aria-hidden="true">{c.emoji || "•"}</span>{" "}
            <span className={`${css.pastilla} ${clasePastilla(c.estado)}`}>{etiquetaEstado(c.estado)}</span>
          </span>
        </td>
        <td data-label="Trabajadora">
          <span className={css.nombreFila}>{c.nombre}</span>
        </td>
        <td data-label="Valor" className={css.num}>
          {pesos(c.valor)}
          {c.dias !== null && <span className={css.sub}>{c.dias} días</span>}
        </td>
        <td data-label="Seguridad social" className={css.num}>
          <span className={css.sub}>Esperada: {pesos(c.ssEsperada)}</span>
          <span className={css.sub}>Declarada: {pesos(c.ssDeclarada)}</span>
          {dif !== null && dif !== 0 && (
            <span className={css.sub} style={{ color: dif < 0 ? "var(--err)" : "var(--rev)", fontWeight: 700 }}>
              {dif < 0 ? "Pagó " + pesos(-dif) + " menos" : "Pagó " + pesos(dif) + " más"}
            </span>
          )}
        </td>
        <td data-label="Mensaje">
          <button
            type="button"
            className={css.btnLink}
            aria-expanded={abierta}
            aria-controls={idDetalle}
            onClick={() => setAbierta((v) => !v)}
          >
            {abierta ? "Ocultar mensaje" : "Ver mensaje"}
          </button>
        </td>
        <td data-label="Archivos">
          <div className={css.enlaces}>
            <a className={`${css.btn} ${css.btnChico}`} href={urlFactura(c.id)} download>
              Descargar Excel
            </a>
            {c.tienePlanilla ? (
              <a className={css.enlace} href={urlPlanilla(c.id, 0)} target="_blank" rel="noopener noreferrer">
                Ver planilla
              </a>
            ) : (
              <span className={css.sub}>Sin archivo de planilla</span>
            )}
            {adicionalesConArchivo.map(({ a, n }) => (
              <a key={n} className={css.enlace} href={urlPlanilla(c.id, n)} target="_blank" rel="noopener noreferrer">
                Ver planilla adicional {n}
                {a.numero ? ` (n.º ${a.numero})` : ""}
              </a>
            ))}
          </div>
        </td>
        <td data-label="Aprobado">
          <div>
            <label className={css.check}>
              <input
                type="checkbox"
                checked={aprobado}
                onChange={(e) => cambiarAprobado(e.target.checked)}
                aria-label={`Aprobada la cuenta de ${c.nombre}`}
              />
              <span>{aprobado ? "Aprobada" : "Sin aprobar"}</span>
            </label>
            <Indicador g={gAprob} />
          </div>
        </td>
        <td data-label="Observación" className={css.obs}>
          <div style={{ width: "100%" }}>
            <textarea
              id={idObs}
              className={css.area}
              aria-label={`Observación para ${c.nombre}`}
              value={obs}
              placeholder="Escribe una observación…"
              onChange={(e) => {
                setObs(e.target.value);
                if (gObs.tipo !== "nada") setGObs({ tipo: "nada" });
              }}
              onBlur={guardarObs}
            />
            <Indicador g={gObs} />
          </div>
        </td>
      </tr>
      {abierta && (
        <tr className={css.filaDetalle} id={idDetalle}>
          <td colSpan={8}>
            <p className={css.detalleMsg}>{c.mensaje || "Sin mensaje."}</p>
            <div className={css.detalle}>
              <div>Documento n.º: <strong>{c.docNum ?? "—"}</strong></div>
              <div>Planilla n.º: <strong>{c.planillaNumero || "—"}</strong></div>
              <div>Mes cotizado: <strong>{c.planillaMes ? labelMes(c.planillaMes) : "—"}</strong></div>
              <div>Acumulado del contrato: <strong>{pesos(c.acumulado)}</strong> ({fmtPct(c.pct)})</div>
              <div>Lectura de la planilla: <strong>{etiquetaLectura(c.lectura)}</strong></div>
              <div>Última actualización: <strong>{fmtFechaHora(c.actualizado)}</strong></div>
              {c.adicionales.length > 0 && (
                <div>
                  Planillas adicionales:{" "}
                  <strong>{c.adicionales.map((a) => `n.º ${a.numero || "—"} (${pesos(a.valor)})`).join(" · ")}</strong>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Pantalla "Cuentas del mes". */
export default function Cuentas() {
  const mesDefecto = useMesPorDefecto();
  const mesActual = useMesActual();
  const [elegido, setElegido] = useState<string | null>(null);
  const mes = elegido ?? (mesDefecto || null);
  const { datos, error, cargando, recargar } = useDatos(mes, () => apiAdmin.cargas(mes as string));

  const opciones = mesActual ? ultimosMeses(mesActual, 24) : [];
  const cargas = datos?.cargas ?? [];
  const faltan = datos?.faltan ?? [];
  const aprobadas = cargas.filter((c) => c.aprobado).length;
  const conAlerta = cargas.filter((c) => c.estado !== "OK").length;

  return (
    <div className={css.pagina} role="main">
      <div className={css.encabezadoPagina}>
        <div>
          <h1 className={css.h1}>Cuentas del mes</h1>
          <p className={css.lead} style={{ margin: 0 }}>
            Revisa lo que enviaron las trabajadoras, descarga su Excel y marca las que ya aprobaste.
          </p>
        </div>
        <div className={`${css.campo} ${css.selectorMes}`} style={{ marginBottom: 0, width: "100%" }}>
          <label className={css.etiqueta} htmlFor="selector-mes">
            ¿De qué mes?
          </label>
          <select id="selector-mes" value={mes ?? ""} onChange={(e) => setElegido(e.target.value)} disabled={!mes}>
            {!mes && <option value="">Cargando…</option>}
            {mes && !opciones.some((o) => o.key === mes) && <option value={mes}>{labelMes(mes)}</option>}
            {opciones.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {cargando && (
        <div className={css.cargandoCaja} role="status">
          <span className={css.rueda} aria-hidden="true" />
          Cargando las cuentas de {mes ? labelMes(mes) : "este mes"}…
        </div>
      )}

      {error && (
        <div className="aviso error" role="alert">
          {error}{" "}
          <button type="button" className={css.btnLink} onClick={recargar}>
            Intentar de nuevo
          </button>
        </div>
      )}

      {datos && (
        <>
          <ul className={css.resumen} aria-label="Resumen del mes">
            <li><strong>{cargas.length}</strong> {cargas.length === 1 ? "cuenta enviada" : "cuentas enviadas"}</li>
            <li><strong>{aprobadas}</strong> {aprobadas === 1 ? "aprobada" : "aprobadas"}</li>
            <li><strong>{conAlerta}</strong> para revisar con cuidado</li>
            <li><strong>{faltan.length}</strong> {faltan.length === 1 ? "falta por enviar" : "faltan por enviar"}</li>
          </ul>

          {cargas.length === 0 ? (
            <div className="aviso info">Todavía no hay cuentas enviadas de {labelMes(mes as string)}.</div>
          ) : (
            <div className={css.tablaCaja}>
              <table className={css.tabla}>
                <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
                  Cuentas de cobro de {labelMes(mes as string)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Estado</th>
                    <th scope="col">Trabajadora</th>
                    <th scope="col" className={css.num}>Valor</th>
                    <th scope="col" className={css.num}>Seguridad social</th>
                    <th scope="col">Mensaje</th>
                    <th scope="col">Archivos</th>
                    <th scope="col">Aprobado</th>
                    <th scope="col">Observación</th>
                  </tr>
                </thead>
                <tbody>
                  {cargas.map((c) => (
                    <FilaCuenta key={c.id} c={c} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <section className={css.tarjeta} style={{ marginTop: 16 }} aria-labelledby="faltan-titulo">
            <h2 id="faltan-titulo" className={css.h2}>Faltan por enviar</h2>
            {faltan.length === 0 ? (
              <p style={{ margin: 0 }}>✅ Todas las trabajadoras activas ya enviaron su cuenta de {labelMes(mes as string)}.</p>
            ) : (
              <ul className={css.lista}>
                {faltan.map((f) => (
                  <li key={f.contratoId}>{f.nombre}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
