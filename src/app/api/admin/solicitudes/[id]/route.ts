import { connection, type NextRequest } from 'next/server';
import { deps, exigirAdmin, idDeRuta, ok, responder } from '@/server/http';
import { detalleSolicitud } from '@/server/solicitudes';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/solicitudes/<id> -> { ok, solicitud: { ...todos los campos, cedula completa, solicitada } }
export async function GET(req: NextRequest, ctx: Ctx) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    const id = idDeRuta((await ctx.params).id, 'No encontramos esa solicitud.');
    return ok({ solicitud: await detalleSolicitud(deps(), id) });
  });
}
