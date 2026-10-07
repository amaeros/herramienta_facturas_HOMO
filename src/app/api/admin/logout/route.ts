import { ok, quitarCookieAdmin, responder } from '@/server/http';

// POST /api/admin/logout -> { ok }  (borra la cookie `admin`)
export async function POST() {
  return responder(async () => {
    const res = ok();
    quitarCookieAdmin(res);
    return res;
  });
}
