import { connection, type NextRequest } from 'next/server';
import { contratoIdDeSesion, deps, leerJson, ok, responder } from '@/server/http';
import { guardarMiContrato, leerMiContrato } from '@/server/miContrato';

// GET /api/mi-contrato -> { ok, datos: { direccion, telefono, ciudad, correo, cargo, linea, numeroContrato, objeto,
//   inicio, fin, honorario, valorTotal, riesgo, revisoNombre, revisoCargo, valorTotalEsperado } }
export async function GET(req: NextRequest) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    const contratoId = contratoIdDeSesion(req);
    return ok({ datos: await leerMiContrato(deps(), contratoId) });
  });
}

// PUT /api/mi-contrato { direccion?, telefono?, ciudad?, correo?, cargo?, linea?, numeroContrato?, objeto?, inicio?,
//   fin?, honorario?, valorTotal?, riesgo?, revisoNombre?, revisoCargo? } -> { ok, datos, contrato: Resumen, aviso? }
// Cualquier otra clave se ignora. `aviso` (no bloquea): el valor total no coincide con el que da el honorario.
// Errores: { ok:false, error, campos:{ campo: mensaje } }.
export async function PUT(req: NextRequest) {
  return responder(async () => {
    const contratoId = contratoIdDeSesion(req);
    const { datos, contrato, aviso } = await guardarMiContrato(deps(), contratoId, await leerJson(req));
    return ok({ datos, contrato, aviso });
  });
}
