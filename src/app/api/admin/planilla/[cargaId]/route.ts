import { connection, type NextRequest } from 'next/server';
import { planillaParaVer } from '@/server/admin';
import { contentDispositionAdjunto, deps, exigirAdmin, idDeRuta, responder } from '@/server/http';

// GET /api/admin/planilla/<cargaId>?n=0 -> el archivo de Blob privado (n = 0 principal, 1..3 adicionales), `inline`.
export async function GET(req: NextRequest, ctx: { params: Promise<{ cargaId: string }> }) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    const cargaId = idDeRuta((await ctx.params).cargaId, 'No encontramos esa cuenta de cobro.');
    const nParam = req.nextUrl.searchParams.get('n') ?? '0';
    const n = /^\d$/.test(nParam) ? Number(nParam) : -1;
    const p = await planillaParaVer(deps(), cargaId, n);
    const headers: Record<string, string> = {
      'Content-Type': p.mime,
      'Content-Disposition': contentDispositionAdjunto(p.nombreArchivo, 'inline'),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (p.size !== null) headers['Content-Length'] = String(p.size);
    return new Response(p.stream, { status: 200, headers });
  });
}
