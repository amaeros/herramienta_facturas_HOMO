"use client";

import { useState } from "react";
import { AdminError, apiAdmin, textoError, type Contrato, type Solicitud } from "./apiAdmin";
import Dialogo from "./Dialogo";
import FormularioTrabajadora from "./FormularioTrabajadora";
import PanelLateral from "./PanelLateral";
import { fmtFecha } from "../formato";
import { fmtFechaSolicitud, solicitudActualizada, textoPendientes } from "./helpers";
import { useDatos } from "./useDatos";
import css from "./admin.module.css";

/** Contenido del panel: baja la solicitud completa (con la cédula) y muestra el mismo formulario de una trabajadora. */
function PanelSolicitud({
  id,
  onRechazar,
  onAprobada,
  onActualizada,
  onCerrar,
}: {
  id: number;
  onRechazar: () => void;
  onAprobada: (nombre: string, mensaje?: string) => void;
  /** Se copió un dato de un documento: la lista de atrás se pone al día. */
  onActualizada: (c: Contrato) => void;
  onCerrar: () => void;
}) {
  const { datos, error, cargando, recargar } = useDatos(`solicitud-${id}`, () => apiAdmin.solicitud(id));
  return (
    <>
      {cargando && (
        <div className={css.panelCuerpo}>
          <p className={css.cargandoCaja} role="status">Abriendo la solicitud…</p>
        </div>
      )}
      {error && (
        <div className={css.panelCuerpo}>
          <div className="aviso error" role="alert">
            {error}{" "}
            <button type="button" className={css.btnLink} onClick={recargar}>Intentar de nuevo</button>
          </div>
          <button type="button" className={css.volver} onClick={onCerrar}>Cerrar</button>
        </div>
      )}
      {datos && (
        <FormularioTrabajadora
          inicial={datos}
          solicitud={{ onRechazar }}
          onCancelar={onCerrar}
          onActualizada={onActualizada}
          onGuardado={(c, mensaje) => onAprobada(c.nombre, mensaje)}
        />
      )}
    </>
  );
}

function CuerpoRechazar({ s, onCancelar, onRechazada }: { s: Solicitud; onCancelar: () => void; onRechazada: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function rechazar() {
    setOcupado(true);
    setError("");
    try {
      await apiAdmin.rechazarSolicitud(s.id);
      onRechazada();
    } catch (e) {
      if (!(e instanceof AdminError && e.status === 401)) setError(textoError(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <p>
        ¿Rechazar la solicitud de <strong>{s.nombre}</strong>? Se borra y no podrá entrar. Si fue un error, puede enviar otra solicitud.
      </p>
      {error && <div className="aviso error" role="alert">{error}</div>}
      <div className={css.accionesFin}>
        <button type="button" className={`${css.btn} ${css.btnPeligroLleno}`} onClick={rechazar} disabled={ocupado}>
          {ocupado ? "Rechazando…" : "Sí, rechazar"}
        </button>
        <button type="button" className={`${css.btn} ${css.btnSec}`} onClick={onCancelar} disabled={ocupado}>
          No, cancelar
        </button>
      </div>
    </>
  );
}

/** Pantalla "Solicitudes": las cuentas que las contratistas pidieron desde el celular y esperan aprobación. */
export default function Solicitudes() {
  const { datos, error, cargando, recargar, modificar } = useDatos("solicitudes", () => apiAdmin.solicitudes());
  const [abierta, setAbierta] = useState<Solicitud | null>(null);
  const [rechazando, setRechazando] = useState<Solicitud | null>(null);
  const [exito, setExito] = useState("");

  function quitar(id: number) {
    modificar((l) => l.filter((x) => x.id !== id));
  }

  return (
    <div className={css.pagina} role="main">
      <div className={css.encabezadoPagina}>
        <div>
          <h1 className={css.h1}>Solicitudes</h1>
          <p className={css.lead} style={{ margin: 0 }}>
            Cuentas que las contratistas pidieron desde el celular. Hasta que las apruebes no pueden entrar.
          </p>
        </div>
      </div>

      {exito && <div className="aviso info" role="status">{exito}</div>}

      {cargando && <div className={css.cargandoCaja} role="status">Cargando las solicitudes…</div>}
      {error && (
        <div className="aviso error" role="alert">
          {error}{" "}
          <button type="button" className={css.btnLink} onClick={recargar}>Intentar de nuevo</button>
        </div>
      )}

      {datos && datos.length === 0 && <div className="aviso info">No hay solicitudes pendientes.</div>}

      {datos && datos.length > 0 && (
        <>
          <p className={css.pista} style={{ marginBottom: 10 }} role="status">{textoPendientes(datos.length)}</p>
          <div className={css.tablaCaja}>
            <table className={css.tabla}>
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Equipo o línea</th>
                  <th scope="col">Contrato</th>
                  <th scope="col">Fecha de solicitud</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {datos.map((s) => (
                  <tr key={s.id} className={css.estRev}>
                    <td data-label="Nombre" className={css.colNombre}>
                      <div className={css.celdaDer}>
                        <span className={css.nombreFila}>{s.nombre}</span>
                        <span className={css.sub}>Cédula {s.cedulaFinal4 || "—"}</span>
                      </div>
                    </td>
                    <td data-label="Equipo o línea">{s.linea || "—"}</td>
                    <td data-label="Contrato" className={css.nowrap}>
                      <div className={css.celdaDer}>
                        {s.numeroContrato || "—"}
                        {s.inicio && s.fin && <span className={css.sub}>{fmtFecha(s.inicio)} a {fmtFecha(s.fin)}</span>}
                      </div>
                    </td>
                    <td data-label="Fecha de solicitud" className={css.num}>{fmtFechaSolicitud(s.solicitada)}</td>
                    <td data-label="Estado"><span className={css.estadoTxt}>Por revisar</span></td>
                    <td data-label="">
                      <div className={css.acciones} style={{ width: "100%" }}>
                        <button
                          type="button"
                          className={`${css.btn} ${css.btnChico}`}
                          onClick={() => { setExito(""); setAbierta(s); }}
                          aria-label={`Revisar la solicitud de ${s.nombre}`}
                        >
                          Revisar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PanelLateral abierto={abierta !== null} titulo={abierta ? `Solicitud de ${abierta.nombre}` : "Solicitud"} onCerrar={() => setAbierta(null)}>
        {abierta && (
          <PanelSolicitud
            key={abierta.id}
            id={abierta.id}
            onRechazar={() => setRechazando(abierta)}
            onCerrar={() => setAbierta(null)}
            onActualizada={(c) => modificar((l) => l.map((x) => (x.id === c.id ? solicitudActualizada(x, c) : x)))}
            onAprobada={(nombre, mensaje) => {
              quitar(abierta.id);
              setAbierta(null);
              setExito(mensaje ?? `${nombre} quedó aprobada.`);
            }}
          />
        )}
      </PanelLateral>

      <Dialogo
        abierto={rechazando !== null}
        titulo="¿Rechazar esta solicitud?"
        peligro
        onCerrar={() => setRechazando(null)}
      >
        {rechazando && (
          <CuerpoRechazar
            s={rechazando}
            onCancelar={() => setRechazando(null)}
            onRechazada={() => {
              quitar(rechazando.id);
              setExito(`Se rechazó la solicitud de ${rechazando.nombre}.`);
              setRechazando(null);
              setAbierta(null);
            }}
          />
        )}
      </Dialogo>
    </div>
  );
}
