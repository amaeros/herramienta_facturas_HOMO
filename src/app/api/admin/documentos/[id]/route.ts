import type { NextRequest } from 'next/server';
import { borrarDocumento } from '@/server/documentos';
import { deps, exigirAdmin, idDeRuta, ok, responder } from '@/server/http';

// DELETE /api/admin/documentos/<id> -> { ok }  (borra la fila y el PDF de Blob)
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    exigirAdmin(req);
    const id = idDeRuta((await ctx.params).id, 'No encontramos ese documento.');
    await borrarDocumento(deps(), id);
    return ok();
  });
}
