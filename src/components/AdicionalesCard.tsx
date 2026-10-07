"use client";

import { useState, type ChangeEvent } from "react";
import { MAX_ADICIONALES } from "./constantes";
import { MSG_FOTO, MSG_PESO, problemaArchivo } from "./archivos";
import { esSesionVencida, mensajeDeError } from "./api";
import { dinero, fmtMoney, labelMes, soloNumero } from "./formato";
import SelectorPeriodo from "./SelectorPeriodo";
import type { Adicional, RespPlanilla } from "./tipos";

interface Props {
  adicionales: Adicional[];
  mesKey: string;
  /** Sube el archivo de una planilla adicional (adicional='1'). Si la sesión venció, el padre ya volvió al paso 1. */
  subir: (file: File) => Promise<RespPlanilla>;
  onAgregar: (a: Adicional) => void;
  onQuitar: (i: number) => void;
}

/** "¿Pagaste más de una planilla?": hasta 3 planillas adicionales (correcciones, ajustes de ARL, otras). */
export default function AdicionalesCard({ adicionales, mesKey, subir, onAgregar, onQuitar }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [numero, setNumero] = useState("");
  const [mes, setMes] = useState("");
  const [anio, setAnio] = useState("");
  const [valor, setValor] = useState("");
  const [tempId, setTempId] = useState("");
  const [estado, setEstado] = useState("");
  const [error, setError] = useState("");
  const [faltas, setFaltas] = useState({ numero: false, periodo: false, valor: false });
  const [leyendo, setLeyendo] = useState(false);

  function abrir() {
    setNumero(""); setMes(""); setAnio(""); setValor(""); setTempId("");
    setEstado(""); setError("");
    setFaltas({ numero: false, periodo: false, valor: false });
    setAbierto(true);
  }

  function cerrar() {
    setAbierto(false);
    setTempId("");
  }

  async function alElegir(ev: ChangeEvent<HTMLInputElement>) {
    const input = ev.target;
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    setError("");
    const pa = problemaArchivo(file);
    if (pa) { setError(pa); return; }
    setEstado("Leyendo la planilla… puede tardar hasta 30 segundos.");
    setLeyendo(true);
    try {
      const r = await subir(file);
      setTempId(r.tempId);
      const l = r.lectura || {};
      if (l.numero) setNumero(l.numero);
      if (l.periodo && /^\d{4}-\d{2}$/.test(l.periodo)) { setMes(l.periodo.slice(5, 7)); setAnio(l.periodo.slice(0, 4)); }
      if (r.valor !== null && r.valor !== undefined) setValor(dinero(r.valor));
      setEstado(
        r.leyo
          ? "Archivo guardado. Revisa que el n.º, el mes y el valor sean los de esa planilla."
          : "Archivo guardado, pero no pudimos leerlo con seguridad. Escribe el n.º, el mes y el valor como aparecen en esa planilla.",
      );
    } catch (e) {
      if (esSesionVencida(e)) return;
      setEstado("");
      if (e instanceof Error && e.message === MSG_FOTO) setError("No pudimos abrir la foto. Intenta con otra o escribe los datos a mano.");
      else if (e instanceof Error && e.message === MSG_PESO) setError(MSG_PESO);
      else setError(mensajeDeError(e));
    } finally {
      setLeyendo(false);
    }
  }

  function agregar() {
    setError("");
    const num = numero.replace(/\s/g, "");
    const v = soloNumero(valor);
    const f = { numero: !num || !/^\d+$/.test(num), periodo: !(mes && anio), valor: !(v !== null && v > 0) };
    setFaltas(f);
    if (f.numero) { setError("Escribe el n.º de la planilla, solo con números."); return; }
    if (f.periodo) { setError("Escoge el mes cotizado de esa planilla."); return; }
    if (f.valor || v === null) { setError("Escribe el valor pagado: un número mayor que cero (sin signo menos y sin intereses de mora)."); return; }
    if (adicionales.length >= MAX_ADICIONALES) { setError("Ya agregaste 3 planillas adicionales, que es el máximo."); return; }
    onAgregar({ numero: num, periodo: anio + "-" + mes, valor: v, tempId });
    cerrar();
  }

  return (
    <div className="seccion">
      <h3>¿Pagaste más de una planilla?</h3>
      <p className="ayuda">
        Si este mes pagaste una corrección, un ajuste de ARL u otra planilla (por ejemplo de un mes anterior), agrégala para que salga en tu cuenta de cobro. Puedes agregar hasta 3.
      </p>
      {adicionales.length > 0 && (
        <ul className="adic-lista" aria-label="Planillas adicionales agregadas">
          {adicionales.map((a, i) => (
            <li key={i}>
              <span className="adic-datos">
                <strong>{"Planilla " + (i + 2)}</strong>
                <span className="cifra">{"n.º " + a.numero}</span>
                <span>{labelMes(a.periodo)}</span>
                <span className="cifra">{fmtMoney(a.valor)}</span>
                {a.tempId && <span>con PDF</span>}
              </span>
              <button type="button" className="quitar" aria-label={"Quitar la planilla " + (i + 2)} onClick={() => onQuitar(i)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      {!abierto && adicionales.length < MAX_ADICIONALES && (
        <button type="button" className="btn sec" onClick={abrir}>Agregar otra planilla (corrección o adicional)</button>
      )}
      {abierto && (
        <div className="adic-form">
          <h4>{"Planilla " + (adicionales.length + 2)}</h4>
          <input id="archivo-adic" className="oculto" type="file" accept="application/pdf,image/*" onChange={alElegir} />
          <label className="btn sec foco-archivo" htmlFor="archivo-adic">Subir el PDF o la foto de esa planilla (opcional)</label>
          {estado && <p className="ayuda" role="status">{estado}</p>}
          <div className={"dato" + (faltas.numero ? " falta" : "")}>
            <label className="et" htmlFor="a-numero">N.º de planilla (solo números)</label>
            <input
              id="a-numero" type="tel" inputMode="numeric" autoComplete="off" placeholder="Ej. 9509700001"
              value={numero} onChange={(e) => setNumero(e.target.value)}
            />
          </div>
          <div className={"dato" + (faltas.periodo ? " falta" : "")}>
            <span className="et">Mes cotizado de esa planilla</span>
            <SelectorPeriodo idMes="a-mes" idAnio="a-anio" mesKey={mesKey} mes={mes} anio={anio} onMes={setMes} onAnio={setAnio} />
          </div>
          <div className={"dato" + (faltas.valor ? " falta" : "")}>
            <label className="et" htmlFor="a-valor">Valor pagado sin intereses de mora ($)</label>
            <input
              id="a-valor" type="tel" inputMode="numeric" autoComplete="off" placeholder="Ej. 21.400"
              value={valor} onChange={(e) => setValor(e.target.value)}
              onBlur={() => { const n = soloNumero(valor); if (n !== null) setValor(dinero(n)); }}
            />
            <p className="ayuda" style={{ margin: "6px 0 0" }}>
              Escribe <strong>un solo valor</strong>: el total que pagaste en esa planilla (lo que sumaste de salud, pensión y ARL), <strong>sin los intereses de mora</strong>. Siempre en positivo, aunque sea una corrección.
            </p>
          </div>
          {error && <div className="aviso error" role="alert">{error}</div>}
          <button type="button" className="btn" disabled={leyendo} onClick={agregar}>Agregar esta planilla</button>
          <button type="button" className="link" onClick={cerrar}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
