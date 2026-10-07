/** Preparación de archivos en el navegador: validación, compresión de fotos y texto del PDF (pdf.js, sin OCR). */

import { extraerTextoPdf } from "../lib/pdfText";

/** Límite por archivo que acepta el servidor (el cuerpo de una función de Vercel admite ~4,5 MB). */
export const MAX_BYTES = 4 * 1024 * 1024;
/** Una foto del celular puede pesar más que eso: se reduce antes de enviarla. Este es el tope para intentar abrirla. */
const MAX_FOTO_ORIGINAL = 20 * 1024 * 1024;
/** Objetivo al comprimir, con margen para el resto del formulario. */
const OBJETIVO_FOTO = 3.5 * 1024 * 1024;

export const MSG_PESO = "El archivo pesa más de 4 MB. Sube un PDF más liviano o una foto.";
export const MSG_TIPO = "Solo puedes subir un PDF o una foto (JPG o PNG).";
export const MSG_NO_ABRE = "No pudimos abrir el archivo. Intenta con otro.";
export const MSG_FOTO = "imagen";

export function esPdf(file: { type: string; name: string }): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function esImagen(file: { type: string; name: string }): boolean {
  return /^image\//.test(file.type) || /\.(jpe?g|png|heic|heif)$/i.test(file.name);
}

/** Revisa tipo y peso del archivo; devuelve un mensaje si no sirve ('' si está bien). */
export function problemaArchivo(file: { type: string; name: string; size: number }): string {
  const pdf = esPdf(file);
  if (!pdf && !esImagen(file)) return MSG_TIPO;
  if (file.size > (pdf ? MAX_BYTES : MAX_FOTO_ORIGINAL)) return MSG_PESO;
  return "";
}

// ------------------------------------------------------------ pdf.js (solo en el navegador)

// pdf.js 3.11.174 (build "legacy", para celulares viejos) se sirve desde /public (lo copia scripts/copiar-pdf-worker.mjs)
// y se carga con una etiqueta <script> la primera vez que se necesita. No pasa por el empaquetador: el build de
// pdf.js hace require("canvas") para node y Turbopack no lo resuelve.
const PDFJS_VERSION = "3.11.174";
const PDFJS_URL = "/pdf.min.js?v=" + PDFJS_VERSION;
const PDFJS_WORKER_URL = "/pdf.worker.min.js?v=" + PDFJS_VERSION;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type PdfjsLib = any;
let carga: Promise<PdfjsLib | null> | null = null;

function inyectarScript(src: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    const t = setTimeout(() => resolve(false), ms);
    s.async = true;
    s.src = src;
    s.onload = () => { clearTimeout(t); resolve(true); };
    s.onerror = () => { clearTimeout(t); resolve(false); };
    document.head.appendChild(s);
  });
}

/**
 * Carga pdf.js la primera vez que se necesita. Solo corre en el navegador: se llama desde eventos o efectos,
 * nunca al renderizar en el servidor. Devuelve null si no pudo (entonces se sigue sin texto).
 */
export function cargarPdfjs(): Promise<PdfjsLib | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!carga) {
    carga = (async () => {
      const w = window as unknown as { pdfjsLib?: PdfjsLib };
      if (!w.pdfjsLib || !w.pdfjsLib.getDocument) {
        if (!(await inyectarScript(PDFJS_URL, 10_000))) return null;
      }
      const lib = w.pdfjsLib;
      if (!lib || !lib.getDocument) return null;
      try { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL; } catch { /* nada */ }
      return lib;
    })().then((lib) => {
      if (!lib) carga = null; // si falló, la próxima vez se reintenta
      return lib;
    });
  }
  return carga;
}

function leerBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(new Error("lectura"));
    fr.readAsArrayBuffer(file);
  });
}

/** Texto real del PDF; '' si pdf.js no cargó, el PDF es una imagen escaneada o algo falla (el servidor devuelve fuente 'ninguna'). */
export async function textoDelPdf(file: Blob): Promise<string> {
  try {
    const lib = await cargarPdfjs();
    if (!lib) return "";
    return await extraerTextoPdf(lib, await leerBuffer(file));
  } catch {
    return "";
  }
}

// ------------------------------------------------------------ fotos

/** Las fotos del celular pesan mucho: se reducen antes de enviarlas (se ven igual de claras para leer). */
export function comprimirImagen(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { reject(new Error(MSG_FOTO)); return; }
      let lado = Math.min(1, 2000 / Math.max(w, h));
      const nombre = (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg";
      const intentar = () => {
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * lado));
        cv.height = Math.max(1, Math.round(h * lado));
        const g = cv.getContext("2d");
        if (!g) { reject(new Error(MSG_FOTO)); return; }
        g.fillStyle = "#fff";
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        let q = 0.85;
        const probar = () => {
          cv.toBlob((blob) => {
            if (!blob) { reject(new Error(MSG_FOTO)); return; }
            if (blob.size > OBJETIVO_FOTO && q > 0.45) { q -= 0.1; probar(); return; }
            if (blob.size > OBJETIVO_FOTO && lado > 0.3) { lado *= 0.75; intentar(); return; }
            resolve(new File([blob], nombre, { type: "image/jpeg" }));
          }, "image/jpeg", q);
        };
        probar();
      };
      intentar();
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(MSG_FOTO)); };
    img.src = url;
  });
}

export interface ArchivoListo {
  archivo: File;
  texto: string;
}

/** PDF: el mismo archivo + el texto real (pdf.js). Foto: la foto reducida, sin texto. */
export async function prepararArchivo(file: File): Promise<ArchivoListo> {
  if (esPdf(file)) {
    return { archivo: file, texto: await textoDelPdf(file) };
  }
  const reducida = await comprimirImagen(file);
  if (reducida.size > MAX_BYTES) throw new Error(MSG_PESO);
  return { archivo: reducida, texto: "" };
}
