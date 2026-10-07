import { connection, type NextRequest } from 'next/server';
import { MAX_BYTES } from '@/server/archivos';
import { listarDocumentos, subirDocumento } from '@/server/documentos';
import { ErrorAmable } from '@/server/errores';
import { deps, exigirAdmin, idDeRuta, ok, responder } from '@/server/http';

const NO_EXISTE = 'No encontramos a esa trabajadora.';
const MSG_GRANDE = 'El archivo pesa más de 4 MB. Sube un PDF más liviano.';

// GET /api/admin/documentos?contratoId=<id> -> { ok, documentos: [{ id, contratoId, tipo, nombreArchivo, campos, notas, subido }] }
// Del más nuevo al más viejo. Nunca trae la ruta del archivo en Blob.
export async function GET(req: NextRequest) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    const contratoId = idDeRuta(req.nextUrl.searchParams.get('contratoId') ?? '', NO_EXISTE);
    return ok({ documentos: await listarDocumentos(deps(), contratoId) });
  });
}

// POST /api/admin/documentos (multipart: contratoId, archivo PDF <= 4 MB, texto = lo que leyó pdf.js en el navegador)
//   -> { ok, documento }  (201)
// El servidor vuelve a leer `texto` con leerDocumento: lo que el navegador haya interpretado no se usa.
export async function POST(req: NextRequest) {
  return responder(async () => {
    exigirAdmin(req);
    const largo = Number(req.headers.get('content-length') ?? 0);
    if (largo > MAX_BYTES + 400_000) throw new ErrorAmable(MSG_GRANDE, 413);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ErrorAmable('No pudimos abrir el archivo. Vuelve a elegirlo.');
    }
    const id = form.get('contratoId');
    const contratoId = idDeRuta(typeof id === 'string' ? id : '', NO_EXISTE);
    const archivo = form.get('archivo');
    if (!archivo || typeof archivo === 'string') throw new ErrorAmable('No recibimos el archivo. Vuelve a elegirlo.');
    if (archivo.size > MAX_BYTES) throw new ErrorAmable(MSG_GRANDE, 413);
    const texto = form.get('texto');
    const documento = await subirDocumento(deps(), {
      contratoId,
      archivo: { bytes: new Uint8Array(await archivo.arrayBuffer()), nombre: archivo.name || 'documento.pdf' },
      texto: typeof texto === 'string' ? texto : '',
    });
    return ok({ documento }, { status: 201 });
  });
}
