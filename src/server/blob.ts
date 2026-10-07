// Envoltura delgada sobre @vercel/blob. Todo es privado: nunca se devuelve la URL del blob a la contratista.
// Inyectable para pruebas (setBlobStore con un fake en memoria).

import { del, get, put } from '@vercel/blob';

/** Archivo leído de Blob: flujo + tipo + tamaño (si se conoce). */
export type ArchivoBlob = { stream: ReadableStream<Uint8Array>; contentType: string; size: number | null };

export interface BlobStore {
  /** Guarda el archivo en `pathname` (privado). */
  put(pathname: string, body: Buffer, contentType: string): Promise<void>;
  /** Borra archivos por ruta. No falla si alguno no existe. */
  del(pathnames: string[]): Promise<void>;
  /** Lee un archivo privado por ruta (solo para el panel de admin). null si no existe. */
  get(pathname: string): Promise<ArchivoBlob | null>;
}

export const blobVercel: BlobStore = {
  async put(pathname, body, contentType) {
    await put(pathname, body, {
      access: 'private',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  },
  async del(pathnames) {
    if (pathnames.length) await del(pathnames);
  },
  async get(pathname) {
    const r = await get(pathname, { access: 'private' });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return { stream: r.stream, contentType: r.blob.contentType, size: r.blob.size };
  },
};

let inyectado: BlobStore | null = null;

/** Para pruebas: usa este almacén en vez de Vercel Blob. Pasa null para volver al normal. */
export function setBlobStore(b: BlobStore | null): void {
  inyectado = b;
}

export function getBlobStore(): BlobStore {
  return inyectado ?? blobVercel;
}
