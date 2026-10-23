// Dibuja la página 1 de un PDF en un PNG (~150 dpi) para revisarlo a ojo o compararlo con la vista del Excel.
// Uso: node scripts/pdf-a-png.mjs <entrada.pdf> <salida.png> [dpi]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createCanvas, DOMMatrix, Path2D, ImageData } from '@napi-rs/canvas';

// pdf.js 3.x busca estas clases en el entorno (en node las trae el paquete `canvas`); aquí las pone @napi-rs/canvas
globalThis.DOMMatrix ??= DOMMatrix;
globalThis.Path2D ??= Path2D;
globalThis.ImageData ??= ImageData;

const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

/** pdf.js 3.x en node pide una fábrica de canvas; se le da la de @napi-rs/canvas. */
const canvasFactory = {
  create(ancho, alto) {
    const canvas = createCanvas(ancho, alto);
    return { canvas, context: canvas.getContext('2d') };
  },
  reset(c, ancho, alto) {
    c.canvas.width = ancho;
    c.canvas.height = alto;
  },
  destroy(c) {
    c.canvas.width = 0;
    c.canvas.height = 0;
  },
};

const [entrada, salida, dpiTexto] = process.argv.slice(2);
if (!entrada || !salida) {
  console.error('Uso: node scripts/pdf-a-png.mjs <entrada.pdf> <salida.png> [dpi]');
  process.exit(1);
}
const dpi = Number(dpiTexto) || 150;

const datos = new Uint8Array(fs.readFileSync(entrada));
const pdf = await pdfjs.getDocument({ data: datos, canvasFactory, disableFontFace: true, useSystemFonts: false }).promise;
const pagina = await pdf.getPage(1);
const vista = pagina.getViewport({ scale: dpi / 72 });
const { canvas, context } = canvasFactory.create(Math.ceil(vista.width), Math.ceil(vista.height));
context.fillStyle = '#ffffff';
context.fillRect(0, 0, canvas.width, canvas.height);
await pagina.render({ canvasContext: context, viewport: vista, canvasFactory }).promise;
fs.writeFileSync(salida, canvas.toBuffer('image/png'));
console.log(`${salida} (${canvas.width}x${canvas.height}, ${pdf.numPages} página(s))`);
