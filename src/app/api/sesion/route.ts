import { connection, type NextRequest } from 'next/server';
import { contratoIdDeSesion, deps, ok, responder } from '@/server/http';
import { resumenDeSesion } from '@/server/servicios';

// GET /api/sesion -> { ok, contrato }  (para refrescar el resumen tras enviar)
export async function GET(req: NextRequest) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    const contratoId = contratoIdDeSesion(req);
    return ok({ contrato: await resumenDeSesion(deps(), contratoId) });
  });
}