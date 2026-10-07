import type { NextRequest } from 'next/server';
import { verificarAdmin } from '@/server/adminAuth';
import { deps, leerJson, ok, ponerCookieAdmin, responder } from '@/server/http';

// POST /api/admin/login { password } -> { ok, admin: true } + cookie `admin` (8 h).
// 5 fallos en 10 min bloquean 10 min. Sin ADMIN_PASSWORD siempre falla con un mensaje claro.
export async function POST(req: NextRequest) {
  return responder(async () => {
    const cuerpo = await leerJson(req);
    await verificarAdmin(deps().db, cuerpo.password);
    const res = ok({ admin: true });
    ponerCookieAdmin(res);
    return res;
  });
}
