// Copia pdf.js (build "legacy", versión 3.11.174) a public/ para servirlo desde el propio sitio:
//   public/pdf.min.js         -> la librería (src/components/archivos.ts la carga con un <script>)
//   public/pdf.worker.min.js  -> el worker (GlobalWorkerOptions.workerSrc)
// Los dos salen del mismo paquete, así que las versiones siempre coinciden.
// Uso: node scripts/copiar-pdf-worker.mjs   (conviene correrlo en "postinstall" o antes del build)
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const carpetaOrigen = join(raiz, "node_modules", "pdfjs-dist", "legacy", "build");
const carpetaDestino = join(raiz, "public");

mkdirSync(carpetaDestino, { recursive: true });
for (const nombre of ["pdf.min.js", "pdf.worker.min.js"]) {
  const origen = join(carpetaOrigen, nombre);
  if (!existsSync(origen)) {
    console.error("No encuentro " + origen + ". ¿Corriste npm install?");
    process.exit(1);
  }
  copyFileSync(origen, join(carpetaDestino, nombre));
  console.log("Listo: public/" + nombre);
}
