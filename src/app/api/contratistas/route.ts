import { connection } from 'next/server';
import { deps, ok, responder } from '@/server/http';
import { listarContratistas } from '@/server/servicios';

// GET /api/contratistas -> { ok, nombres }  (solo nombres de contratistas activas)
export async function GET() {
  await connection(); // siempre en tiempo de petición, nunca prerenderizada ni cacheada
  return responder(async () => ok({ nombres: await listarContratistas(deps()) }));
}