import { connection, type NextRequest } from 'next/server';
import { exigirAdmin, ok, responder } from '@/server/http';

// GET /api/admin/sesion -> { ok, admin: true } o 401
export async function GET(req: NextRequest) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    return ok({ admin: true });
  });
}
