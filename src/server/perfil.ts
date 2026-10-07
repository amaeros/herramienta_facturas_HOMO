// "Perfil completo" de la contratista: los datos que salen en su cuenta de cobro y que ella misma llena la primera vez
// (pantalla "Antes de empezar, completa tus datos"). El correo es opcional y no cuenta. Ver docs/ARQUITECTURA.md.

import type { ContratoFila } from './db/schema';

/** Campo del contrato y cómo se llama cuando falta (lo que ve la contratista en `faltan`). */
export const CAMPOS_PERFIL: ReadonlyArray<{ campo: keyof ContratoFila; etiqueta: string }> = [
  { campo: 'direccion', etiqueta: 'Dirección' },
  { campo: 'telefono', etiqueta: 'Teléfono' },
  { campo: 'ciudad', etiqueta: 'Ciudad' },
  { campo: 'cargo', etiqueta: 'Cargo' },
  { campo: 'objeto', etiqueta: 'Objeto del contrato' },
  { campo: 'inicio', etiqueta: 'Fecha de inicio' },
  { campo: 'fin', etiqueta: 'Fecha de fin' },
  { campo: 'valorTotal', etiqueta: 'Valor total del contrato' },
  { campo: 'revisoNombre', etiqueta: 'Nombre de quien revisa tu cuenta' },
  { campo: 'revisoCargo', etiqueta: 'Cargo de quien revisa tu cuenta' },
];

function lleno(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return v > 0;
  return String(v).trim() !== '';
}

/** Etiquetas de lo que todavía falta; vacío = perfil completo. */
export function faltanDelPerfil(c: ContratoFila): string[] {
  return CAMPOS_PERFIL.filter(({ campo }) => !lleno(c[campo])).map(({ etiqueta }) => etiqueta);
}
