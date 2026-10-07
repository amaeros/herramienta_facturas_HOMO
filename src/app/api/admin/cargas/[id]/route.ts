import type { NextRequest } from 'next/server';
import { actualizarCarga } from '@/server/admin';
import { deps, exigirAdmin, idDeRuta, leerJson, ok, responder } from '@/server/http';

// PATCH /api/admin/cargas/<id> { aprobado?: boolean, observacion?: string } -> { ok, carga }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    exigirAdmin(req);
    const id = idDeRuta((await ctx.params).id, 'No encontramos esa cuenta de cobro.');
    return ok({ carga: await actualizarCarga(deps(), id, await leerJson(req)) });
  });
}
