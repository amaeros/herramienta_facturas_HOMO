import type { NextRequest } from 'next/server';
import { deps, exigirAdmin, idDeRuta, leerJson, ok, responder } from '@/server/http';
import { aprobarSolicitud } from '@/server/solicitudes';

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/solicitudes/<id>/aprobar {campos corregidos?} -> { ok, contrato }
// El cuerpo es opcional: lo que viene se valida como la edición de una trabajadora (errores: { ok:false, error, campos }).
export async function POST(req: NextRequest, ctx: Ctx) {
  return responder(async () => {
    exigirAdmin(req);
    const id = idDeRuta((await ctx.params).id, 'No encontramos esa solicitud.');
    return ok({ contrato: await aprobarSolicitud(deps(), id, await leerJson(req)) });
  });
}
