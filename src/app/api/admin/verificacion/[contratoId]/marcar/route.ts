import type { NextRequest } from 'next/server';
import { marcarVerificada } from '@/server/documentos';
import { deps, exigirAdmin, idDeRuta, ok, responder } from '@/server/http';

// POST /api/admin/verificacion/<contratoId>/marcar -> { ok, contrato }  (contrato.verificadaEn = ahora)
// Hace falta al menos un documento subido. Si la contratista cambia después un dato de su contrato, la marca se borra.
export async function POST(req: NextRequest, ctx: { params: Promise<{ contratoId: string }> }) {
  return responder(async () => {
    exigirAdmin(req);
    const contratoId = idDeRuta((await ctx.params).contratoId, 'No encontramos a esa trabajadora.');
    return ok({ contrato: await marcarVerificada(deps(), contratoId) });
  });
}
