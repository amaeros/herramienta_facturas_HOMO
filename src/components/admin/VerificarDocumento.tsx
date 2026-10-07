"use client";

import { useId, useRef, useState } from "react";
import {
  apiAdmin, esVencida, textoError, urlDocumento,
  type Contrato, type DocumentoSubido, type EstadoVerificacion, type FilaVerificacion, type Verificacion,
} from "./apiAdmin";
import { esPdf, MAX_BYTES, textoDelPdf } from "../archivos";
import {
  ayudaUsarDato, fmtFechaSolicitud, resumenVerificacion, textoEstadoVerificacion, textoFuenteVerificacion, textoTipoDocumento,
  textoValorVerificacion, textoVerificada,
} from "./helpers";
import { useDatos } from "./useDatos";
import css from "./admin.module.css";

interface Props {
  /** Trabajadora, o solicitud pendiente: las dos se verifican igual. */
  contratoId: number;
  /** El contrato cambió: se copió un dato del documento (`campo`) o se marcó como verificada (sin `campo`). */
  onContrato: (c: Contrato, campo?: string) => void;
}

interface Datos {
  documentos: DocumentoSubido[];
  verificacion: Verificacion;
}

const CLASE_ESTADO: Record<EstadoVerificacion, string> = {
  coincide: css.estOk,
  distinto: css.estRev,
  sin_dato: css.estNeutro,
};

/** Un valor largo (el objeto del contrato) se corta a unas líneas, con «Ver todo». */
function Valor({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  const largo = texto.length > 140;
  return (
    <>
      <span className={largo && !abierto ? css.valorCorto : css.valorTexto}>{texto}</span>
      {largo && (
        <button type="button" className={`${css.btnLink} ${css.btnLinkChico}`} onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}>
          {abierto ? "Ver menos" : "Ver todo"}
        </button>
      )}
    </>
  );
}

async function cargarTodo(contratoId: number): Promise<Datos> {
  const [documentos, verificacion] = await Promise.all([apiAdmin.documentos(contratoId), apiAdmin.verificacion(contratoId)]);
  return { documentos, verificacion };
}

/**
 * "Verificar con documento": el supervisor sube el PDF del contrato, del acta de prórroga o de la póliza; el navegador lee
 * el texto (pdf.js), el servidor lo interpreta y aquí se compara con lo que tiene la app. Cada dato distinto se puede
 * copiar del documento. Al final, «Marcar como verificada». Ver docs/ADMIN.md.
 */
export default function VerificarDocumento({ contratoId, onContrato }: Props) {
  const idTitulo = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const { datos, error, cargando, recargar, modificar } = useDatos(`verificar-${contratoId}`, () => cargarTodo(contratoId));
  const [ocupado, setOcupado] = useState(""); // lo que se está haciendo ("Leyendo el PDF…"); vacío = nada
  const [fallo, setFallo] = useState("");
  const [aviso, setAviso] = useState("");
  const [quitando, setQuitando] = useState<number | null>(null); // documento que se está por quitar (pide confirmar)
  const [usando, setUsando] = useState<string | null>(null);

  async function refrescar() {
    const nuevos = await cargarTodo(contratoId);
    modificar(() => nuevos);
  }

  /** Corre una acción del panel: muestra el error en el mismo lugar y no pisa el aviso de sesión vencida. */
  async function correr(texto: string, accion: () => Promise<void>) {
    setFallo("");
    setAviso("");
    setOcupado(texto);
    try {
      await accion();
    } catch (e) {
      if (!esVencida(e)) setFallo(textoError(e));
    } finally {
      setOcupado("");
    }
  }

  function alElegirArchivo(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    ev.target.value = ""; // para poder volver a elegir el mismo archivo
    if (!f) return;
    if (!esPdf(f)) {
      setAviso("");
      setFallo("Sube el documento en PDF.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setAviso("");
      setFallo("El PDF pesa más de 4 MB. Sube uno más liviano.");
      return;
    }
    void correr("Leyendo el PDF…", async () => {
      const texto = await textoDelPdf(f);
      await apiAdmin.subirDocumento(contratoId, f, texto);
      await refrescar();
      setAviso("Listo: el documento quedó guardado y comparado.");
    });
  }

  function quitar(d: DocumentoSubido) {
    setQuitando(null);
    void correr("Quitando el PDF…", async () => {
      await apiAdmin.quitarDocumento(d.id);
      await refrescar();
      setAviso("Se quitó el documento.");
    });
  }

  function usar(f: FilaVerificacion) {
    setUsando(f.campo);
    void correr("Copiando el dato…", async () => {
      try {
        const c = await apiAdmin.usarDelDocumento(contratoId, f.campo);
        onContrato(c, f.campo);
        await refrescar();
        setAviso(`${f.etiqueta}: ahora es el que dice el documento.`);
      } finally {
        setUsando(null);
      }
    });
  }

  function marcar() {
    void correr("Guardando…", async () => {
      const c = await apiAdmin.marcarVerificada(contratoId);
      onContrato(c);
      await refrescar();
    });
  }

  const hayDocumentos = (datos?.documentos.length ?? 0) > 0;
  const v = datos?.verificacion;

  return (
    <section className={css.verif} aria-labelledby={idTitulo}>
      <h3 id={idTitulo} className={css.h2}>Verificar con documento</h3>
      <p className={css.pista} style={{ margin: "0 0 12px" }}>
        Sube el contrato, el acta de prórroga o la póliza y compara lo que dicen con lo que tiene la app.
      </p>

      <input ref={entrada} type="file" accept="application/pdf,.pdf" hidden onChange={alElegirArchivo} tabIndex={-1} />
      <div className={css.acciones}>
        <button type="button" className={`${css.btn} ${css.btnSec}`} onClick={() => entrada.current?.click()} disabled={ocupado !== ""}>
          Subir contrato, acta o póliza (PDF)
        </button>
      </div>

      <div role="status" aria-live="polite">
        {ocupado && <p className={css.pista} style={{ marginTop: 10 }}>{ocupado}</p>}
        {aviso && !ocupado && <p className={css.pista} style={{ marginTop: 10 }}>{aviso}</p>}
      </div>
      {fallo && <div className="aviso error" role="alert" style={{ marginTop: 10 }}>{fallo}</div>}

      {cargando && <p className={css.pista} role="status" style={{ marginTop: 12 }}>Cargando los documentos…</p>}
      {error && (
        <div className="aviso error" role="alert" style={{ marginTop: 12 }}>
          {error}{" "}
          <button type="button" className={css.btnLink} onClick={recargar}>Intentar de nuevo</button>
        </div>
      )}

      {datos && !hayDocumentos && (
        <p className={css.pista} style={{ marginTop: 12 }}>Todavía no hay documentos subidos. Cuando subas uno, aquí sale la comparación.</p>
      )}

      {datos && hayDocumentos && (
        <>
          <ul className={css.items} style={{ marginTop: 16 }} aria-label="Documentos subidos">
            {datos.documentos.map((d) => (
              <li key={d.id} className={css.verifDoc}>
                <div className={css.verifDocCabecera}>
                  <div>
                    <strong>{textoTipoDocumento(d.tipo)}</strong>
                    <span className={css.sub}>Subido el {fmtFechaSolicitud(d.subido)}</span>
                    <span className={`${css.sub} ${css.valorTexto}`}>{d.nombreArchivo}</span>
                  </div>
                  <div className={css.acciones}>
                    <a className={css.enlace} href={urlDocumento(d.id)} target="_blank" rel="noopener noreferrer" aria-label={`Ver el PDF ${d.nombreArchivo}`}>
                      Ver PDF
                    </a>
                    {quitando === d.id ? (
                      <>
                        <button type="button" className={`${css.btn} ${css.btnPeligroLleno} ${css.btnChico}`} onClick={() => quitar(d)} disabled={ocupado !== ""}>
                          Sí, quitar
                        </button>
                        <button type="button" className={`${css.btn} ${css.btnSec} ${css.btnChico}`} onClick={() => setQuitando(null)}>
                          No
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={`${css.btn} ${css.btnPeligro} ${css.btnChico}`}
                        onClick={() => setQuitando(d.id)}
                        disabled={ocupado !== ""}
                        aria-label={`Quitar el PDF ${d.nombreArchivo}`}
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
                {d.notas.map((n, i) => (
                  <p key={i} className={css.pista}>{n}</p>
                ))}
              </li>
            ))}
          </ul>

          {v && (
            <>
              <p className={css.verifResumen} role="status">{resumenVerificacion(v.filas)}</p>
              <div className={css.tablaCaja}>
                <table className={`${css.tabla} ${css.tablaVerif}`}>
                  <thead>
                    <tr>
                      <th scope="col">Dato</th>
                      <th scope="col">Lo que tiene la app</th>
                      <th scope="col">Lo que dice el documento</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.filas.map((f) => {
                      const ayuda = ayudaUsarDato(f.campo);
                      return (
                        <tr key={f.campo} className={CLASE_ESTADO[f.estado]}>
                          <td data-label="" className={css.nombreFila}>{f.etiqueta}</td>
                          <td data-label="Lo que tiene la app">
                            <div className={css.valorCaja}>
                              <Valor texto={textoValorVerificacion(f.campo, f.actual)} />
                            </div>
                          </td>
                          <td data-label="Lo que dice el documento">
                            <div className={css.valorCaja}>
                              <Valor texto={textoValorVerificacion(f.campo, f.documento)} />
                              {f.fuente && <span className={css.sub}>{textoFuenteVerificacion(f.fuente)}</span>}
                            </div>
                          </td>
                          <td data-label="Estado">
                            <div className={css.celdaDer}>
                              <span className={css.estadoTxt}>{textoEstadoVerificacion(f.estado)}</span>
                              {f.estado === "distinto" && (
                                <>
                                  <button
                                    type="button"
                                    className={`${css.btn} ${css.btnSec} ${css.btnChico}`}
                                    style={{ marginTop: 8 }}
                                    onClick={() => usar(f)}
                                    disabled={ocupado !== ""}
                                    aria-label={`Usar el del documento: ${f.etiqueta}`}
                                  >
                                    {usando === f.campo ? "Copiando…" : "Usar el del documento"}
                                  </button>
                                  {ayuda && <span className={css.sub}>{ayuda}</span>}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className={css.verifCierre}>
                {v.verificadaEn ? (
                  <p className={css.verificada} role="status">{textoVerificada(v.verificadaEn)}</p>
                ) : (
                  <>
                    <button type="button" className={css.btn} onClick={marcar} disabled={ocupado !== ""}>
                      Marcar como verificada
                    </button>
                    <p className={css.pista}>
                      Márcala cuando hayas revisado la tabla. Si la contratista cambia después un dato de su contrato, la marca se quita y toca revisarla de nuevo.
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
