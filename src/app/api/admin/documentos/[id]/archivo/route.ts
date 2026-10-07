import { connection, type NextRequest } from 'next/server';
import { documentoParaVer } from '@/server/documentos';
import { contentDispositionAdjunto, deps, exigirAdmin, idDeRuta, responder } from '@/server/http';

// GET /api/admin/documentos/<id>/archivo -> el PDF desde Blob privado, `inline`.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    const id = idDeRuta((await ctx.params).id, 'No encontramos ese documento.');
    const d = await documentoParaVer(deps(), id);
    const headers: Record<string, string> = {
      'Content-Type': d.mime,
      'Content-Disposition': contentDispositionAdjunto(d.nombreArchivo, 'inline'),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (d.size !== null) headers['Content-Length'] = String(d.size);
    return new Response(d.stream, { status: 200, headers });
  });
}
