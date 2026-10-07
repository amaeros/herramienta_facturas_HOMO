import type { NextRequest } from 'next/server';
import { importarExcel } from '@/server/admin';
import { ErrorAmable } from '@/server/errores';
import { deps, exigirAdmin, ok, responder } from '@/server/http';
import { MAX_BYTES_IMPORTAR } from '@/server/importar';

// POST /api/admin/importar (multipart: archivo .xlsx, aplicar '0'|'1')
//   -> { ok, aplicado, crear:[{nombre, cedulaFinal4}], actualizar:[{id, nombre, cambios}], sinCambios, errores:[{fila, mensaje}] }
// '0' = vista previa (no guarda nada). Máx. 1 MB y 200 filas. El archivo no se guarda.
const MSG_GRANDE = 'El archivo pesa más de 1 MB. Sube solo la hoja de control.';

export async function POST(req: NextRequest) {
  return responder(async () => {
    exigirAdmin(req);
    const largo = Number(req.headers.get('content-length') ?? 0);
    if (largo > MAX_BYTES_IMPORTAR + 100_000) throw new ErrorAmable(MSG_GRANDE, 413);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ErrorAmable('No pudimos abrir el archivo. Vuelve a elegirlo.');
    }
    const archivo = form.get('archivo');
    if (!archivo || typeof archivo === 'string') throw new ErrorAmable('No recibimos el archivo. Vuelve a elegirlo.');
    if (archivo.size > MAX_BYTES_IMPORTAR) throw new ErrorAmable(MSG_GRANDE, 413);
    const aplicar = form.get('aplicar') === '1';
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const r = await importarExcel(deps(), bytes, aplicar);
    return ok({ aplicado: aplicar, ...r });
  });
}
