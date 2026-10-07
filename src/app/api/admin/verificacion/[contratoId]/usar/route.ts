import type { NextRequest } from 'next/server';
import { usarDelDocumento } from '@/server/documentos';
import { deps, exigirAdmin, idDeRuta, leerJson, ok, responder } from '@/server/http';

// POST /api/admin/verificacion/<contratoId>/usar { campo } -> { ok, contrato }
// Copia al contrato lo que dice el documento (el servidor lo saca de nuevo: no se manda el valor). Es la misma edición del
// panel: validaciones, bitácora y recálculo de acumulados. Errores de validación: { ok:false, error, campos }.
export async function POST(req: NextRequest, ctx: { params: Promise<{ contratoId: string }> }) {
  return responder(async () => {
    exigirAdmin(req);
    const contratoId = idDeRuta((await ctx.params).contratoId, 'No encontramos a esa trabajadora.');
    const cuerpo = await leerJson(req);
    return ok({ contrato: await usarDelDocumento(deps(), contratoId, cuerpo.campo) });
  });
}
