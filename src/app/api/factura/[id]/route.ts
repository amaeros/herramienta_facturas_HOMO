import { connection, type NextRequest } from 'next/server';
import { generarFacturaXlsx, nombreArchivoFactura } from '@/lib/factura';
import { ErrorAmable } from '@/server/errores';
import { contentDispositionAdjunto, contratoIdDeSesion, deps, responder } from '@/server/http';
import { datosFactura } from '@/server/servicios';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// GET /api/factura/<cargaId> -> el .xlsx (attachment). Solo para la contratista dueña de la cuenta de cobro.
// (El acceso de admin se agrega en la fase 3, con su cookie aparte.)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    const contratoId = contratoIdDeSesion(req);
    const { id } = await ctx.params;
    if (!/^\d{1,9}$/.test(id)) throw new ErrorAmable('No encontramos esa cuenta de cobro.', 404);
    const { datos } = await datosFactura(deps(), Number(id), contratoId);
    const buf = await generarFacturaXlsx(datos);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': MIME_XLSX,
        'Content-Disposition': contentDispositionAdjunto(nombreArchivoFactura(datos.docNum, datos.nombre)),
        'Content-Length': String(buf.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}