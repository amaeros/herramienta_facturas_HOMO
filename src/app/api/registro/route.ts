import type { NextRequest } from 'next/server';
import { deps, leerJson, ok, responder } from '@/server/http';
import { ipDeSolicitud, registrarSolicitud } from '@/server/registro';

// POST /api/registro {nombre, cedula, direccion, telefono, ciudad, correo?, linea, numeroContrato, cargo, objeto, inicio, fin,
//   honorario, valorTotal, riesgo, revisoNombre, revisoCargo, sitio_web: ''} -> { ok }  (público)
// Crea una solicitud pendiente que el supervisor aprueba. `sitio_web` es un campo trampa y debe venir vacío.
// Errores de validación: { ok:false, error, campos:{ campo: mensaje } }. Límite: 5 solicitudes por hora por IP.
export async function POST(req: NextRequest) {
  return responder(async () => {
    const cuerpo = await leerJson(req);
    const ip = ipDeSolicitud(req.headers.get('x-forwarded-for'));
    await registrarSolicitud(deps(), cuerpo, ip); // con la trampa llena no guarda nada, pero responde igual de bien
    return ok({}, { status: 201 });
  });
}
