// Valores por defecto de `parametros` (los de PARAMETROS en legacy/apps-script/CONTRATO_DATOS.md).
// La migración SQL ya inserta esta fila; asegurarParametros() la repone si alguien la borró.

import type { Db } from './index';
import { parametros } from './schema';

export const PARAMETROS_POR_DEFECTO = {
  id: 1,
  pctIbc: 0.4,
  salud: 0.125,
  pension: 0.16,
  smmlv: 1750905,
  ibcPisoMult: 1,
  ibcTechoMult: 25,
  arl: { I: 0.00522, II: 0.01044, III: 0.02436, IV: 0.0435, V: 0.0696 },
  enviarCorreo: false,
  correoSupervisor: '',
  toleranciaSs: 100,
} as const;

export async function asegurarParametros(db: Db): Promise<void> {
  await db
    .insert(parametros)
    .values({ ...PARAMETROS_POR_DEFECTO, arl: { ...PARAMETROS_POR_DEFECTO.arl } })
    .onConflictDoNothing({ target: parametros.id });
}
