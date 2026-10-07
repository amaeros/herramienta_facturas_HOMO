import { connection, type NextRequest } from 'next/server';
import { guardarParametros, leerParametros } from '@/server/admin';
import { deps, exigirAdmin, leerJson, ok, responder } from '@/server/http';

// GET /api/admin/parametros -> { ok, parametros }
export async function GET(req: NextRequest) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    return ok({ parametros: await leerParametros(deps()) });
  });
}

// PUT /api/admin/parametros {campos} -> { ok, parametros }   (errores: { ok:false, error, campos })
export async function PUT(req: NextRequest) {
  return responder(async () => {
    exigirAdmin(req);
    return ok({ parametros: await guardarParametros(deps(), await leerJson(req)) });
  });
}
