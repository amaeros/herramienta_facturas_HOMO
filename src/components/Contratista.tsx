"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { esSesionVencida, llamar, mensajeDeError, postJson, putJson } from "./api";
import { cargarPdfjs, MSG_FOTO, MSG_PESO, prepararArchivo, problemaArchivo } from "./archivos";
import Cargando from "./Cargando";
import { DEBOUNCE_EVALUAR_MS } from "./constantes";
import { tituloNombre } from "./formato";
import type { HojaDatos } from "./Hoja";
import { datosDeInputs, faltaAlgo, INPUTS_VACIOS, inputsDeLectura, type Inputs } from "./lectura";
import PasoDatos from "./PasoDatos";
import PasoFinal from "./PasoFinal";
import { diasManualDeMotivo, esError, MES_COMPLETO, periodoElegido, type EleccionPeriodo } from "./periodo";
import PasoLogin from "./PasoLogin";
import type { FormMiContrato } from "./miContrato";
import PasoMiContrato from "./PasoMiContrato";
import PasoRegistro from "./PasoRegistro";
import PasoVerificar from "./PasoVerificar";
import Progreso from "./Progreso";
import type {
  Adicional, DatosMiContrato, DiasManualPayload, Evaluacion, MesInfo, RespEnviar, RespEvaluar, RespGuardarMiContrato,
  RespLogin, RespMiContrato, RespPlanilla, Resumen,
} from "./tipos";

/** "perfil" = "Antes de empezar" (primera vez); "contrato" = "Mis datos del contrato" (se abre desde el paso 2). */
type Pantalla = "login" | "registro" | "perfil" | "datos" | "contrato" | "cargando" | "verificar" | "final";

const NOTA_NO_LEYO = "No pudimos leer tu planilla con seguridad. Escribe estos datos como aparecen en tu planilla.";

export default function Contratista() {
  const [pantalla, setPantalla] = useState<Pantalla>("login");
  const [aviso, setAviso] = useState<{ msg: string; tipo: "error" | "info" } | null>(null);
  const [espera, setEspera] = useState<{ titulo: string; texto: string; paso: 2 | 3 }>({ titulo: "", texto: "", paso: 2 });

  const [contrato, setContrato] = useState<Resumen | null>(null);
  const [mesKey, setMesKey] = useState("");
  const [eleccion, setEleccion] = useState<EleccionPeriodo>(MES_COMPLETO);

  const [tempId, setTempId] = useState("");
  const [leyo, setLeyo] = useState(false);
  const [nota, setNota] = useState("");
  const [inputs, setInputs] = useState<Inputs>(INPUTS_VACIOS);
  const [edicion, setEdicion] = useState(false);
  const [sucio, setSucio] = useState(false);
  const [evaluando, setEvaluando] = useState(false);
  const [evaluacion, setEvaluacion] = useState<Evaluacion | null>(null);
  const [adicionales, setAdicionales] = useState<Adicional[]>([]);
  const [ediciones, setEdiciones] = useState(0);
  const [final, setFinal] = useState<RespEnviar | null>(null);
  const [refrescando, setRefrescando] = useState(false);

  // Para descartar respuestas viejas de /api/evaluar: una por petición y otra por cada edición
  const reqEval = useRef(0);
  const verEdicion = useRef(0);
  const ocupado = useRef(false);

  const mes: MesInfo | null = contrato ? contrato.meses.find((m) => m.key === mesKey) ?? contrato.meses[0] ?? null : null;

  // ---------------------------------------------------------------- avisos y navegación
  const avisar = useCallback((msg: string, tipo: "error" | "info" = "error") => {
    setAviso({ msg, tipo });
    window.scrollTo(0, 0);
  }, []);
  const limpiarAviso = useCallback(() => setAviso(null), []);

  function mostrar(p: Pantalla) {
    setPantalla(p);
    window.scrollTo(0, 0);
  }

  /** `paso` solo sirve para dibujar el progreso: 2 = leyendo la planilla, 3 = generando la cuenta. */
  function esperar(titulo: string, texto: string, paso: 2 | 3) {
    setEspera({ titulo, texto, paso });
    mostrar("cargando");
  }

  /** Borra todo lo de la sesión y vuelve al paso 1 (con un mensaje si hace falta). */
  const volverALogin = useCallback((msg?: string) => {
    reqEval.current++;
    verEdicion.current++;
    ocupado.current = false;
    setContrato(null);
    setMesKey("");
    setEleccion(MES_COMPLETO);
    setTempId("");
    setLeyo(false);
    setNota("");
    setInputs(INPUTS_VACIOS);
    setEdicion(false);
    setSucio(false);
    setEvaluando(false);
    setEvaluacion(null);
    setAdicionales([]);
    setEdiciones(0);
    setFinal(null);
    setRefrescando(false);
    setAviso(msg ? { msg, tipo: "error" } : null);
    setPantalla("login");
    window.scrollTo(0, 0);
  }, []);

  /** Cualquier 401 de una ruta de la contratista: de vuelta al paso 1 con el mensaje del servidor. */
  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    try {
      return await llamar<T>(url, init);
    } catch (e) {
      if (esSesionVencida(e)) volverALogin(mensajeDeError(e));
      throw e;
    }
  }

  async function apiJson<T>(url: string, cuerpo: unknown): Promise<T> {
    try {
      return await postJson<T>(url, cuerpo);
    } catch (e) {
      if (esSesionVencida(e)) volverALogin(mensajeDeError(e));
      throw e;
    }
  }

  /** Muestra el error en el banner, salvo que ya nos hayamos ido al paso 1 por sesión vencida (ahí el mensaje ya está). */
  function errorEnBanner(e: unknown) {
    if (!esSesionVencida(e)) avisar(mensajeDeError(e));
  }

  // ---------------------------------------------------------------- paso 1 -> 2
  function empezarMes(c: Resumen, key: string) {
    const m = c.meses.find((x) => x.key === key) ?? c.meses[0];
    setMesKey(m ? m.key : "");
    setEleccion(MES_COMPLETO); // cambiar de mes siempre vuelve a "El mes completo"
    setAdicionales([]);
  }

  async function entrar(nombre: string, pin: string) {
    try {
      const r = await postJson<RespLogin>("/api/login", { nombre, pin });
      setContrato(r.contrato);
      empezarMes(r.contrato, r.contrato.mesDefault);
      setAviso(null);
      // si le faltan datos del contrato, los completa primero (una sola vez)
      mostrar(r.contrato.perfilCompleto ? "datos" : "perfil");
    } catch (e) {
      avisar(mensajeDeError(e));
    }
  }

  // pdf.js se baja en cuanto la persona entra, para que esté listo cuando suba la planilla (solo en el navegador)
  useEffect(() => {
    if (contrato) void cargarPdfjs();
  }, [contrato]);

  async function salir() {
    try {
      await llamar("/api/logout", { method: "POST" });
    } catch {
      /* da igual: se borra todo de este lado */
    }
    volverALogin();
  }

  // ---------------------------------------------------------------- mis datos del contrato (se abre desde el paso 2)
  async function cargarMiContrato(): Promise<DatosMiContrato> {
    return (await api<RespMiContrato>("/api/mi-contrato")).datos;
  }

  async function guardarMiContrato(cambios: Partial<FormMiContrato>): Promise<RespGuardarMiContrato> {
    try {
      return await putJson<RespGuardarMiContrato>("/api/mi-contrato", cambios);
    } catch (e) {
      if (esSesionVencida(e)) volverALogin(mensajeDeError(e));
      throw e;
    }
  }

  /** Con el contrato ya guardado: se refresca la lista de meses (como tras entrar) y se sigue al paso 2. */
  function alGuardarMiContrato(c: Resumen) {
    const primeraVez = pantalla === "perfil";
    setContrato(c);
    empezarMes(c, c.meses.some((m) => m.key === mesKey) ? mesKey : c.mesDefault);
    if (primeraVez) setAviso(null);
    else avisar("Cambios guardados", "info");
    mostrar("datos");
  }

  // ---------------------------------------------------------------- paso 2
  function cambiarMes(key: string) {
    if (!contrato) return;
    setAviso(null);
    empezarMes(contrato, key);
  }

  /** Lo que resulta de "¿Qué vas a cobrar?" (periodo, días y valor) o por qué no se puede todavía. */
  const elegido = contrato && mes ? periodoElegido(mes, contrato, eleccion.opcion, eleccion.del, eleccion.al) : null;

  function fechasActuales(): { inicio: string; corte: string } {
    if (elegido && !esError(elegido)) return { inicio: elegido.inicio, corte: elegido.corte };
    return { inicio: mes?.inicio ?? "", corte: mes?.corte ?? "" };
  }

  /** La herramienta cuenta los días sola: lo único que viaja en `diasManual` es el motivo (con los días ya contados). */
  function diasManualActual(): DiasManualPayload | null {
    return elegido ? diasManualDeMotivo(eleccion.opcion, elegido, eleccion.motivo) : null;
  }

  function adicionalesPayload(lista: Adicional[] = adicionales) {
    return lista.map((a) => ({ numero: a.numero, periodo: a.periodo, valor: a.valor, tempId: a.tempId || "" }));
  }

  /** Manda el archivo a /api/planilla (multipart) con el texto que sacó pdf.js. */
  async function subirPlanilla(file: File, esAdicional: boolean): Promise<RespPlanilla> {
    const listo = await prepararArchivo(file);
    const f = fechasActuales();
    const fd = new FormData();
    fd.append("archivo", listo.archivo, listo.archivo.name);
    fd.append("texto", listo.texto);
    fd.append("mes", mesKey);
    fd.append("fechaInicio", f.inicio);
    fd.append("fechaCorte", f.corte);
    fd.append("adicionales", JSON.stringify(esAdicional ? [] : adicionalesPayload()));
    fd.append("diasManual", JSON.stringify(esAdicional ? null : diasManualActual()));
    if (esAdicional) fd.append("adicional", "1");
    return api<RespPlanilla>("/api/planilla", { method: "POST", body: fd });
  }

  async function alElegirArchivo(file: File) {
    setAviso(null);
    const pa = problemaArchivo(file);
    if (pa) { avisar(pa); return; }
    if (elegido && esError(elegido)) {
      // el error ya está junto al campo: se lleva a la persona hasta allí
      document.getElementById(elegido.campo === "al" ? "f-al" : "f-del")?.focus();
      return;
    }
    esperar("Leyendo tu planilla…", "Esto puede tardar hasta 30 segundos. No cierres esta pantalla.", 2);
    try {
      const r = await subirPlanilla(file, false);
      reqEval.current++;
      verEdicion.current++;
      const nuevos = inputsDeLectura(r.lectura);
      const d = datosDeInputs(nuevos);
      setTempId(r.tempId);
      setLeyo(!!r.leyo);
      setEvaluacion(r.evaluacion || null);
      setSucio(false);
      setEvaluando(false);
      setInputs(nuevos);
      setEdicion(!r.leyo || faltaAlgo(d));
      setNota(r.leyo ? "" : NOTA_NO_LEYO);
      mostrar("verificar");
    } catch (e) {
      if (esSesionVencida(e)) return;
      mostrar("datos");
      if (e instanceof Error && e.message === MSG_FOTO) avisar("No pudimos abrir la foto. Intenta con otra o sube el PDF.");
      else if (e instanceof Error && e.message === MSG_PESO) avisar(MSG_PESO);
      else avisar(mensajeDeError(e));
    }
  }

  // ---------------------------------------------------------------- paso 3
  /** Pide al servidor revisar los datos actuales (principal + adicionales + días a mano) sin guardar nada. */
  async function evaluarAhora(lista: Adicional[] = adicionales): Promise<void> {
    const miReq = ++reqEval.current;
    const miVer = verEdicion.current;
    const f = fechasActuales();
    setEvaluando(true);
    try {
      const r = await apiJson<RespEvaluar>("/api/evaluar", {
        mes: mesKey,
        fechaInicio: f.inicio,
        fechaCorte: f.corte,
        datos: datosDeInputs(inputs),
        adicionales: adicionalesPayload(lista),
        diasManual: diasManualActual(),
      });
      if (miReq !== reqEval.current || miVer !== verEdicion.current) return; // llegó tarde: hay algo más nuevo
      setEvaluacion(r.evaluacion);
      setSucio(false);
    } catch (e) {
      if (miReq === reqEval.current) setSucio(true); // sin revisión valida no se puede enviar
      errorEnBanner(e);
    } finally {
      if (miReq === reqEval.current) setEvaluando(false);
    }
  }

  // Revisión automática: unos instantes después de la última edición
  const dispararEvaluacion = useEffectEvent(() => { void evaluarAhora(); });
  useEffect(() => {
    if (!ediciones) return;
    const t = setTimeout(() => dispararEvaluacion(), DEBOUNCE_EVALUAR_MS);
    return () => clearTimeout(t);
  }, [ediciones]);

  function alEditar(cambio: Partial<Inputs>) {
    const siguiente = { ...inputs, ...cambio };
    setInputs(siguiente);
    // Si solo cambió el formato (por ejemplo '358700' -> '358.700'), no hay nada nuevo que revisar
    if (JSON.stringify(datosDeInputs(siguiente)) === JSON.stringify(datosDeInputs(inputs))) return;
    verEdicion.current++;
    setSucio(true);
    setEdiciones((n) => n + 1);
  }

  function corregir() {
    setEdicion(true);
    setSucio(false);
    setTimeout(() => document.getElementById("i-numero")?.focus(), 0);
  }

  function revisarDeNuevo() {
    setAviso(null);
    setEdiciones(0); // cancela la revisión automática pendiente: se hace ya
    void evaluarAhora();
  }

  function agregarAdicional(a: Adicional) {
    const lista = [...adicionales, a];
    setAdicionales(lista);
    void evaluarAhora(lista);
  }

  function quitarAdicional(i: number) {
    const lista = adicionales.filter((_, j) => j !== i);
    setAdicionales(lista);
    void evaluarAhora(lista);
  }

  async function enviar() {
    if (ocupado.current) return;
    setAviso(null);
    ocupado.current = true;
    const f = fechasActuales();
    esperar(
      "Generando tu cuenta de cobro…",
      "Estamos guardando tu planilla y armando la cuenta de cobro en Excel. Puede tardar hasta un minuto.",
      3,
    );
    try {
      const r = await apiJson<RespEnviar>("/api/enviar", {
        mes: mesKey,
        fechaInicio: f.inicio,
        fechaCorte: f.corte,
        datos: datosDeInputs(inputs),
        tempId,
        adicionales: adicionalesPayload(),
        diasManual: diasManualActual(),
      });
      setFinal(r);
      mostrar("final");
    } catch (e) {
      if (!esSesionVencida(e)) {
        mostrar("verificar");
        avisar(mensajeDeError(e));
      }
    } finally {
      ocupado.current = false;
    }
  }

  // ---------------------------------------------------------------- paso 4
  async function otroMes() {
    setAviso(null);
    setRefrescando(true);
    try {
      const r = await api<{ ok: true; contrato: Resumen }>("/api/sesion");
      setTempId("");
      setEvaluacion(null);
      setSucio(false);
      setEdicion(false);
      setInputs(INPUTS_VACIOS);
      setFinal(null);
      setContrato(r.contrato);
      empezarMes(r.contrato, r.contrato.mesDefault);
      mostrar("datos");
    } catch (e) {
      errorEnBanner(e);
    } finally {
      setRefrescando(false);
    }
  }

  // ---------------------------------------------------------------- la hoja (solo se dibuja; no cambia nada de lo anterior)
  /** Lo que ya se sabe en el paso 2: mes, periodo y valor. */
  function hojaDelMes(): HojaDatos {
    if (!contrato || !mes) return {};
    const bien = elegido && !esError(elegido) ? elegido : null; // con fechas malas, la hoja deja el periodo en rayas
    return {
      docNum: mesKey.replace("-", ""),
      nombre: tituloNombre(contrato.nombre),
      inicio: bien?.inicio,
      corte: bien?.corte,
      dias: bien ? bien.dias : null,
      valor: bien ? bien.valor : null,
    };
  }

  /** Lo del paso 2 más lo que se leyó de la planilla (pasos 3 y 4). */
  function hojaConPlanilla(): HojaDatos {
    const d = datosDeInputs(inputs);
    return {
      ...hojaDelMes(),
      planilla: d.numero || null,
      mesCotizado: d.periodo || null,
      salud: d.salud,
      pension: d.pension,
      arl: d.arl,
    };
  }

  const pasoActual: 1 | 2 | 3 | 4 =
    pantalla === "login" ? 1 : pantalla === "datos" ? 2 : pantalla === "cargando" ? espera.paso : pantalla === "verificar" ? 3 : 4;

  // ---------------------------------------------------------------- pintar
  return (
    <main className="contenido">
      {pantalla !== "contrato" && pantalla !== "perfil" && pantalla !== "registro" && <Progreso paso={pasoActual} />}

      {aviso && (
        <div className={"aviso " + aviso.tipo} role={aviso.tipo === "error" ? "alert" : "status"}>{aviso.msg}</div>
      )}

      {pantalla === "login" && (
        <PasoLogin
          avisar={avisar}
          limpiarAviso={limpiarAviso}
          onEntrar={entrar}
          onRegistro={() => { setAviso(null); mostrar("registro"); }}
        />
      )}

      {pantalla === "registro" && (
        <PasoRegistro avisar={avisar} limpiarAviso={limpiarAviso} onVolver={() => { setAviso(null); mostrar("login"); }} />
      )}

      {pantalla === "datos" && contrato && mes && (
        <PasoDatos
          contrato={contrato}
          mes={mes}
          eleccion={eleccion}
          elegido={elegido ?? { error: "" }}
          hoja={hojaDelMes()}
          onMes={cambiarMes}
          onEleccion={setEleccion}
          onArchivo={alElegirArchivo}
          onSalir={salir}
          onMiContrato={() => { setAviso(null); mostrar("contrato"); }}
        />
      )}

      {(pantalla === "perfil" || pantalla === "contrato") && contrato && (
        <PasoMiContrato
          key={pantalla}
          inicial={pantalla === "perfil"}
          cargar={cargarMiContrato}
          guardar={guardarMiContrato}
          avisar={avisar}
          limpiarAviso={limpiarAviso}
          onVolver={() => { setAviso(null); mostrar("datos"); }}
          onSalir={salir}
          onGuardado={alGuardarMiContrato}
        />
      )}

      {pantalla === "cargando" && (
        <Cargando
          titulo={espera.titulo}
          texto={espera.texto}
          hoja={espera.paso === 2 ? hojaDelMes() : hojaConPlanilla()}
        />
      )}

      {pantalla === "verificar" && (
        <PasoVerificar
          hoja={hojaConPlanilla()}
          mesKey={mesKey}
          inputs={inputs}
          onInputs={alEditar}
          edicion={edicion}
          sucio={sucio}
          evaluando={evaluando}
          evaluacion={evaluacion}
          leyo={leyo}
          nota={nota}
          adicionales={adicionales}
          subirAdicional={(file) => subirPlanilla(file, true)}
          onAgregarAdicional={agregarAdicional}
          onQuitarAdicional={quitarAdicional}
          onCorregir={corregir}
          onRevisar={revisarDeNuevo}
          onEnviar={enviar}
          onOtra={() => { setAviso(null); mostrar("datos"); }}
        />
      )}

      {pantalla === "final" && final && (
        <PasoFinal resp={final} hoja={hojaConPlanilla()} ocupado={refrescando} onOtroMes={otroMes} onSalir={salir} />
      )}
    </main>
  );
}
