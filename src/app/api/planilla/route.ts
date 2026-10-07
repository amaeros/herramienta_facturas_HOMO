import type { NextRequest } from 'next/server';
import { MAX_BYTES } from '@/server/archivos';
import { jsonSeguro } from '@/server/entrada';
import { ErrorAmable } from '@/server/errores';
import { contratoIdDeSesion, deps, ok, responder } from '@/server/http';
import { leerPlanilla } from '@/server/servicios';

// POST /api/planilla (multipart: archivo, texto, mes, fechaInicio, fechaCorte, adicionales, diasManual, adicional)
//   -> { ok, tempId, leyo, confianza, tipoDoc, fuente, notas, lectura, evaluacion, valor }
// Máximo 4 MB (el cuerpo de una función de Vercel admite ~4,5 MB). PDF, JPG o PNG (se revisan los primeros bytes).
const MSG_GRANDE = 'El archivo pesa más de 4 MB. Sube un PDF más liviano o una foto más pequeña.';

function campo(f: FormData, nombre: string): string {
  const v = f.get(nombre);
  return typeof v === 'string' ? v : '';
}

export async function POST(req: NextRequest) {
  return responder(async () => {
    const contratoId = contratoIdDeSesion(req);
    // Se corta antes de leer el cuerpo si ya dice que es demasiado grande (con margen para los demás campos).
    const largo = Number(req.headers.get('content-length') ?? 0);
    if (largo > MAX_BYTES + 400_000) throw new ErrorAmable(MSG_GRANDE, 413);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ErrorAmable('No pudimos abrir el archivo. Vuelve a elegirlo.');
    }
    const archivo = form.get('archivo');
    if (!archivo || typeof archivo === 'string') throw new ErrorAmable('No recibimos el archivo. Vuelve a elegirlo.');
    if (archivo.size > MAX_BYTES) throw new ErrorAmable(MSG_GRANDE, 413);
    const bytes = new Uint8Array(await archivo.arrayBuffer());

    const r = await leerPlanilla(deps(), contratoId, {
      archivo: { bytes, nombre: archivo.name || 'planilla' },
      texto: campo(form, 'texto'),
      mes: campo(form, 'mes'),
      fechaInicio: campo(form, 'fechaInicio'),
      fechaCorte: campo(form, 'fechaCorte'),
      adicionales: jsonSeguro(campo(form, 'adicionales')),
      diasManual: jsonSeguro(campo(form, 'diasManual')),
      adicional: campo(form, 'adicional') === '1',
    });
    return ok({ ...r });
  });
}