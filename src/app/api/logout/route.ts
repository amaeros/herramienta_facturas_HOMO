import { NextResponse } from 'next/server';
import { ok, quitarCookieSesion, responder } from '@/server/http';

// POST /api/logout -> { ok }  (borra la cookie)
export async function POST() {
  return responder(async () => {
    const res: NextResponse = ok();
    quitarCookieSesion(res);
    return res;
  });
}