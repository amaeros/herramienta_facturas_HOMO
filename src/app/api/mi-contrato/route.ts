import { connection, type NextRequest } from 'next/server';
import { contratoIdDeSesion, deps, leerJson, ok, responder } from '@/server/http';
import { guardarMiContrato, leerMiContrato } from '@/server/miContrato';

// GET /api/mi-contrato -> { ok, datos: { inicio, fin, revisoNombre, revisoCargo } }
export async function GET(req: NextRequest) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    const contratoId = contratoIdDeSesion(req);
    return ok({ datos: await leerMiContrato(deps(), contratoId) });
  });
}

// PUT /api/mi-contrato { inicio?, fin?, revisoNombre?, revisoCargo? } -> { ok, datos, contrato: Resumen }
// Cualquier otra clave se ignora. Errores: { ok:false, error, campos:{ campo: mensaje } }.
export async function PUT(req: NextRequest) {
  return responder(async () => {
    const contratoId = contratoIdDeSesion(req);
    const { datos, contrato } = await guardarMiContrato(deps(), contratoId, await leerJson(req));
    return ok({ datos, contrato });
  });
}
