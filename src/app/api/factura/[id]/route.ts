import { connection, type NextRequest } from 'next/server';
import { generarFacturaXlsx, nombreArchivoFactura } from '@/lib/factura';
import { generarFacturaPdf, nombreArchivoFacturaPdf } from '@/lib/facturaPdf';
import { ADMIN_COOKIE, accesoFactura } from '@/server/adminAuth';
import { SESION_COOKIE } from '@/server/auth';
import { ErrorAmable } from '@/server/errores';
import { contentDispositionAdjunto, deps, idDeRuta, responder } from '@/server/http';
import { datosFactura } from '@/server/servicios';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_PDF = 'application/pdf';

// GET /api/factura/<cargaId>                -> el .xlsx (attachment)
// GET /api/factura/<cargaId>?formato=pdf    -> el mismo documento en PDF de una página carta, listo para imprimir
// Solo para la contratista dueña de la cuenta de cobro o para el supervisor (cookie `admin`), que puede bajar la de cualquiera.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    const formato = (req.nextUrl.searchParams.get('formato') ?? 'xlsx').toLowerCase();
    if (formato !== 'xlsx' && formato !== 'pdf') throw new ErrorAmable('Ese formato no existe. Usa xlsx o pdf.', 400);
    // undefined = admin (sin filtro por dueña); número = la contratista de la sesión
    const contratoId = accesoFactura(req.cookies.get(SESION_COOKIE)?.value, req.cookies.get(ADMIN_COOKIE)?.value);
    const id = idDeRuta((await ctx.params).id, 'No encontramos esa cuenta de cobro.');
    const { datos } = await datosFactura(deps(), id, contratoId);
    const esPdf = formato === 'pdf';
    const buf = esPdf ? await generarFacturaPdf(datos) : await generarFacturaXlsx(datos);
    const nombre = esPdf ? nombreArchivoFacturaPdf(datos.docNum, datos.nombre) : nombreArchivoFactura(datos.docNum, datos.nombre);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': esPdf ? MIME_PDF : MIME_XLSX,
        'Content-Disposition': contentDispositionAdjunto(nombre),
        'Content-Length': String(buf.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
