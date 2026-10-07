import type { NextRequest } from 'next/server';
import { deps, exigirAdmin, idDeRuta, ok, responder } from '@/server/http';
import { rechazarSolicitud } from '@/server/solicitudes';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/solicitudes/<id>/rechazar -> { ok }   (borra la solicitud pendiente; nunca una cuenta aprobada)
export async function POST(req: NextRequest, ctx: Ctx) {
  return responder(async () => {
    exigirAdmin(req);
    const id = idDeRuta((await ctx.params).id, 'No encontramos esa solicitud.');
    await rechazarSolicitud(deps(), id);
    return ok();
  });
}
