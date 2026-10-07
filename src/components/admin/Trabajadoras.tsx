"use client";

import { useState } from "react";
import { AdminError, apiAdmin, textoError, type Contrato } from "./apiAdmin";
import Dialogo from "./Dialogo";
import FormularioTrabajadora from "./FormularioTrabajadora";
import ImportarExcel from "./ImportarExcel";
import { enmascararCedula, filtrarContratos, nombreCoincide, payloadDeContrato, pesos } from "./helpers";
import { useDatos } from "./useDatos";
import { fmtFecha } from "../formato";
import css from "./admin.module.css";

type Vista = { tipo: "lista" } | { tipo: "formulario"; contrato: Contrato | null } | { tipo: "importar" };
type Accion = { tipo: "borrar" | "desactivar"; c: Contrato };

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}

interface BorrarProps {
  c: Contrato;
  onCancelar: () => void;
  onBorrada: () => void;
  onDesactivar: () => void;
}

/** Contenido del diálogo de borrar: pide escribir el nombre si la trabajadora tiene cuentas. */
function CuerpoBorrar({ c, onCancelar, onBorrada, onDesactivar }: BorrarProps) {
  const [escrito, setEscrito] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const conCuentas = c.cargas > 0;
  const puede = !conCuentas || nombreCoincide(escrito, c.nombre);

  async function borrar() {
    setOcupado(true);
    setError("");
    try {
      await apiAdmin.borrarContrato(c.id, conCuentas ? escrito.trim() : undefined);
      onBorrada();
    } catch (e) {
      if (!(e instanceof AdminError && e.status === 401)) setError(textoError(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {conCuentas ? (
        <>
          <p>
            <strong>{c.nombre}</strong> tiene <strong>{c.cargas}</strong> {plural(c.cargas, "cuenta enviada", "cuentas enviadas")}.
          </p>
          <p>
            Si la borras, <strong>también se borran sus cuentas, sus planillas y sus archivos</strong>. Esto no se puede deshacer.
          </p>
          {c.activo && (
            <div className="aviso info">
              <strong>¿Solo quieres que no aparezca en el celular?</strong> Mejor <strong>desactívala</strong>: sus cuentas se conservan y la puedes activar cuando quieras.
              <div style={{ marginTop: 10 }}>
                <button type="button" className={`${css.btn} ${css.btnSec} ${css.btnChico}`} onClick={onDesactivar} disabled={ocupado}>
                  ⏸️ Desactivar en vez de borrar
                </button>
              </div>
            </div>
          )}
          <div className={css.campo}>
            <label className={css.etiqueta} htmlFor="confirmar-nombre">
              Para borrarla, escribe su nombre completo:
            </label>
            <p className={css.pista} style={{ margin: "0 0 8px" }}>{c.nombre}</p>
            <input
              id="confirmar-nombre"
              type="text"
              className={css.texto}
              value={escrito}
              onChange={(e) => setEscrito(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        </>
      ) : (
        <p>
          ¿Seguro que quieres borrar a <strong>{c.nombre}</strong>? No tiene cuentas enviadas. Esto no se puede deshacer.
        </p>
      )}
      {error && <div className="aviso error" role="alert">{error}</div>}
      <div className={css.accionesFin}>
        <button type="button" className={`${css.btn} ${css.btnPeligroLleno}`} onClick={borrar} disabled={!puede || ocupado}>
          {ocupado ? "Borrando…" : "🗑️ Sí, borrar"}
        </button>
        <button type="button" className={`${css.btn} ${css.btnSec}`} onClick={onCancelar} disabled={ocupado}>
          No, cancelar
        </button>
      </div>
    </>
  );
}

interface DesactivarProps {
  c: Contrato;
  onCancelar: () => void;
  onConfirmar: () => Promise<string>;
}

function CuerpoDesactivar({ c, onCancelar, onConfirmar }: DesactivarProps) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  async function confirmar() {
    setOcupado(true);
    setError("");
    const msg = await onConfirmar();
    if (msg) {
      setError(msg);
      setOcupado(false);
    }
  }
  return (
    <>
      <p>
        ¿Desactivar a <strong>{c.nombre}</strong>? Ya no aparecerá en la lista del celular y no podrá enviar cuentas. Sus cuentas anteriores se conservan y la puedes activar de nuevo cuando quieras.
      </p>
      {error && <div className="aviso error" role="alert">{error}</div>}
      <div className={css.accionesFin}>
        <button type="button" className={css.btn} onClick={confirmar} disabled={ocupado}>
          {ocupado ? "Desactivando…" : "⏸️ Sí, desactivar"}
        </button>
        <button type="button" className={`${css.btn} ${css.btnSec}`} onClick={onCancelar} disabled={ocupado}>
          No, cancelar
        </button>
      </div>
    </>
  );
}

/** Pantalla "Trabajadoras": lista con buscador, crear, editar, activar/desactivar, borrar e importar. */
export default function Trabajadoras() {
  const { datos, error, cargando, recargar, modificar } = useDatos("contratos", () => apiAdmin.contratos());
  const [vista, setVista] = useState<Vista>({ tipo: "lista" });
  const [busqueda, setBusqueda] = useState("");
  const [exito, setExito] = useState("");
  const [fallo, setFallo] = useState("");
  const [accion, setAccion] = useState<Accion | null>(null);
  const [ocupadoId, setOcupadoId] = useState<number | null>(null);

  function volverALista(mensaje: string | null) {
    setVista({ tipo: "lista" });
    if (mensaje) setExito(mensaje);
  }

  async function cambiarActivo(c: Contrato, activo: boolean): Promise<string> {
    setOcupadoId(c.id);
    setFallo("");
    try {
      const nuevo = await apiAdmin.editarContrato(c.id, payloadDeContrato(c, { activo }));
      modificar((lista) => lista.map((x) => (x.id === nuevo.id ? { ...nuevo, cargas: x.cargas } : x)));
      setExito(activo ? `${c.nombre} quedó activa.` : `${c.nombre} quedó desactivada.`);
      setAccion(null);
      return "";
    } catch (e) {
      const msg = e instanceof AdminError && e.status === 401 ? "" : textoError(e);
      if (msg) setFallo(msg);
      return msg || " ";
    } finally {
      setOcupadoId(null);
    }
  }

  if (vista.tipo === "formulario") {
    return (
      <FormularioTrabajadora
        inicial={vista.contrato}
        onCancelar={() => volverALista(null)}
        onGuardado={(c) => {
          modificar((lista) => {
            const existe = lista.some((x) => x.id === c.id);
            const siguiente = existe ? lista.map((x) => (x.id === c.id ? { ...c, cargas: x.cargas } : x)) : [...lista, c];
            return siguiente.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
          });
          volverALista(vista.contrato ? `Se guardaron los cambios de ${c.nombre}.` : `${c.nombre} quedó creada.`);
        }}
      />
    );
  }

  if (vista.tipo === "importar") {
    return (
      <ImportarExcel
        onTerminar={(m) => {
          if (m) recargar();
          volverALista(m);
        }}
      />
    );
  }

  const lista = datos ? filtrarContratos(datos, busqueda) : [];

  return (
    <div className={css.pagina} role="main">
      <div className={css.encabezadoPagina}>
        <div>
          <h1 className={css.h1}>Trabajadoras</h1>
          <p className={css.lead} style={{ margin: 0 }}>Aquí agregas, corriges o desactivas a las contratistas.</p>
        </div>
        <div className={css.acciones}>
          <button type="button" className={css.btn} onClick={() => { setExito(""); setFallo(""); setVista({ tipo: "formulario", contrato: null }); }}>
            ➕ Nueva trabajadora
          </button>
          <button type="button" className={`${css.btn} ${css.btnSec}`} onClick={() => { setExito(""); setFallo(""); setVista({ tipo: "importar" }); }}>
            📥 Importar desde Excel
          </button>
        </div>
      </div>

      {exito && <div className="aviso info" role="status">✅ {exito}</div>}
      {fallo && <div className="aviso error" role="alert">{fallo}</div>}

      {cargando && (
        <div className={css.cargandoCaja} role="status">
          <span className={css.rueda} aria-hidden="true" />
          Cargando la lista…
        </div>
      )}
      {error && (
        <div className="aviso error" role="alert">
          {error}{" "}
          <button type="button" className={css.btnLink} onClick={recargar}>Intentar de nuevo</button>
        </div>
      )}

      {datos && (
        <>
          <div className={`${css.campo} ${css.buscador}`}>
            <label className={css.etiqueta} htmlFor="buscar">Buscar trabajadora</label>
            <input
              id="buscar"
              type="search"
              className={css.texto}
              placeholder="Escribe un nombre…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              autoComplete="off"
            />
          </div>

          <p className={css.pista} style={{ marginBottom: 10 }} role="status">
            {busqueda ? `${lista.length} de ${datos.length}` : `${datos.length}`} {plural(datos.length, "trabajadora", "trabajadoras")}
          </p>

          {lista.length === 0 ? (
            <div className="aviso info">
              {datos.length === 0 ? "Todavía no hay trabajadoras. Toca «Nueva trabajadora» o «Importar desde Excel»." : "No encontramos a nadie con ese nombre."}
            </div>
          ) : (
            <div className={css.tablaCaja}>
              <table className={css.tabla}>
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Contrato</th>
                    <th scope="col" className={css.num}>Honorario</th>
                    <th scope="col">Riesgo</th>
                    <th scope="col">Fechas</th>
                    <th scope="col">Activa</th>
                    <th scope="col" className={css.num}>Cuentas</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((c) => (
                    <tr key={c.id} className={c.activo ? undefined : css.inactiva}>
                      <td data-label="Nombre">
                        <div className={css.celdaDer}>
                          <span className={css.nombreFila}>{c.nombre}</span>
                          <span className={css.sub}>Cédula {enmascararCedula(c.cedula)}</span>
                        </div>
                      </td>
                      <td data-label="Contrato">{c.numeroContrato || <span className={css.opcional}>Por completar</span>}</td>
                      <td data-label="Honorario" className={css.num}>{pesos(c.honorario)}</td>
                      <td data-label="Riesgo">
                        <div className={css.celdaDer}>
                          {c.riesgo}
                          {c.riesgoNuevo && <span className={css.sub}>→ {c.riesgoNuevo} desde {fmtFecha(c.riesgoDesde)}</span>}
                        </div>
                      </td>
                      <td data-label="Fechas">{c.inicio ? fmtFecha(c.inicio) : "—"} a {c.fin ? fmtFecha(c.fin) : "—"}</td>
                      <td data-label="Activa">
                        <span className={`${css.pastilla} ${c.activo ? css.pOk : css.pGris}`}>{c.activo ? "Sí" : "No"}</span>
                      </td>
                      <td data-label="Cuentas" className={css.num}>{c.cargas}</td>
                      <td data-label="">
                        <div className={css.acciones} style={{ width: "100%" }}>
                          <button
                            type="button"
                            className={`${css.btn} ${css.btnSec} ${css.btnChico}`}
                            onClick={() => { setExito(""); setFallo(""); setVista({ tipo: "formulario", contrato: c }); }}
                            aria-label={`Editar a ${c.nombre}`}
                          >
                            ✏️ Editar
                          </button>
                          {c.activo ? (
                            <button
                              type="button"
                              className={`${css.btn} ${css.btnSec} ${css.btnChico}`}
                              onClick={() => setAccion({ tipo: "desactivar", c })}
                              disabled={ocupadoId === c.id}
                              aria-label={`Desactivar a ${c.nombre}`}
                            >
                              ⏸️ Desactivar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={`${css.btn} ${css.btnSec} ${css.btnChico}`}
                              onClick={() => { setExito(""); void cambiarActivo(c, true); }}
                              disabled={ocupadoId === c.id}
                              aria-label={`Activar a ${c.nombre}`}
                            >
                              ▶️ Activar
                            </button>
                          )}
                          <button
                            type="button"
                            className={`${css.btn} ${css.btnPeligro} ${css.btnChico}`}
                            onClick={() => setAccion({ tipo: "borrar", c })}
                            aria-label={`Borrar a ${c.nombre}`}
                          >
                            🗑️ Borrar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Dialogo
        abierto={accion?.tipo === "borrar"}
        titulo="¿Borrar a esta trabajadora?"
        peligro
        onCerrar={() => setAccion((a) => (a?.tipo === "borrar" ? null : a))}
      >
        {accion?.tipo === "borrar" && (
          <CuerpoBorrar
            c={accion.c}
            onCancelar={() => setAccion(null)}
            onDesactivar={() => setAccion({ tipo: "desactivar", c: accion.c })}
            onBorrada={() => {
              const c = accion.c;
              modificar((l) => l.filter((x) => x.id !== c.id));
              setAccion(null);
              setExito(`${c.nombre} se borró.`);
            }}
          />
        )}
      </Dialogo>

      <Dialogo
        abierto={accion?.tipo === "desactivar"}
        titulo="¿Desactivar a esta trabajadora?"
        onCerrar={() => setAccion((a) => (a?.tipo === "desactivar" ? null : a))}
      >
        {accion?.tipo === "desactivar" && (
          <CuerpoDesactivar c={accion.c} onCancelar={() => setAccion(null)} onConfirmar={() => cambiarActivo(accion.c, false)} />
        )}
      </Dialogo>
    </div>
  );
}
