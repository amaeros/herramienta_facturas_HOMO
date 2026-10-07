import type { NextRequest } from 'next/server';
import { leerJson, deps, ok, ponerCookieSesion, responder } from '@/server/http';
import { login } from '@/server/servicios';

// POST /api/login { nombre, pin } -> { ok, contrato } + cookie de sesión
export async function POST(req: NextRequest) {
  return responder(async () => {
    const cuerpo = await leerJson(req);
    const { contratoId, resumen } = await login(deps(), cuerpo.nombre, cuerpo.pin);
    const res = ok({ contrato: resumen });
    ponerCookieSesion(res, contratoId);
    return res;
  });
}