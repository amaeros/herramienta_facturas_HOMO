// El cargo no puede ser el nombre de la persona (el autocompletar del celular lo mete ahí). Datos inventados.
import { describe, expect, it } from 'vitest';
import { cargoEsElNombre } from '../entrada';

describe('cargoEsElNombre', () => {
  const nombre = 'PRUEBA PÉREZ DE LA TORRE';
  it('detecta el nombre completo o una parte de dos o más palabras, sin importar tildes ni mayúsculas', () => {
    expect(cargoEsElNombre('PRUEBA PÉREZ', nombre)).toBe(true);
    expect(cargoEsElNombre('prueba perez de la torre', nombre)).toBe(true);
    expect(cargoEsElNombre('  Prueba   Perez ', nombre)).toBe(true);
  });
  it('deja pasar cargos de verdad', () => {
    expect(cargoEsElNombre('Apoyo técnico', nombre)).toBe(false);
    expect(cargoEsElNombre('Profesional universitaria', nombre)).toBe(false);
    expect(cargoEsElNombre('Apoyo técnico/administrativo', nombre)).toBe(false);
  });
  it('una sola palabra no basta para decidir (puede coincidir por casualidad)', () => {
    expect(cargoEsElNombre('Torre', nombre)).toBe(false);
    expect(cargoEsElNombre('', nombre)).toBe(false);
  });
});
