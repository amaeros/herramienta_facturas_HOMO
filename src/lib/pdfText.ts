/**
 * pdfText.ts - Extraccion de texto de un PDF con pdf.js (sin OCR).
 *
 * Port del bloque BEGIN-PDFJS / END-PDFJS de legacy/apps-script/Index.html.
 * Recibe la instancia de pdfjsLib como parametro para que el mismo codigo corra
 * en el navegador (pdfjs-dist 3.11.174) y en node (build legacy) para los tests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PDF_MAX_PAGINAS = 10;
export const PDF_TIMEOUT_MS = 15000;

/** Une los items de texto de una página: espacio entre items; salto de línea con hasEOL o si cambia la coordenada Y. */
export function unirItemsPdf(items: any[]): string {
  let out = '', lastY: number | null = null, eol = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it.str !== 'string') continue;
    if (!it.str.trim()) { if (it.hasEOL) eol = true; continue; }
    const y: number | null = it.transform ? it.transform[5] : null;
    const alto = Math.abs(it.height || (it.transform && it.transform[3]) || 8);
    const cambioY = lastY !== null && y !== null && Math.abs(y - lastY) > Math.max(2, alto * 0.4);
    if (out) out += (eol || cambioY) ? '\n' : ' ';
    out += it.str.trim();
    if (y !== null) lastY = y;
    eol = !!it.hasEOL;
  }
  return out;
}

/** ArrayBuffer del PDF -> texto (hasta 10 páginas, separadas por línea en blanco). Nunca falla: si algo sale mal o pasan 15 s, devuelve ''. */
export function extraerTextoPdf(pdfjsLib: any, arrayBuffer: ArrayBuffer): Promise<string> {
  return new Promise<string>(function (resolve) {
    let terminado = false, doc: any = null, timer: any = null;
    function fin(texto?: unknown) {
      if (terminado) return;
      terminado = true;
      clearTimeout(timer);
      try { if (doc && doc.destroy) doc.destroy(); } catch { /* nada */ }
      resolve(typeof texto === 'string' ? texto : '');
    }
    timer = setTimeout(function () { fin(''); }, PDF_TIMEOUT_MS);
    try {
      if (typeof pdfjsLib === 'undefined' || !pdfjsLib || !pdfjsLib.getDocument) { fin(''); return; }
      const tarea = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)), isEvalSupported: false, disableFontFace: true });
      tarea.promise.then(function (d: any) {
        doc = d;
        const total = Math.min(d.numPages, PDF_MAX_PAGINAS), paginas: string[] = [];
        function pagina(n: number) {
          if (terminado) return;
          if (n > total) { fin(paginas.join('\n\n')); return; }
          d.getPage(n).then(function (pg: any) {
            return pg.getTextContent().then(function (tc: any) {
              paginas.push(unirItemsPdf(tc.items));
              try { pg.cleanup(); } catch { /* nada */ }
              pagina(n + 1);
            });
          }).catch(function () { fin(''); });
        }
        pagina(1);
      }).catch(function () { fin(''); });
    } catch { fin(''); }
  });
}
