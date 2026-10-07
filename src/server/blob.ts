// Envoltura delgada sobre @vercel/blob. Todo es privado: nunca se devuelve la URL del blob a la contratista.
// Inyectable para pruebas (setBlobStore con un fake en memoria).

import { del, put } from '@vercel/blob';

export interface BlobStore {
  /** Guarda el archivo en `pathname` (privado). */
  put(pathname: string, body: Buffer, contentType: string): Promise<void>;
  /** Borra archivos por ruta. No falla si alguno no existe. */
  del(pathnames: string[]): Promise<void>;
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
};

let inyectado: BlobStore | null = null;

/** Para pruebas: usa este almacén en vez de Vercel Blob. Pasa null para volver al normal. */
export function setBlobStore(b: BlobStore | null): void {
  inyectado = b;
}

export function getBlobStore(): BlobStore {
  return inyectado ?? blobVercel;
}
