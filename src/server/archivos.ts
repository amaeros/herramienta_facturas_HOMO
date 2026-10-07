// Validación y nombres de los archivos de planilla (PDF, JPG o PNG).

import { randomUUID } from 'node:crypto';

export const MAX_BYTES = 4 * 1024 * 1024;
/** Mínimo de caracteres útiles del texto del navegador para intentar leer la planilla. */
export const MIN_TEXTO_NAVEGADOR = 150;
export const MAX_TEXTO_NAVEGADOR = 200_000;
/** Las planillas subidas y no enviadas caducan a las 6 h. */
export const CADUCIDAD_LECTURA_MS = 6 * 3600 * 1000;

export type TipoArchivo = { mime: string; ext: 'pdf' | 'jpg' | 'png' };

/** Tipo real del archivo según sus primeros bytes (no confiamos en la extensión ni en el MIME que manda el navegador). */
export function tipoArchivo(bytes: Uint8Array): TipoArchivo | null {
  if (!bytes || bytes.length < 8) return null;
  const b = (i: number) => bytes[i] & 0xff;
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return { mime: 'application/pdf', ext: 'pdf' };
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return { mime: 'image/png', ext: 'png' };
  return null;
}

/** Nombre apto para una ruta de Blob: sin tildes, sin caracteres raros, sin extensión, máx. 60 caracteres. */
export function nombreLimpio(nombre: string): string {
  const sinExt = String(nombre ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const s = sinExt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 60);
  return s || 'planilla';
}

/** planillas/<contratoId>/<AAAA-MM>/<uuid>-<nombre limpio>.<ext> */
export function rutaPlanilla(contratoId: number, mes: string, nombre: string, ext: string): string {
  return `planillas/${contratoId}/${mes}/${randomUUID()}-${nombreLimpio(nombre)}.${ext}`;
}
