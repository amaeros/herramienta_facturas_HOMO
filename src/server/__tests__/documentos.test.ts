// "Verificar con documento" (supervisor): subir PDF, lectura en el servidor, comparación con prioridades, usar el dato del
// documento, marcar verificada. TODO es inventado: personas, cédulas, teléfonos y direcciones de mentira, con el mismo
// formato (y los mismos espacios raros) que deja pdf.js en los PDF reales.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { leerDocumento } from '../../lib/documentos';
import { actualizarContrato, borrarContrato } from '../admin';
import { crearTokenAdmin } from '../adminAuth';
import { MAX_BYTES } from '../archivos';
import type { Db } from '../db';
import { cambiosContrato, cargas, contratos, documentos } from '../db/schema';
import {
  CAMPOS_VERIFICACION,
  MAX_DOCUMENTOS_POR_CONTRATO,
  NOTA_SIN_TEXTO,
  borrarDocumento,
  claveComparacion,
  documentoParaVer,
  listarDocumentos,
  marcarVerificada,
  sonIguales,
  subirDocumento,
  usarDelDocumento,
  verificar,
  type CampoVerificacion,
  type Verificacion,
} from '../documentos';
import { ErrorAmable, ErrorValidacion } from '../errores';
import { exigirAdmin } from '../http';
import { guardarMiContrato } from '../miContrato';
import type { Deps } from '../servicios';
import { aprobarSolicitud, rechazarSolicitud } from '../solicitudes';
import { AHORA, BlobFalso, bytesPdf, crearBase, crearCarga, crearContratista, crearDeps, vaciar } from './helpers';

// ---------------------------------------------------------------------------
// Textos sintéticos
// ---------------------------------------------------------------------------
const OBJETO_INTERADMIN =
  'FORTALECER ACCIONES DE LA POLÍTICA PÚBLICA DE LAS MUJERES DESDE UN ENFOQUE SICOSOCIAL PARA LA GARANTÍA DE SUS DERECHOS HUMANOS.';

const ENCABEZADO_CONTRATO = [
  'CONTRATO N°  2026 CPS 99 9',
  'OBJETO:',
  'Prestación de servicios como Apoyo técnico/administrativo , en el marco de la',
  'ejecución del contrato interadministrativo N°4600018487 de 2025 , suscrito con la',
  'Secretaría de las Mujeres del Departamento de Antioquia, cuyo objeto es:',
  '“ FORTALECER ACCIONES DE LA POLÍTICA PÚBLICA DE LAS MUJERES DESDE',
  'UN ENFOQUE SICOSOCIAL PARA LA GARANTÍA DE SUS DERE CHOS',
  'HUMANOS. ”',
  'Código: GJ - CO - FR - 2 3 Versión: 0 5 Fecha: 8 / 10 /202 5',
];

const CONTRATO = [
  ...ENCABEZADO_CONTRATO,
  '1',
  'NUMERO:  2026CPS 9 9 9',
  'CONTRATANTE: EMPRESA SOCIAL DEL ESTADO HOSPITAL MENTAL DE ANTIOQUIA MARIA UPEGUI - HOMO',
  'CONTRATISTA :  PRUEBA PÉREZ DE LA TORRE',
  'PLAZO :  Nueve (09) meses, contados a partir de la firma del acta de inicio',
  'TERMINACION :  Sin exceder el 30 de  Septiembre de 202 6 .',
  'VALOR:  $ 36.081.000',
  'Entre los suscritos a saber, GERENTE DE PRUEBA , identificado con la cédula de ciudadanía número',
  '32.000.111 , en su calidad de Gerente (E), nombrada mediante Decreto Departamental,',
  'HOSPITAL MENTAL DE ANTIOQUIA - HOMO, entidad pública con número de identificación tributaria 890.905.166 - 8, de',
  'una parte quien para efectos del presente contrato se denominará LA ENTIDAD CONTRATANTE, y PRUEBA PÉREZ DE LA',
  'TORRE con número de identificación  1.000.001.234 , persona natural, mayor de edad, qui en obra en su propio nombre y',
  'quien se denominará EL CONTRATISTA. 7. El HOMO, celebró el contrato interadministrativo N°',
  '4600018487 de 2025 con la Secretaría de las Mujeres, con una duración de once (11) meses y quince (15) días, sin',
  'exceder el 30 de septiembre de 2026 y por $ 2.646.635.715. 8. La Gobernación de Antioquia, reconoce la importancia',
  'Previsualización',
  '',
  ...ENCABEZADO_CONTRATO,
  '2',
  'y apoyo a la gestión, se fortalecen las intervenciones. Este contrato se regirá por las CLÁUSULAS que a continuación se',
  'expresan: PRIMERA. OBJETO . Prestación de servicios como Apoyo técnico/administrativo , en el marco de la ejecución',
  'del contrato interadministrativo N°4600018487 de 2025 , cuyo objeto es: “ ' + OBJETO_INTERADMIN + ' ” Parágrafo 1. Las actividades',
  'objeto del presente estudio previo deberán ser desempeñadas en la sede principal. SEGUNDO. VALOR DEL',
  'CONTRATO. La suma TREINTA Y SEIS MILLONES OCHENTA Y UN MIL PESOS ML. ($ 36.081.000 ). TERCERA.',
  'FORMA DE PAGO : La E.S.E. HOMO, entidad pública contrata nte, en contraprestación por los servicios que reciba durante',
  'la vigencia del presente contrato pagará por los servicios recibidos durante los meses de enero a septiembre de 2026 la',
  'suma de CUATRO MILLONES NUEVE MIL PESOS M/L ($ 4.009.000) , respectivamente, los honorarios equivalen a los',
  'días trabajados. Parágrafo 1 : Se reconocerán los debidos honorarios en un término de cinco (5) días hábiles.',
  'Previsualización',
].join('\n');

const ACTA = [
  'ACTA DE PRORROGA O ADICIÓN PARA EL',
  'CONTRATO',
  'Código: GJ-CO-FR-12 Versión: 03 Fecha: 22/01/2025',
  '1',
  'ADICIÓN Y PRORROGA No. 1',
  'INFORMACION DEL CONTRATISTA:',
  'Nombre o Razón Social  PRUEBA PÉREZ DE LA TORRE',
  'Representante legal L N/A',
  'Nit o cédula representante legal y/o persona',
  'natural',
  '1.000.001.234',
  'INFORMACION DEL CONTRATO:',
  'Número:  2026CPS999',
  'Objeto:  Prestación de servicios como Apoyo técnico/administrativo,',
  'en el marco de la ejecución del contrato interadministrativo',
  'N° 4600018487 de 2025, suscrito con la Secretaría de las',
  'Mujeres del Departamento de Antioquia, cuyo objeto es:',
  '“FORTALECER ACCIONES DE LA POLÍTICA PÚBLICA',
  'DE LAS MUJERES DESDE UN ENFOQUE SICOSOCIAL.”',
  'Fecha de Suscripción:  01 de enero de 2026',
  'Fecha Inicio del contrato  01 de enero de 2026',
  'Duración inicial: NUEVE (09) MESES , contados a partir de la fecha de',
  'inicio.',
  'Terminación inicial:  Sin exceder el 30 de  septiembre de 2026.',
  'Valor inicial del contrato  $36.081.000',
  'ADICIÓN N°1',
  'Adición N°1  $8.018.000',
  'Valor del contrato inicial más adición  $44.099.000',
  'PRÓRROGA N°1',
  'Prorroga N°1  DOS (02) MESES',
  'Plazo del contrato más prórrogas  ONCE (11) MESES .',
  'CONCEPTO DEL SUPERVISOR:',
  'LAS PARTES CONCEPTUAN FAVORABLE SOBRE EL OTORGAMIENTO DE UNA ADICION N°1 POR',
  'VALOR DE: OCHO MILLONES DIECIOCHO MIL PESOS MCTE M/L ( $8.018.000 ) POR LO QUE EL VALOR',
  'TOTAL DEL CONTRATO QUEDA ESTIPULADO EN LA SUMA DE CUARENTA Y CUATRO MILLONES',
  'NOVENTA Y NUEVE MIL PESOS MCTE ( $44.099.000 ) Y UNA PRORROGA DE DOS (02) MESES, PARA',
  'UN PLAZO TOTAL DE ONCE (11) MESES , FINALIZANDO EL 30 DE NOVIEMBRE DE 2026.',
  'Previsualización',
].join('\n');

const POLIZA = [
  'OBJETO DEL SEGURO',
  'FIRMA TOMADOR',
  'DATOS DEL TOMADOR / GARANTIZADO',
  'DATOS DEL ASEGURADO / BENEFICIARIO',
  'CIUDAD DE EXPEDICIÓN SUCURSAL COD.SUC NO.PÓLIZA ANEXO',
  'TIPO MOVIMIENTO',
  'VIGENCIA HASTA',
  'DÍA MES AÑO',
  'VIGENCIA DESDE',
  'DÍA MES AÑO',
  'FECHA EXPEDICIÓN',
  'DÍA MES AÑO',
  'NOMBRE O RAZON',
  'SOCIAL',
  'DIRECCIÓN: CIUDAD:',
  'IDENTIFICACIÓN',
  'TELÉFONO:',
  'OFICINA PRINCIPAL: AUTOPISTA NORTE # 103 - 60, PISO 5 TELEFONO: 601-2186977, 601-6019330',
  'USTED PUEDE CONSULTAR ESTA PÓLIZA EN WWW.SEGUROSDELESTADO.COM',
  'POLIZA DE SEGURO DE CUMPLIMIENTO ENTIDAD ESTATAL',
  'DECRETO 1082 DE 2015',
  'AGENCIA RIONEGRO 48 RIONEGRO',
  '01  10  2026  01  01  2026  00:00  30  03  2027  23:59  ANEXO DE PRORROGA',
  'PÉREZ DE LA TORRE, PRUEBA  CC: 1000.001.234',
  'CL 36 AA SUR 26 A 30  ENVIGADO, ANTIOQUIA  3001234567',
  'EMPRESA SOCIAL DEL ESTADO HOSPITAL MENTAL DE ANTIOQUIA',
  'CALLE 38 55 - 310 BELLO, ANTIOQUIA',
  'NIT: 890.905.166-8',
  '4548200',
  'Previsualización',
].join('\n');

/** Un acta con otro inicio (15 de enero) y otra adición (8.000.000 entre 2 meses = 4.000.000 al mes). */
const ACTA_OTRA = ACTA.replace('Fecha Inicio del contrato  01 de enero de 2026', 'Fecha Inicio del contrato  15 de enero de 2026')
  .replace('Adición N°1  $8.018.000', 'Adición N°1  $8.000.000');

// ---------------------------------------------------------------------------
let db: Db;
let blob: BlobFalso;
let deps: Deps;
let minuto: number;

beforeAll(async () => {
  db = await crearBase();
});

beforeEach(async () => {
  await vaciar(db);
  blob = new BlobFalso();
  deps = crearDeps(db, blob);
  minuto = 0;
});

/** Deps con un reloj que avanza un minuto por llamada: así "el más reciente" es predecible. */
function conReloj(): Deps {
  return { db, blob, ahora: () => new Date(AHORA.getTime() + minuto++ * 60_000) };
}

/** Una trabajadora cuyos datos coinciden con los de los documentos de arriba. */
async function crearIgualAlDocumento(over: Partial<typeof contratos.$inferInsert> = {}): Promise<number> {
  const objeto = leerDocumento(CONTRATO).campos.objeto!;
  return crearContratista(db, {
    nombre: 'Prueba Pérez de la Torre',
    cedula: '1000001234',
    telefono: '3001234567',
    direccion: 'CL 36 AA SUR 26 A 30',
    ciudad: 'Envigado',
    numeroContrato: '2026CPS999',
    objeto,
    honorario: 4009000,
    valorTotal: 36081000,
    inicio: '2026-01-01',
    fin: '2026-09-30',
    ...over,
  });
}

async function subir(d: Deps, contratoId: number, texto: string, nombre = 'documento.pdf') {
  return subirDocumento(d, { contratoId, archivo: { bytes: bytesPdf(nombre), nombre }, texto });
}

function fila(v: Verificacion, campo: CampoVerificacion) {
  const f = v.filas.find((x) => x.campo === campo);
  if (!f) throw new Error('falta ' + campo);
  return f;
}

async function fallo<E extends Error>(p: Promise<unknown>, clase: new (...a: never[]) => E): Promise<E> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(clase);
    return e as E;
  }
  throw new Error('debía fallar');
}

// =================================================================== subir
describe('subir documento', () => {
  it('guarda la fila y el PDF en Blob privado, y lo lee el SERVIDOR (tipo y campos salen del texto)', async () => {
    const id = await crearIgualAlDocumento();
    const d = await subir(deps, id, CONTRATO, 'Mi contrato.pdf');
    expect(d).toMatchObject({ contratoId: id, tipo: 'contrato', nombreArchivo: 'Mi contrato.pdf' });
    expect(d.campos).toMatchObject({ numeroContrato: '2026CPS999', honorario: 4009000, valorTotal: 36081000, fin: '2026-09-30' });
    expect(d.notas.join(' ')).toMatch(/no trae la fecha exacta de inicio/i);

    const [f] = await db.select().from(documentos);
    expect(f.tipo).toBe('contrato');
    expect(f.campos).toEqual(d.campos);
    expect(f.archivo).toMatch(new RegExp(`^documentos/${id}/[0-9a-f-]{36}-Mi-contrato\\.pdf$`));
    expect(blob.archivos.size).toBe(1);
    const guardado = blob.archivos.get(f.archivo)!;
    expect(guardado.contentType).toBe('application/pdf');
    expect(Buffer.from(guardado.body).equals(Buffer.from(bytesPdf('Mi contrato.pdf')))).toBe(true);
    // la ruta del blob no sale en lo que se le devuelve al navegador
    expect(JSON.stringify(d)).not.toContain('documentos/');
    expect(Object.keys(d)).not.toContain('archivo');
  });

  it('reconoce el acta y la póliza', async () => {
    const id = await crearIgualAlDocumento();
    expect((await subir(deps, id, ACTA)).tipo).toBe('acta_prorroga');
    expect((await subir(deps, id, POLIZA)).tipo).toBe('poliza');
  });

  it('sin texto (PDF escaneado) queda como desconocido con la nota de compararlo a ojo, y el PDF se guarda igual', async () => {
    const id = await crearIgualAlDocumento();
    for (const texto of ['', '   \n  ', undefined]) {
      const d = await subirDocumento(deps, { contratoId: id, archivo: { bytes: bytesPdf(), nombre: 'escaneado.pdf' }, texto });
      expect(d.tipo).toBe('desconocido');
      expect(d.campos).toEqual({});
      expect(d.notas).toEqual([NOTA_SIN_TEXTO]);
    }
    expect(NOTA_SIN_TEXTO).toBe('No se pudo leer el texto (¿PDF escaneado?). Compáralo a ojo.');
    expect(blob.archivos.size).toBe(3);
  });

  it('un texto que no es de ningún documento conocido: desconocido, con la nota del lector', async () => {
    const id = await crearIgualAlDocumento();
    const d = await subir(deps, id, 'Receta de arepas: harina, agua y sal. Amasar bien y dejar reposar la masa quince minutos antes de asar.');
    expect(d.tipo).toBe('desconocido');
    expect(d.notas.join(' ')).toMatch(/No se reconoció el tipo/);
  });

  it('solo PDF (se miran los primeros bytes), máximo 4 MB, y la trabajadora tiene que existir', async () => {
    const id = await crearIgualAlDocumento();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const e1 = await fallo(subirDocumento(deps, { contratoId: id, archivo: { bytes: png, nombre: 'foto.pdf' }, texto: CONTRATO }), ErrorAmable);
    expect(e1.estado).toBe(415);
    const enorme = new Uint8Array(MAX_BYTES + 1);
    enorme.set(bytesPdf());
    const e2 = await fallo(subirDocumento(deps, { contratoId: id, archivo: { bytes: enorme, nombre: 'grande.pdf' }, texto: CONTRATO }), ErrorAmable);
    expect(e2.estado).toBe(413);
    const e3 = await fallo(subir(deps, 9999, CONTRATO), ErrorAmable);
    expect(e3.estado).toBe(404);
    expect(blob.archivos.size).toBe(0);
    expect(await db.select().from(documentos)).toHaveLength(0);
  });

  it('hay un tope de documentos por contrato', async () => {
    const id = await crearIgualAlDocumento();
    await db.insert(documentos).values(
      Array.from({ length: MAX_DOCUMENTOS_POR_CONTRATO }, (_, i) => ({
        contratoId: id,
        tipo: 'desconocido',
        nombreArchivo: `d${i}.pdf`,
        archivo: `documentos/${id}/x${i}.pdf`,
        campos: {},
      })),
    );
    const e = await fallo(subir(deps, id, CONTRATO), ErrorAmable);
    expect(e.message).toMatch(/Quita alguno/);
  });

  it('si falla el guardado en Blob no queda la fila', async () => {
    const id = await crearIgualAlDocumento();
    blob.put = async () => {
      throw new Error('blob caído');
    };
    const e = await fallo(subir(deps, id, CONTRATO), ErrorAmable);
    expect(e.estado).toBe(502);
    expect(await db.select().from(documentos)).toHaveLength(0);
  });
});

// =================================================================== listar, ver, quitar
describe('listar, ver y quitar documentos', () => {
  it('lista del más nuevo al más viejo, sin la ruta del blob', async () => {
    const id = await crearIgualAlDocumento();
    const d = conReloj();
    const a = await subir(d, id, CONTRATO);
    const b = await subir(d, id, ACTA);
    const c = await subir(d, id, POLIZA);
    const lista = await listarDocumentos(deps, id);
    expect(lista.map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    expect(lista.map((x) => x.tipo)).toEqual(['poliza', 'acta_prorroga', 'contrato']);
    for (const x of lista) expect(Object.keys(x)).not.toContain('archivo');
    expect(JSON.stringify(lista)).not.toContain('documentos/');
    const e = await fallo(listarDocumentos(deps, 9999), ErrorAmable);
    expect(e.estado).toBe(404);
  });

  it('solo lista los de esa trabajadora', async () => {
    const a = await crearIgualAlDocumento();
    const b = await crearContratista(db, { nombre: 'OTRA PRUEBA', cedula: '1000009999' });
    await subir(deps, a, CONTRATO);
    expect(await listarDocumentos(deps, b)).toHaveLength(0);
    expect(await listarDocumentos(deps, a)).toHaveLength(1);
  });

  it('el PDF se ve inline desde Blob; si no existe, 404', async () => {
    const id = await crearIgualAlDocumento();
    const d = await subir(deps, id, CONTRATO, 'contrato.pdf');
    const v = await documentoParaVer(deps, d.id);
    expect(v.mime).toBe('application/pdf');
    expect(v.nombreArchivo).toBe('contrato.pdf');
    const bytes = new Uint8Array(await new Response(v.stream).arrayBuffer());
    expect(Buffer.from(bytes).equals(Buffer.from(bytesPdf('contrato.pdf')))).toBe(true);
    expect((await fallo(documentoParaVer(deps, 9999), ErrorAmable)).estado).toBe(404);
  });

  it('quitar borra la fila y el PDF de Blob', async () => {
    const id = await crearIgualAlDocumento();
    const d = await subir(deps, id, CONTRATO);
    expect(blob.archivos.size).toBe(1);
    await borrarDocumento(deps, d.id);
    expect(blob.archivos.size).toBe(0);
    expect(await db.select().from(documentos)).toHaveLength(0);
    expect((await fallo(borrarDocumento(deps, d.id), ErrorAmable)).estado).toBe(404);
  });

  it('si Blob falla al quitar, la fila se conserva (se puede reintentar)', async () => {
    const id = await crearIgualAlDocumento();
    const d = await subir(deps, id, CONTRATO);
    const del = blob.del.bind(blob);
    blob.del = async () => {
      throw new Error('blob caído');
    };
    expect((await fallo(borrarDocumento(deps, d.id), ErrorAmable)).estado).toBe(502);
    expect(await db.select().from(documentos)).toHaveLength(1);
    blob.del = del;
    await borrarDocumento(deps, d.id);
    expect(await db.select().from(documentos)).toHaveLength(0);
  });

  it('borrar la trabajadora borra también los PDF de Blob y las filas', async () => {
    const id = await crearIgualAlDocumento();
    await subir(deps, id, CONTRATO);
    await subir(deps, id, ACTA);
    expect(blob.archivos.size).toBe(2);
    await borrarContrato(deps, id);
    expect(blob.archivos.size).toBe(0);
    expect(await db.select().from(documentos)).toHaveLength(0);
  });

  it('rechazar una solicitud borra sus PDF; rechazar una cuenta activa da 404 y no toca sus archivos', async () => {
    const pendiente = await crearIgualAlDocumento({ estado: 'pendiente', activo: false });
    await subir(deps, pendiente, CONTRATO);
    const activa = await crearContratista(db, { nombre: 'ACTIVA DE PRUEBA', cedula: '1000008888' });
    await subir(deps, activa, ACTA);
    expect(blob.archivos.size).toBe(2);
    expect((await fallo(rechazarSolicitud(deps, activa), ErrorAmable)).estado).toBe(404);
    expect(blob.archivos.size).toBe(2);
    await rechazarSolicitud(deps, pendiente);
    expect(blob.archivos.size).toBe(1);
    expect(await db.select().from(documentos)).toHaveLength(1);
  });
});

// =================================================================== comparación
describe('comparación con los datos de la app', () => {
  it('sin documentos: todo "sin dato"', async () => {
    const id = await crearIgualAlDocumento();
    const v = await verificar(deps, id);
    expect(v.documentos).toBe(0);
    expect(v.verificadaEn).toBeNull();
    expect(v.filas.map((f) => f.campo)).toEqual([...CAMPOS_VERIFICACION]);
    for (const f of v.filas) {
      expect(f.estado).toBe('sin_dato');
      expect(f.documento).toBeNull();
      expect(f.fuente).toBeNull();
    }
    expect(fila(v, 'honorario')).toMatchObject({ etiqueta: 'Honorario mensual', actual: 4009000 });
  });

  it('todo igual al contrato: coincide (aunque el objeto del PDF venga con palabras partidas y comillas)', async () => {
    const id = await crearIgualAlDocumento();
    await subir(deps, id, CONTRATO);
    const v = await verificar(deps, id);
    for (const campo of ['numeroContrato', 'nombre', 'cedula', 'objeto', 'honorario', 'valorTotal', 'fin'] as const) {
      expect(fila(v, campo).estado, campo).toBe('coincide');
    }
    // el contrato no trae inicio, dirección, ciudad ni teléfono
    for (const campo of ['inicio', 'direccion', 'ciudad', 'telefono'] as const) expect(fila(v, campo).estado, campo).toBe('sin_dato');
  });

  it('el objeto de la app con otras mayúsculas, sin tildes, sin comillas y con otros espacios coincide', async () => {
    const objetoApp = 'prestacion de servicios como apoyo tecnico/administrativo, en el marco de la ejecucion del contrato ' +
      'interadministrativo N° 4600018487 de 2025, suscrito con la secretaria de las mujeres del departamento de antioquia, ' +
      'cuyo objeto es: FORTALECER ACCIONES DE LA POLITICA PUBLICA DE LAS MUJERES DESDE UN ENFOQUE SICOSOCIAL PARA LA GARANTIA ' +
      'DE SUS DERECHOS HUMANOS.';
    const id = await crearIgualAlDocumento({ objeto: objetoApp });
    await subir(deps, id, CONTRATO);
    expect(fila(await verificar(deps, id), 'objeto').estado).toBe('coincide');
    await db.update(contratos).set({ objeto: objetoApp.replace('SICOSOCIAL', 'SOCIAL') }).where(eq(contratos.id, id));
    expect(fila(await verificar(deps, id), 'objeto').estado).toBe('distinto');
  });

  it('prioridad: el acta le gana al contrato en fin y valor total (venga antes o después)', async () => {
    const id = await crearIgualAlDocumento();
    const d = conReloj();
    await subir(d, id, ACTA); // primero el acta
    await subir(d, id, CONTRATO); // el contrato es más reciente, pero el acta manda
    const v = await verificar(deps, id);
    expect(fila(v, 'fin')).toMatchObject({ actual: '2026-09-30', documento: '2026-11-30', estado: 'distinto' });
    expect(fila(v, 'fin').fuente).toMatchObject({ tipo: 'acta_prorroga' });
    expect(fila(v, 'valorTotal')).toMatchObject({ actual: 36081000, documento: 44099000, estado: 'distinto' });
    expect(fila(v, 'valorTotal').fuente?.tipo).toBe('acta_prorroga');
    // la fuente trae la fecha en que se subió ese documento
    expect(fila(v, 'fin').fuente?.fecha).toBeInstanceOf(Date);
  });

  it('con dos actas manda la más reciente', async () => {
    const id = await crearIgualAlDocumento();
    const d = conReloj();
    await subir(d, id, ACTA.replace('FINALIZANDO EL 30 DE NOVIEMBRE DE 2026', 'FINALIZANDO EL 31 DE OCTUBRE DE 2026'));
    const nueva = await subir(d, id, ACTA);
    const f = fila(await verificar(deps, id), 'fin');
    expect(f.documento).toBe('2026-11-30');
    expect(f.fuente?.documentoId).toBe(nueva.id);
  });

  it('sin acta, el contrato da el fin y el valor total', async () => {
    const id = await crearIgualAlDocumento({ fin: '2026-12-31' });
    await subir(deps, id, CONTRATO);
    const v = await verificar(deps, id);
    expect(fila(v, 'fin')).toMatchObject({ documento: '2026-09-30', estado: 'distinto' });
    expect(fila(v, 'fin').fuente?.tipo).toBe('contrato');
    expect(fila(v, 'valorTotal').fuente?.tipo).toBe('contrato');
  });

  it('inicio: acta antes que póliza; la póliza sola da la vigencia desde; el contrato nunca da inicio', async () => {
    const id = await crearIgualAlDocumento();
    const d = conReloj();
    await subir(d, id, CONTRATO);
    expect(fila(await verificar(deps, id), 'inicio').estado).toBe('sin_dato');
    await subir(d, id, POLIZA);
    expect(fila(await verificar(deps, id), 'inicio')).toMatchObject({ documento: '2026-01-01', estado: 'coincide' });
    expect(fila(await verificar(deps, id), 'inicio').fuente?.tipo).toBe('poliza');
    await subir(d, id, ACTA_OTRA); // el acta dice 15 de enero y manda sobre la póliza
    const f = fila(await verificar(deps, id), 'inicio');
    expect(f).toMatchObject({ documento: '2026-01-15', estado: 'distinto' });
    expect(f.fuente?.tipo).toBe('acta_prorroga');
  });

  it('honorario: el contrato le gana al acta (que lo deduce); sin contrato se usa el del acta', async () => {
    const id = await crearIgualAlDocumento();
    const d = conReloj();
    await subir(d, id, CONTRATO);
    await subir(d, id, ACTA_OTRA); // deduce 4.000.000
    let f = fila(await verificar(deps, id), 'honorario');
    expect(f).toMatchObject({ documento: 4009000, estado: 'coincide' });
    expect(f.fuente?.tipo).toBe('contrato');

    const solo = await crearContratista(db, { nombre: 'SOLO ACTA', cedula: '1000007777', honorario: 4009000 });
    await subir(d, solo, ACTA_OTRA);
    f = fila(await verificar(deps, solo), 'honorario');
    expect(f).toMatchObject({ documento: 4000000, estado: 'distinto' });
    expect(f.fuente?.tipo).toBe('acta_prorroga');
  });

  it('los demás datos salen del documento más reciente que los traiga', async () => {
    const id = await crearIgualAlDocumento();
    const d = conReloj();
    await subir(d, id, CONTRATO);
    const poliza = await subir(d, id, POLIZA);
    const v = await verificar(deps, id);
    // nombre y cédula los traen los dos: gana la póliza (la última que se subió)
    expect(fila(v, 'nombre').fuente?.documentoId).toBe(poliza.id);
    expect(fila(v, 'cedula').fuente?.documentoId).toBe(poliza.id);
    // dirección, ciudad y teléfono solo los trae la póliza
    for (const campo of ['direccion', 'ciudad', 'telefono'] as const) {
      expect(fila(v, campo), campo).toMatchObject({ estado: 'coincide' });
      expect(fila(v, campo).fuente?.tipo).toBe('poliza');
    }
    // el objeto solo lo trae el contrato (la póliza no)
    expect(fila(v, 'objeto').fuente?.tipo).toBe('contrato');
    // y si después se sube otro contrato, ese pasa a ser el más reciente
    const otro = await subir(d, id, CONTRATO);
    expect(fila(await verificar(deps, id), 'nombre').fuente?.documentoId).toBe(otro.id);
  });

  it('un documento que no se pudo leer no aporta nada', async () => {
    const id = await crearIgualAlDocumento();
    await subir(deps, id, '');
    const v = await verificar(deps, id);
    expect(v.documentos).toBe(1);
    for (const f of v.filas) expect(f.estado).toBe('sin_dato');
  });

  it('un dato vacío en la app y con valor en el documento es "distinto" (y se puede copiar)', async () => {
    const id = await crearIgualAlDocumento({ direccion: '', telefono: '' });
    await subir(deps, id, POLIZA);
    const v = await verificar(deps, id);
    expect(fila(v, 'direccion')).toMatchObject({ actual: null, documento: 'CL 36 AA SUR 26 A 30', estado: 'distinto' });
    expect(fila(v, 'telefono')).toMatchObject({ actual: null, documento: '3001234567', estado: 'distinto' });
  });

  it('cédula y teléfono se comparan solo con los dígitos; el nombre sin tildes ni mayúsculas', async () => {
    const id = await crearIgualAlDocumento({ cedula: '1000001234', telefono: '300 123 4567', nombre: '  prueba  PEREZ de la  torre ' });
    await subir(deps, id, POLIZA);
    const v = await verificar(deps, id);
    expect(fila(v, 'cedula').estado).toBe('coincide');
    expect(fila(v, 'telefono').estado).toBe('coincide');
    expect(fila(v, 'nombre').estado).toBe('coincide');
    await db.update(contratos).set({ cedula: '1000001235' }).where(eq(contratos.id, id));
    expect(fila(await verificar(deps, id), 'cedula').estado).toBe('distinto');
  });

  it('el dinero y las fechas son exactos', async () => {
    const id = await crearIgualAlDocumento({ honorario: 4009001, fin: '2026-09-29' });
    await subir(deps, id, CONTRATO);
    const v = await verificar(deps, id);
    expect(fila(v, 'honorario').estado).toBe('distinto');
    expect(fila(v, 'fin').estado).toBe('distinto');
    expect(fila(v, 'valorTotal').estado).toBe('coincide');
  });

  it('también funciona con solicitudes pendientes', async () => {
    const id = await crearIgualAlDocumento({ estado: 'pendiente', activo: false });
    const d = await subir(deps, id, CONTRATO);
    expect((await listarDocumentos(deps, id)).map((x) => x.id)).toEqual([d.id]);
    expect(fila(await verificar(deps, id), 'numeroContrato').estado).toBe('coincide');
  });
});

describe('claves de comparación (puras)', () => {
  it('nombre, objeto, cédula, teléfono y n.º de contrato', () => {
    expect(sonIguales('nombre', 'María  Pérez', 'MARIA PEREZ')).toBe(true);
    expect(sonIguales('nombre', 'María Pérez', 'MARIA PEREZ GOMEZ')).toBe(false);
    expect(sonIguales('objeto', 'Garantizar los DERE CHOS humanos', 'garantizar los derechos  humanos')).toBe(true);
    expect(sonIguales('objeto', '“Garantizar los derechos”', 'Garantizar los derechos')).toBe(true);
    expect(sonIguales('objeto', 'Garantizar los derechos', 'Garantizar los deberes')).toBe(false);
    expect(sonIguales('cedula', '1.000.001.234', '1000001234')).toBe(true);
    expect(sonIguales('telefono', '+57 300 123 4567', '573001234567')).toBe(true);
    expect(sonIguales('numeroContrato', '2026 cps 043', '2026CPS043')).toBe(true);
    expect(sonIguales('numeroContrato', '2026CPSP043', '2026CPS043')).toBe(false);
    expect(sonIguales('honorario', 4009000, 4009000)).toBe(true);
    expect(sonIguales('honorario', 4009000, 4009001)).toBe(false);
    expect(sonIguales('fin', '2026-09-30', '2026-09-30')).toBe(true);
    expect(sonIguales('fin', '2026-09-30', '2026-10-01')).toBe(false);
  });

  it('un valor vacío nunca coincide con otro vacío ni con uno lleno', () => {
    expect(sonIguales('nombre', '', '')).toBe(false);
    expect(sonIguales('cedula', null, '123456')).toBe(false);
    expect(claveComparacion('cedula', undefined)).toBe('');
  });
});

// =================================================================== usar el del documento
describe('usar el dato del documento', () => {
  it('copia el valor al contrato, lo anota en la bitácora (admin) y recalcula el %', async () => {
    const id = await crearIgualAlDocumento();
    await subir(deps, id, ACTA);
    await crearCarga(db, id, '2026-01', { acumulado: 4009000, pct: 4009000 / 36081000 });
    const c = await usarDelDocumento(deps, id, 'valorTotal');
    expect(c.valorTotal).toBe(44099000);
    const cs = await usarDelDocumento(deps, id, 'fin');
    expect(cs.fin).toBe('2026-11-30');

    const [fila0] = await db.select().from(contratos).where(eq(contratos.id, id));
    expect(fila0.valorTotal).toBe(44099000);
    expect(fila0.fin).toBe('2026-11-30');
    const cambios = await db.select().from(cambiosContrato).where(eq(cambiosContrato.contratoId, id));
    expect(cambios.map((x) => ({ autor: x.autor, campo: x.campo, antes: x.antes, despues: x.despues }))).toEqual(
      expect.arrayContaining([
        { autor: 'admin', campo: 'valorTotal', antes: '$36.081.000', despues: '$44.099.000' },
        { autor: 'admin', campo: 'fin', antes: '30/09/2026', despues: '30/11/2026' },
      ]),
    );
    const [carga] = await db.select().from(cargas).where(eq(cargas.contratoId, id));
    expect(carga.pct).toBeCloseTo(4009000 / 44099000, 6);

    const v = await verificar(deps, id);
    expect(fila(v, 'valorTotal').estado).toBe('coincide');
    expect(fila(v, 'fin').estado).toBe('coincide');
  });

  it('con datos personales, la bitácora dice "(dato personal)" y nunca guarda el valor', async () => {
    const id = await crearIgualAlDocumento({ cedula: '1000009876', telefono: '3009999999', direccion: 'Calle Vieja 1-2', nombre: 'Nombre Equivocado' });
    await subir(deps, id, POLIZA);
    for (const campo of ['cedula', 'telefono', 'direccion', 'nombre']) await usarDelDocumento(deps, id, campo);
    const [c] = await db.select().from(contratos).where(eq(contratos.id, id));
    expect(c).toMatchObject({ cedula: '1000001234', telefono: '3001234567', direccion: 'CL 36 AA SUR 26 A 30', nombre: 'PRUEBA PÉREZ DE LA TORRE' });
    const cambios = await db.select().from(cambiosContrato).where(eq(cambiosContrato.contratoId, id));
    expect(cambios.map((x) => x.campo).sort()).toEqual(['cedula', 'direccion', 'nombre', 'telefono']);
    for (const x of cambios) {
      expect(x.autor).toBe('admin');
      expect(x.antes).toBe('(dato personal)');
      expect(x.despues).toBe('(dato personal)');
    }
  });

  it('la ciudad sí se anota con su valor (no es un dato personal)', async () => {
    const id = await crearIgualAlDocumento({ ciudad: 'Bello' });
    await subir(deps, id, POLIZA);
    await usarDelDocumento(deps, id, 'ciudad');
    const [x] = await db.select().from(cambiosContrato).where(eq(cambiosContrato.contratoId, id));
    expect(x).toMatchObject({ campo: 'ciudad', antes: 'Bello', despues: 'Envigado' });
  });

  it('el servidor saca el valor del documento: lo que mande el cliente no cuenta', async () => {
    const id = await crearIgualAlDocumento();
    await subir(deps, id, ACTA);
    await usarDelDocumento(deps, id, 'valorTotal');
    const [c] = await db.select().from(contratos).where(eq(contratos.id, id));
    expect(c.valorTotal).toBe(44099000);
  });

  it('errores: campo raro, dato que ningún documento trae, validación del panel (sin cambiar nada)', async () => {
    const id = await crearIgualAlDocumento();
    await subir(deps, id, CONTRATO);
    expect((await fallo(usarDelDocumento(deps, id, 'activo'), ErrorAmable)).message).toMatch(/no se puede copiar/);
    expect((await fallo(usarDelDocumento(deps, id, undefined), ErrorAmable)).message).toMatch(/no se puede copiar/);
    expect((await fallo(usarDelDocumento(deps, id, 'telefono'), ErrorAmable)).message).toMatch(/Ningún documento/);
    // el honorario del documento queda por encima del valor total de la app: el panel no lo deja
    await db.update(contratos).set({ valorTotal: 1000000, honorario: 500000 }).where(eq(contratos.id, id));
    const e = await fallo(usarDelDocumento(deps, id, 'honorario'), ErrorValidacion);
    expect(e.campos.valorTotal).toBeDefined();
    const [c] = await db.select().from(contratos).where(eq(contratos.id, id));
    expect(c.honorario).toBe(500000);
    expect((await fallo(usarDelDocumento(deps, 9999, 'fin'), ErrorAmable)).estado).toBe(404);
  });

  it('funciona con una solicitud pendiente y la deja pendiente', async () => {
    const id = await crearIgualAlDocumento({ estado: 'pendiente', activo: false, fin: '2026-12-31' });
    await subir(deps, id, ACTA);
    const c = await usarDelDocumento(deps, id, 'fin');
    expect(c.fin).toBe('2026-11-30');
    const [f] = await db.select().from(contratos).where(eq(contratos.id, id));
    expect(f).toMatchObject({ estado: 'pendiente', activo: false, fin: '2026-11-30' });
  });
});

// =================================================================== marcar verificada
describe('marcar como verificada', () => {
  it('guarda la fecha, la anota en la bitácora y sale en la comparación', async () => {
    const id = await crearIgualAlDocumento();
    await subir(deps, id, CONTRATO);
    const c = await marcarVerificada(deps, id);
    expect(c.verificadaEn?.toISOString()).toBe(AHORA.toISOString());
    const [f] = await db.select().from(contratos).where(eq(contratos.id, id));
    expect(f.verificadaEn?.toISOString()).toBe(AHORA.toISOString());
    const [x] = await db.select().from(cambiosContrato).where(eq(cambiosContrato.contratoId, id));
    expect(x).toMatchObject({ autor: 'admin', campo: 'verificada', despues: 'Verificada' });
    expect((await verificar(deps, id)).verificadaEn?.toISOString()).toBe(AHORA.toISOString());
  });

  it('hace falta al menos un documento', async () => {
    const id = await crearIgualAlDocumento();
    const e = await fallo(marcarVerificada(deps, id), ErrorAmable);
    expect(e.message).toMatch(/al menos un documento/);
    const [f] = await db.select().from(contratos).where(eq(contratos.id, id));
    expect(f.verificadaEn).toBeNull();
    expect((await fallo(marcarVerificada(deps, 9999), ErrorAmable)).estado).toBe(404);
  });

  it('si la contratista cambia un dato de su contrato, la marca se borra', async () => {
    const id = await crearIgualAlDocumento();
    await subir(deps, id, CONTRATO);
    await marcarVerificada(deps, id);
    await guardarMiContrato(deps, id, { ciudad: 'Bello' });
    const [f] = await db.select().from(contratos).where(eq(contratos.id, id));
    expect(f.ciudad).toBe('Bello');
    expect(f.verificadaEn).toBeNull();
    expect((await verificar(deps, id)).verificadaEn).toBeNull();
  });

  it('si la contratista guarda lo mismo que ya tenía, la marca sigue', async () => {
    const id = await crearIgualAlDocumento();
    await subir(deps, id, CONTRATO);
    await marcarVerificada(deps, id);
    await guardarMiContrato(deps, id, { ciudad: 'Envigado' });
    const [f] = await db.select().from(contratos).where(eq(contratos.id, id));
    expect(f.verificadaEn).not.toBeNull();
  });

  it('lo que edita el supervisor (editar, o copiar del documento) NO borra la marca', async () => {
    const id = await crearIgualAlDocumento();
    await subir(deps, id, ACTA);
    await marcarVerificada(deps, id);
    await actualizarContrato(deps, id, { objeto: 'Otro objeto de prueba.', ciudad: 'Sabaneta' });
    await usarDelDocumento(deps, id, 'fin');
    const [f] = await db.select().from(contratos).where(eq(contratos.id, id));
    expect(f.objeto).toBe('Otro objeto de prueba.');
    expect(f.fin).toBe('2026-11-30');
    expect(f.verificadaEn?.toISOString()).toBe(AHORA.toISOString());
  });

  it('funciona con solicitudes pendientes y la marca sobrevive a la aprobación', async () => {
    const id = await crearIgualAlDocumento({ estado: 'pendiente', activo: false });
    await subir(deps, id, CONTRATO);
    const c = await marcarVerificada(deps, id);
    expect(c.verificadaEn).not.toBeNull();
    const aprobada = await aprobarSolicitud(deps, id, {});
    expect(aprobada.verificadaEn?.toISOString()).toBe(AHORA.toISOString());
  });
});

// =================================================================== acceso del supervisor
describe('acceso: solo el supervisor', () => {
  const SECRETO = 'un-secreto-de-prueba-de-al-menos-32-caracteres!!';
  let guardado: string | undefined;

  beforeEach(() => {
    guardado = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = SECRETO;
  });
  afterEach(() => {
    if (guardado === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = guardado;
  });

  it('sin la cookie de admin (o con una falsa o de contratista) da 401; con la buena, pasa', () => {
    const pedido = (cookie?: string) => new NextRequest('http://localhost/api/admin/documentos', cookie ? { headers: { cookie } } : {});
    for (const cookie of [undefined, 'admin=', 'admin=falsa.firma', 'sesion=' + crearTokenAdmin(SECRETO)]) {
      let status = 0;
      try {
        exigirAdmin(pedido(cookie));
      } catch (e) {
        status = e instanceof ErrorAmable ? e.estado : -1;
      }
      expect(status, String(cookie)).toBe(401);
    }
    expect(() => exigirAdmin(pedido('admin=' + crearTokenAdmin(SECRETO)))).not.toThrow();
  });

  it('las 6 rutas nuevas exigen la cookie de admin antes de hacer nada', () => {
    const rutas = [
      'documentos/route.ts',
      'documentos/[id]/route.ts',
      'documentos/[id]/archivo/route.ts',
      'verificacion/[contratoId]/route.ts',
      'verificacion/[contratoId]/usar/route.ts',
      'verificacion/[contratoId]/marcar/route.ts',
    ];
    for (const r of rutas) {
      const src = readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'admin', ...r.split('/')), 'utf8');
      const handlers = src.match(/export async function (GET|POST|DELETE)/g) ?? [];
      const guardias = src.match(/exigirAdmin\(req\)/g) ?? [];
      expect(handlers.length, r).toBeGreaterThan(0);
      expect(guardias.length, r).toBe(handlers.length);
    }
  });
});
