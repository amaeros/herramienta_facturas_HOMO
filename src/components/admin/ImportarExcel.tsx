"use client";

import { useRef, useState } from "react";
import { apiAdmin, textoError, type ResumenImportacion } from "./apiAdmin";
import { etiquetaCampo, ultimos4, valorCambio } from "./helpers";
import css from "./admin.module.css";

const MAX_BYTES = 1024 * 1024;

type Fase =
  | { tipo: "elegir" }
  | { tipo: "revisando" }
  | { tipo: "previa"; archivo: File; resumen: ResumenImportacion }
  | { tipo: "aplicando"; archivo: File; resumen: ResumenImportacion }
  | { tipo: "listo"; resumen: ResumenImportacion };

interface Props {
  onTerminar: (mensaje: string | null) => void;
}

function problemaArchivo(f: File): string {
  if (!/\.xlsx$/i.test(f.name)) return "El archivo tiene que ser de Excel (.xlsx). Si es un .xls, ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)».";
  if (f.size > MAX_BYTES) return "El archivo pesa más de 1 MB. Revisa que sea solo la hoja de control.";
  if (f.size === 0) return "El archivo está vacío.";
  return "";
}

function Conteos({ r }: { r: ResumenImportacion }) {
  return (
    <ul className={css.resumen} aria-label="Resumen de la importación">
      <li><strong>{r.crear.length}</strong> {r.crear.length === 1 ? "nueva" : "nuevas"}</li>
      <li><strong>{r.actualizar.length}</strong> con cambios</li>
      <li><strong>{r.sinCambios}</strong> sin cambios</li>
      <li><strong>{r.errores.length}</strong> con problemas</li>
    </ul>
  );
}

/** Importar trabajadoras desde el Excel de control: subir, ver qué pasaría y aplicar. */
export default function ImportarExcel({ onTerminar }: Props) {
  const [fase, setFase] = useState<Fase>({ tipo: "elegir" });
  const [error, setError] = useState("");
  const entrada = useRef<HTMLInputElement>(null);

  async function elegido(ev: React.ChangeEvent<HTMLInputElement>) {
    const archivo = ev.target.files?.[0];
    ev.target.value = ""; // permite volver a escoger el mismo archivo
    if (!archivo) return;
    const p = problemaArchivo(archivo);
    if (p) {
      setError(p);
      return;
    }
    setError("");
    setFase({ tipo: "revisando" });
    try {
      const resumen = await apiAdmin.importar(archivo, false);
      setFase({ tipo: "previa", archivo, resumen });
    } catch (e) {
      setError(textoError(e));
      setFase({ tipo: "elegir" });
    }
  }

  async function aplicar() {
    if (fase.tipo !== "previa") return;
    const { archivo, resumen } = fase;
    setError("");
    setFase({ tipo: "aplicando", archivo, resumen });
    try {
      const final = await apiAdmin.importar(archivo, true);
      setFase({ tipo: "listo", resumen: final });
    } catch (e) {
      setError(textoError(e));
      setFase({ tipo: "previa", archivo, resumen });
    }
  }

  const ocupado = fase.tipo === "revisando" || fase.tipo === "aplicando";
  const previa = fase.tipo === "previa" || fase.tipo === "aplicando" ? fase.resumen : null;
  const nada = previa ? previa.crear.length + previa.actualizar.length === 0 : true;

  return (
    <div className={css.pagina} role="main">
      <button type="button" className={css.volver} onClick={() => onTerminar(null)} disabled={ocupado}>Volver a la lista</button>
      <h1 className={css.h1}>Importar desde Excel</h1>
      <p className={css.lead}>
        Sube el Excel de control de las trabajadoras. Primero te mostramos qué cambiaría y solo se guarda cuando toques «Aplicar cambios».
      </p>

      {error && <div className="aviso error" role="alert">{error}</div>}

      {(fase.tipo === "elegir" || fase.tipo === "revisando") && (
        <section className={css.zonaArchivo}>
          <input ref={entrada} id="archivo-excel" className="oculto" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={elegido} disabled={ocupado} />
          <label htmlFor="archivo-excel" className={`${css.btn} foco-archivo`} style={{ display: "inline-flex" }} aria-disabled={ocupado}>
            Escoger el archivo de Excel
          </label>
          <p className={css.pista}>Formato .xlsx, máximo 1 MB y 200 filas. El archivo no se guarda.</p>
          {fase.tipo === "revisando" && (
            <p role="status" style={{ marginTop: 12 }}>Revisando el archivo…</p>
          )}
        </section>
      )}

      {previa && (
        <>
          <h2 className={css.h2}>Esto es lo que pasaría</h2>
          <Conteos r={previa} />

          {previa.crear.length > 0 && (
            <section className={css.bloque}>
              <h3>Se van a crear ({previa.crear.length})</h3>
              <ul className={css.items}>
                {previa.crear.map((c, i) => (
                  <li key={i}>{c.nombre} <span className={css.opcional}>(cédula {ultimos4(c.cedulaFinal4)})</span></li>
                ))}
              </ul>
            </section>
          )}

          {previa.actualizar.length > 0 && (
            <section className={css.bloque}>
              <h3>Se van a actualizar ({previa.actualizar.length})</h3>
              <ul className={css.items}>
                {previa.actualizar.map((a) => (
                  <li key={a.id}>
                    <strong>{a.nombre}</strong>
                    {a.cambios.map((c, i) => (
                      <p key={i} className={css.cambio}>
                        {c.etiqueta || etiquetaCampo(c.campo)}: <span className={css.antes}>{valorCambio(c.campo, c.antes)}</span>, ahora <span className={css.despues}>{valorCambio(c.campo, c.despues)}</span>
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {previa.errores.length > 0 && (
            <section className={css.bloque}>
              <h3>Filas con problemas ({previa.errores.length})</h3>
              <p className={css.pista} style={{ marginBottom: 8 }}>Estas filas se saltan y no se guardan. Corrígelas en el Excel si las necesitas.</p>
              <ul className={css.items}>
                {previa.errores.map((e, i) => (
                  <li key={i}>Fila {e.fila}: {e.mensaje}</li>
                ))}
              </ul>
            </section>
          )}

          {nada && <div className="aviso info">No hay nada que crear ni actualizar con este archivo.</div>}

          <div className={css.accionesFin}>
            <button type="button" className={css.btn} onClick={aplicar} disabled={nada || ocupado}>
              {fase.tipo === "aplicando" ? "Aplicando…" : "Aplicar cambios"}
            </button>
            <button
              type="button"
              className={`${css.btn} ${css.btnSec}`}
              onClick={() => { setError(""); setFase({ tipo: "elegir" }); }}
              disabled={ocupado}
            >
              Escoger otro archivo
            </button>
            <button type="button" className={`${css.btn} ${css.btnSec}`} onClick={() => onTerminar(null)} disabled={ocupado}>Cancelar</button>
          </div>
        </>
      )}

      {fase.tipo === "listo" && (
        <>
          <div className="aviso info" role="status">
            Listo. Se crearon <strong>{fase.resumen.crear.length}</strong> y se actualizaron <strong>{fase.resumen.actualizar.length}</strong> trabajadoras.
            {fase.resumen.errores.length > 0 && <> {fase.resumen.errores.length} filas con problemas se saltaron.</>}
          </div>
          <Conteos r={fase.resumen} />
          <button
            type="button"
            className={css.btn}
            onClick={() => onTerminar(`Importación lista: ${fase.resumen.crear.length} nuevas y ${fase.resumen.actualizar.length} actualizadas.`)}
          >
            Ver la lista actualizada
          </button>
        </>
      )}
    </div>
  );
}
