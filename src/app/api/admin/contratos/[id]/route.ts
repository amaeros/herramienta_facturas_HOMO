import type { NextRequest } from 'next/server';
import { actualizarContrato, borrarContrato } from '@/server/admin';
import { deps, exigirAdmin, idDeRuta, leerJson, ok, responder } from '@/server/http';

type Ctx = { params: Promise<{ id: string }> };
const NO_EXISTE = 'No encontramos a esa trabajadora.';

// PUT /api/admin/contratos/<id> {campos} -> { ok, contrato }
export async function PUT(req: NextRequest, ctx: Ctx) {
  return responder(async () => {
    exigirAdmin(req);
    const id = idDeRuta((await ctx.params).id, NO_EXISTE);
    return ok({ contrato: await actualizarContrato(deps(), id, await leerJson(req)) });
  });
}

// DELETE /api/admin/contratos/<id> {confirmar?} -> { ok }
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return responder(async () => {
    exigirAdmin(req);
    const id = idDeRuta((await ctx.params).id, NO_EXISTE);
    const cuerpo = await leerJson(req);
    await borrarContrato(deps(), id, cuerpo.confirmar);
    return ok();
  });
}
