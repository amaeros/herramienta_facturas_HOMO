import { connection, type NextRequest } from 'next/server';
import { deps, exigirAdmin, ok, responder } from '@/server/http';
import { listarSolicitudes } from '@/server/solicitudes';

// GET /api/admin/solicitudes -> { ok, solicitudes: [{ ...campos sin cedula, cedulaFinal4: '…1234', solicitada }] }
// Solo las pendientes, de la más antigua a la más nueva. La cédula completa solo sale en el detalle.
export async function GET(req: NextRequest) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    return ok({ solicitudes: await listarSolicitudes(deps()) });
  });
}
