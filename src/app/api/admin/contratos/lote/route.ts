import type { NextRequest } from 'next/server';
import { actualizarLote } from '@/server/admin';
import { deps, exigirAdmin, leerJson, ok, responder } from '@/server/http';

// POST /api/admin/contratos/lote { ids: number[], fin?: 'AAAA-MM-DD', inicio?: 'AAAA-MM-DD' }
//   -> { ok, resultados: [{ id, nombre, ok, error? }], aplicadas, fallidas }
// Aplica a cada trabajadora la misma edición del panel (validaciones, bitácora y recálculo). Una que falle no frena a las demás.
export async function POST(req: NextRequest) {
  return responder(async () => {
    exigirAdmin(req);
    return ok(await actualizarLote(deps(), await leerJson(req)));
  });
}
