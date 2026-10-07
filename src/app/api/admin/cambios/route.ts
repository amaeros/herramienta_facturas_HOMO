import { connection, type NextRequest } from 'next/server';
import { listarCambios } from '@/server/cambios';
import { deps, exigirAdmin, ok, responder } from '@/server/http';

// GET /api/admin/cambios?contratoId=<id> -> { ok, cambios: [{ id, contratoId, nombre, autor, campo, etiqueta, antes, despues, creado }] }
// Los más nuevos primero, máximo 100. Sin contratoId: los de todas las trabajadoras.
export async function GET(req: NextRequest) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    return ok({ cambios: await listarCambios(deps().db, req.nextUrl.searchParams.get('contratoId')) });
  });
}
