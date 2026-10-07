import { connection, type NextRequest } from 'next/server';
import { crearContrato, listarContratos } from '@/server/admin';
import { deps, exigirAdmin, leerJson, ok, responder } from '@/server/http';

// GET /api/admin/contratos -> { ok, contratos: [{...campos, cargas}] }
export async function GET(req: NextRequest) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    return ok({ contratos: await listarContratos(deps()) });
  });
}

// POST /api/admin/contratos {campos} -> { ok, contrato }   (errores de validación: { ok:false, error, campos })
export async function POST(req: NextRequest) {
  return responder(async () => {
    exigirAdmin(req);
    return ok({ contrato: await crearContrato(deps(), await leerJson(req)) }, { status: 201 });
  });
}
