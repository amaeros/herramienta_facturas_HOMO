import type { NextRequest } from 'next/server';
import { contratoIdDeSesion, deps, leerJson, ok, responder } from '@/server/http';
import { enviar } from '@/server/servicios';

// POST /api/enviar { mes, fechaInicio, fechaCorte, datos, tempId, adicionales, diasManual }
//   -> { ok, estado, estadoTexto, emoji, mensaje, factura: { nombre, url } }
export async function POST(req: NextRequest) {
  return responder(async () => {
    const contratoId = contratoIdDeSesion(req);
    const cuerpo = await leerJson(req);
    return ok({ ...(await enviar(deps(), contratoId, cuerpo)) });
  });
}