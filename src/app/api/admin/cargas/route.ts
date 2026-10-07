import { connection, type NextRequest } from 'next/server';
import { listarCargas } from '@/server/admin';
import { deps, exigirAdmin, ok, responder } from '@/server/http';

// GET /api/admin/cargas?mes=YYYY-MM -> { ok, mes, cargas:[...], faltan:[{contratoId, nombre}] }
// Sin `mes`: el mes anterior al actual (hora de Bogotá).
export async function GET(req: NextRequest) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    return ok({ ...(await listarCargas(deps(), req.nextUrl.searchParams.get('mes'))) });
  });
}
