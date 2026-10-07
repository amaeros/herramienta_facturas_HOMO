// "Verificar con documento" (supervisor): sube el PDF del contrato, del acta de prórroga o adición, o de la póliza de una
// trabajadora (o de una solicitud pendiente), lo lee en el SERVIDOR con src/lib/documentos.ts y lo compara con los datos
// de la app. Ver docs/ADMIN.md.
//
// - El navegador manda el PDF y el texto que sacó pdf.js; el servidor vuelve a leer ese texto (no se confía en nada leído
//   por el cliente) y guarda el PDF en Blob privado. La ruta del blob nunca sale al navegador.
// - Las respuestas pueden traer valores completos (cédula, teléfono...), porque solo las ve el supervisor. NUNCA se
//   escriben en logs ni en la bitácora (los datos personales se anotan como "(dato personal)").

import { count, desc, eq } from 'drizzle-orm';
import { leerDocumento, type CamposDocumento, type DocumentoLeido, type TipoDocumentoLeido } from '../lib/documentos';
import { actualizarContrato, contarCargas, contratoCualquiera, type ContratoAdmin } from './admin';
import { MAX_BYTES, MAX_TEXTO_NAVEGADOR, rutaDocumento, tipoArchivo } from './archivos';
import { registrarCambios } from './cambios';
import { contratos, documentos, type ContratoFila, type DocumentoFila } from './db/schema';
import { normTxt } from './entrada';
import { ErrorAmable } from './errores';
import type { Deps } from './servicios';

export const MAX_DOCUMENTOS_POR_CONTRATO = 20;
export const NOTA_SIN_TEXTO = 'No se pudo leer el texto (¿PDF escaneado?). Compáralo a ojo.';
const MSG_NO_DOCUMENTO = 'No encontramos ese documento. Puede que ya lo hayas quitado.';
const MSG_GRANDE = 'El archivo pesa más de 4 MB. Sube un PDF más liviano.';

// =================================================================== documentos subidos
/** Un documento como lo ve el supervisor: sin la ruta del blob. */
export type DocumentoAdmin = {
  id: number;
  contratoId: number;
  tipo: TipoDocumentoLeido;
  nombreArchivo: string;
  campos: CamposDocumento;
  notas: string[];
  subido: Date;
};

const COLUMNAS = {
  id: documentos.id,
  contratoId: documentos.contratoId,
  tipo: documentos.tipo,
  nombreArchivo: documentos.nombreArchivo,
  campos: documentos.campos,
  notas: documentos.notas,
  subido: documentos.subido,
};

function aDocumentoAdmin(f: Omit<DocumentoFila, 'archivo'>): DocumentoAdmin {
  return {
    id: f.id,
    contratoId: f.contratoId,
    tipo: f.tipo as TipoDocumentoLeido,
    nombreArchivo: f.nombreArchivo,
    campos: f.campos ?? {},
    notas: f.notas ?? [],
    subido: f.subido,
  };
}

function nombreDeArchivo(nombre: unknown): string {
  const s = String(nombre ?? '')
    .replace(/[\\/\u0000-\u001f]+/g, '_')
    .trim()
    .slice(0, 120);
  return s || 'documento.pdf';
}

export type PedidoDocumento = {
  contratoId: number;
  archivo: { bytes: Uint8Array; nombre: string };
  /** Texto que sacó pdf.js en el navegador (puede venir vacío si el PDF es una imagen escaneada). */
  texto?: string;
};

/** Lo que se lee del PDF. Sin texto no se intenta nada: queda como 'desconocido' con la nota de "compáralo a ojo". */
export function leerTextoDelDocumento(texto: unknown): DocumentoLeido {
  const t = typeof texto === 'string' ? texto.slice(0, MAX_TEXTO_NAVEGADOR) : '';
  if (!t.trim()) return { tipo: 'desconocido', campos: {}, notas: [NOTA_SIN_TEXTO] };
  return leerDocumento(t);
}

/**
 * Guarda el PDF (Blob privado, `documentos/<contratoId>/<uuid>-<nombre>.pdf`) y la fila con lo que el SERVIDOR leyó del
 * texto. Sirve para trabajadoras y para solicitudes pendientes. Máx. 4 MB, solo PDF (se revisan los primeros bytes).
 */
export async function subirDocumento(deps: Deps, pedido: PedidoDocumento): Promise<DocumentoAdmin> {
  await contratoCualquiera(deps.db, pedido.contratoId);
  const bytes = pedido.archivo.bytes;
  if (bytes.length > MAX_BYTES) throw new ErrorAmable(MSG_GRANDE, 413);
  if (tipoArchivo(bytes)?.ext !== 'pdf') throw new ErrorAmable('Solo se pueden subir archivos PDF.', 415);
  const [r] = await deps.db.select({ n: count() }).from(documentos).where(eq(documentos.contratoId, pedido.contratoId));
  if (Number(r?.n ?? 0) >= MAX_DOCUMENTOS_POR_CONTRATO) {
    throw new ErrorAmable(`Ya hay ${MAX_DOCUMENTOS_POR_CONTRATO} documentos subidos. Quita alguno antes de subir otro.`);
  }

  const leido = leerTextoDelDocumento(pedido.texto);
  const nombreArchivo = nombreDeArchivo(pedido.archivo.nombre);
  const ruta = rutaDocumento(pedido.contratoId, nombreArchivo);
  try {
    await deps.blob.put(ruta, Buffer.from(bytes), 'application/pdf');
  } catch {
    throw new ErrorAmable('No pudimos guardar el PDF. Inténtalo de nuevo en un momento.', 502);
  }
  try {
    const [fila] = await deps.db
      .insert(documentos)
      .values({
        contratoId: pedido.contratoId,
        tipo: leido.tipo,
        nombreArchivo,
        archivo: ruta,
        campos: leido.campos,
        notas: leido.notas,
        subido: deps.ahora ? deps.ahora() : new Date(),
      })
      .returning(COLUMNAS);
    return aDocumentoAdmin(fila);
  } catch (e) {
    await deps.blob.del([ruta]).catch(() => undefined); // que no quede un PDF huérfano
    throw e;
  }
}

/** Los documentos de un contrato, del más nuevo al más viejo. Sin la ruta del blob. */
export async function listarDocumentos(deps: Deps, contratoId: number): Promise<DocumentoAdmin[]> {
  await contratoCualquiera(deps.db, contratoId);
  const filas = await deps.db
    .select(COLUMNAS)
    .from(documentos)
    .where(eq(documentos.contratoId, contratoId))
    .orderBy(desc(documentos.subido), desc(documentos.id));
  return filas.map(aDocumentoAdmin);
}

async function filaDocumento(deps: Deps, id: number): Promise<DocumentoFila> {
  const [f] = await deps.db.select().from(documentos).where(eq(documentos.id, id)).limit(1);
  if (!f) throw new ErrorAmable(MSG_NO_DOCUMENTO, 404);
  return f;
}

export type DocumentoParaVer = { stream: ReadableStream<Uint8Array>; mime: string; size: number | null; nombreArchivo: string };

/** El PDF desde Blob privado, para mostrarlo `inline` en el panel. */
export async function documentoParaVer(deps: Deps, id: number): Promise<DocumentoParaVer> {
  const f = await filaDocumento(deps, id);
  const b = await deps.blob.get(f.archivo);
  if (!b) throw new ErrorAmable('No encontramos el archivo (pudo haberse borrado).', 404);
  return { stream: b.stream, mime: 'application/pdf', size: b.size, nombreArchivo: f.nombreArchivo };
}

/** Borra el PDF de Blob y la fila. El archivo va primero: si Blob falla, no se pierde nada y se puede reintentar. */
export async function borrarDocumento(deps: Deps, id: number): Promise<void> {
  const f = await filaDocumento(deps, id);
  try {
    await deps.blob.del([f.archivo]);
  } catch {
    throw new ErrorAmable('No pudimos borrar el PDF. No se quitó nada; inténtalo de nuevo en un momento.', 502);
  }
  await deps.db.delete(documentos).where(eq(documentos.id, id));
}

// =================================================================== comparación con los datos de la app
export const CAMPOS_VERIFICACION = [
  'numeroContrato',
  'nombre',
  'cedula',
  'objeto',
  'honorario',
  'valorTotal',
  'inicio',
  'fin',
  'direccion',
  'ciudad',
  'telefono',
] as const;
export type CampoVerificacion = (typeof CAMPOS_VERIFICACION)[number];

export const ETIQUETAS_VERIFICACION: Record<CampoVerificacion, string> = {
  numeroContrato: 'N.º de contrato',
  nombre: 'Nombre',
  cedula: 'Cédula',
  objeto: 'Objeto del contrato',
  honorario: 'Honorario mensual',
  valorTotal: 'Valor total del contrato',
  inicio: 'Fecha de inicio',
  fin: 'Fecha de fin',
  direccion: 'Dirección',
  ciudad: 'Ciudad',
  telefono: 'Teléfono',
};

/**
 * De qué tipo de documento sale cada dato, en orden de prioridad (dentro de cada tipo, el más reciente que lo traiga).
 * null = cualquier tipo: el documento más reciente que lo traiga.
 *   - fin y valor total: el acta de prórroga o adición (lo más nuevo), si no, el contrato.
 *   - inicio: el acta, si no, la póliza (vigencia desde). El contrato no trae el inicio.
 *   - honorario: el contrato, si no, el acta (el acta lo deduce de la adición y los meses de prórroga).
 */
const FUENTES: Record<CampoVerificacion, readonly TipoDocumentoLeido[] | null> = {
  numeroContrato: null,
  nombre: null,
  cedula: null,
  objeto: null,
  honorario: ['contrato', 'acta_prorroga'],
  valorTotal: ['acta_prorroga', 'contrato'],
  inicio: ['acta_prorroga', 'poliza'],
  fin: ['acta_prorroga', 'contrato'],
  direccion: null,
  ciudad: null,
  telefono: null,
};

export type EstadoVerificacion = 'coincide' | 'distinto' | 'sin_dato';
export type ValorVerificacion = string | number | null;

export type FilaVerificacion = {
  campo: CampoVerificacion;
  etiqueta: string;
  /** Lo que tiene la app (null si está vacío). */
  actual: ValorVerificacion;
  /** Lo que dice el documento elegido (null si ningún documento trae ese dato). */
  documento: ValorVerificacion;
  /** Qué documento se usó (tipo y fecha en que se subió). null si ninguno trae el dato. */
  fuente: { documentoId: number; tipo: TipoDocumentoLeido; fecha: Date } | null;
  estado: EstadoVerificacion;
};

export type Verificacion = {
  contratoId: number;
  /** Cuándo se marcó como verificada (null si no, o si la contratista cambió algo después). */
  verificadaEn: Date | null;
  /** Cuántos documentos hay subidos. */
  documentos: number;
  filas: FilaVerificacion[];
};

/**
 * Lo que se compara de cada dato (dos valores "coinciden" si sus claves son iguales):
 *   - nombre, dirección y ciudad: sin tildes, sin mayúsculas y con espacios simples;
 *   - objeto: igual, pero sin espacios ni signos (el PDF parte palabras: "DERE CHO"; trae comillas “ ”);
 *   - cédula y teléfono: solo los dígitos;
 *   - n.º de contrato: sin espacios y sin mayúsculas;
 *   - dinero y fechas: exactos.
 */
export function claveComparacion(campo: CampoVerificacion, v: unknown): string {
  if (v === null || v === undefined) return '';
  switch (campo) {
    case 'nombre':
    case 'direccion':
    case 'ciudad':
      return normTxt(v);
    case 'objeto':
      return normTxt(v).replace(/[^a-z0-9]/g, '');
    case 'cedula':
    case 'telefono':
      return String(v).replace(/\D/g, '');
    case 'numeroContrato':
      return String(v).replace(/\s+/g, '').toLowerCase();
    default:
      return String(v).trim();
  }
}

export function sonIguales(campo: CampoVerificacion, a: unknown, b: unknown): boolean {
  const x = claveComparacion(campo, a);
  return x !== '' && x === claveComparacion(campo, b);
}

function valorDelDocumento(campos: CamposDocumento | null | undefined, campo: CampoVerificacion): ValorVerificacion {
  const v = (campos as Record<string, unknown> | null | undefined)?.[campo];
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') return v.trim() ? v.trim() : null;
  return null;
}

function valorDeLaApp(c: ContratoFila, campo: CampoVerificacion): ValorVerificacion {
  const v = c[campo];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() ? v.trim() : null;
  return null;
}

type DocParaComparar = { id: number; tipo: string; campos: CamposDocumento; subido: Date };

/** Elige el documento que manda para ese dato (`docs` ya viene del más nuevo al más viejo). */
function elegirFuente(docs: DocParaComparar[], campo: CampoVerificacion): { doc: DocParaComparar; valor: string | number } | null {
  const tiene = (d: DocParaComparar) => valorDelDocumento(d.campos, campo);
  const orden = FUENTES[campo];
  const candidatos = orden ? orden.flatMap((t) => docs.filter((d) => d.tipo === t)) : docs;
  for (const d of candidatos) {
    const valor = tiene(d);
    if (valor !== null) return { doc: d, valor };
  }
  return null;
}

/**
 * Compara los datos de la trabajadora (o solicitud) con lo que dicen los documentos subidos. Un renglón por dato:
 * 'coincide', 'distinto' (el documento trae el dato y es otro, o la app lo tiene vacío) o 'sin_dato' (ningún documento
 * lo trae). Las respuestas llevan valores completos: no se escriben en logs.
 */
export async function verificar(deps: Deps, contratoId: number): Promise<Verificacion> {
  const c = await contratoCualquiera(deps.db, contratoId);
  const docs = await deps.db
    .select({ id: documentos.id, tipo: documentos.tipo, campos: documentos.campos, subido: documentos.subido })
    .from(documentos)
    .where(eq(documentos.contratoId, contratoId))
    .orderBy(desc(documentos.subido), desc(documentos.id));
  const filas = CAMPOS_VERIFICACION.map((campo): FilaVerificacion => {
    const actual = valorDeLaApp(c, campo);
    const f = elegirFuente(docs, campo);
    if (!f) return { campo, etiqueta: ETIQUETAS_VERIFICACION[campo], actual, documento: null, fuente: null, estado: 'sin_dato' };
    return {
      campo,
      etiqueta: ETIQUETAS_VERIFICACION[campo],
      actual,
      documento: f.valor,
      fuente: { documentoId: f.doc.id, tipo: f.doc.tipo as TipoDocumentoLeido, fecha: f.doc.subido },
      estado: sonIguales(campo, actual, f.valor) ? 'coincide' : 'distinto',
    };
  });
  return { contratoId, verificadaEn: c.verificadaEn, documentos: docs.length, filas };
}

// =================================================================== usar el dato del documento / marcar verificada
/** Los datos personales (y el nombre) que no estaban en la bitácora del supervisor y ahora sí, como "(dato personal)". */
const AUDITAR_ADEMAS: ReadonlySet<string> = new Set(['nombre', 'cedula', 'direccion', 'telefono', 'ciudad']);

/**
 * Copia al contrato el valor que dice el documento (el servidor lo vuelve a sacar: no se confía en el cliente). Usa la
 * misma edición del panel: validaciones, bitácora (autor 'admin') y recálculo de acumulados. No borra la verificación.
 */
export async function usarDelDocumento(deps: Deps, contratoId: number, campo: unknown): Promise<ContratoAdmin> {
  if (typeof campo !== 'string' || !(CAMPOS_VERIFICACION as readonly string[]).includes(campo)) {
    throw new ErrorAmable('Ese dato no se puede copiar desde un documento.');
  }
  const v = await verificar(deps, contratoId);
  const fila = v.filas.find((x) => x.campo === campo);
  if (!fila || fila.documento === null) throw new ErrorAmable('Ningún documento subido trae ese dato.');
  return actualizarContrato(deps, contratoId, { [campo]: fila.documento }, {
    incluirPendientes: true,
    auditar: AUDITAR_ADEMAS.has(campo) ? [campo] : [],
  });
}

/**
 * "Marcar como verificada": guarda la fecha (`verificada_en`) y la anota en la bitácora. Hace falta al menos un documento
 * subido. Si la contratista cambia después un dato de su contrato, la marca se borra sola.
 */
export async function marcarVerificada(deps: Deps, contratoId: number): Promise<ContratoAdmin> {
  await contratoCualquiera(deps.db, contratoId);
  const [r] = await deps.db.select({ n: count() }).from(documentos).where(eq(documentos.contratoId, contratoId));
  if (Number(r?.n ?? 0) === 0) {
    throw new ErrorAmable('Sube al menos un documento (contrato, acta o póliza) antes de marcarla como verificada.');
  }
  const [c] = await deps.db
    .update(contratos)
    .set({ verificadaEn: deps.ahora ? deps.ahora() : new Date() })
    .where(eq(contratos.id, contratoId))
    .returning();
  await registrarCambios(deps, contratoId, 'admin', [{ campo: 'verificada', antes: '', despues: 'Verificada' }]);
  return { ...c, cargas: await contarCargas(deps.db, contratoId) };
}
