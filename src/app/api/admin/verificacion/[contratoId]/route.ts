import { connection, type NextRequest } from 'next/server';
import { verificar } from '@/server/documentos';
import { deps, exigirAdmin, idDeRuta, ok, responder } from '@/server/http';

// GET /api/admin/verificacion/<contratoId>
//   -> { ok, verificacion: { contratoId, verificadaEn, documentos, filas: [{ campo, etiqueta, actual, documento, fuente, estado }] } }
// estado: 'coincide' | 'distinto' | 'sin_dato'. Lleva valores completos (cédula, teléfono...): solo para el supervisor, nunca a logs.
export async function GET(req: NextRequest, ctx: { params: Promise<{ contratoId: string }> }) {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => {
    exigirAdmin(req);
    const contratoId = idDeRuta((await ctx.params).contratoId, 'No encontramos a esa trabajadora.');
    return ok({ verificacion: await verificar(deps(), contratoId) });
  });
}
