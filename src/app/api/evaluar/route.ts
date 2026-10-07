import type { NextRequest } from 'next/server';
import { contratoIdDeSesion, deps, leerJson, ok, responder } from '@/server/http';
import { evaluar } from '@/server/servicios';

// POST /api/evaluar { mes, fechaInicio, fechaCorte, datos, adicionales, diasManual } -> { ok, evaluacion }. No guarda nada.
export async function POST(req: NextRequest) {
  return responder(async () => {
    const contratoId = contratoIdDeSesion(req);
    const cuerpo = await leerJson(req);
    return ok({ evaluacion: await evaluar(deps(), contratoId, cuerpo) });
  });
}