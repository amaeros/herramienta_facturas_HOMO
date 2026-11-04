/**
 * Lector de planillas: formato Asopagos ("Resumen planilla pagada").
 * Texto armado a mano con la estructura de una planilla real (datos ficticios). El error que corrige:
 * la lectura genérica tomaba los IBC (tabla "TOTALES IBC") como si fueran los aportes.
 */
import { describe, it, expect } from 'vitest';
import { parsePlanillaText } from '../parser';

const FILAS = [
  'RESUMEN PLANILLA PAGADA',
  'DATOS GENERALES DEL APORTANTE',
  'IDENTIFICACIÓN DV RAZÓN SOCIAL CLASE CÓDIGO ARL F. PRESENTACIÓN ACT. ECO TIPO DE EMPRESA',
  'CC 1000000001 0 PRUEBA PRUEBA ANA I 0 ARL SURA - 14-11 ÚNICA 8412 Natural',
  'MUN-DEP DIRECCIÓN TELÉFONO EMAIL EXENTO DE PARAFISCALES',
  '5-1 CALLE 1 1 1 5000000 PRUEBA@EJEMPLO.COM N',
  'DATOS GENERALES DE LA LIQUIDACIÓN',
  'PERÍODO PENSIÓN PERÍODO SALUD PLANILLA TIPO PLANILLA FECHA PAGO CENTRO DE TRABAJO DEPARTAMENTO MUNICIPIO VALOR PAGO INTERÉS X MORA ENTIDAD RECAUDO',
  '2026-10 2026-10 38783023 I 2026-10-15 TODOS LOS CENTROS TODOS TODOS 991.200 0 BANCOLOMBIA',
  'Nº AFILIADOS REF. DE PAGO (PIN) FECHA LÍMITE PAGO ESTADO PLANILLA',
  '1 38783023 2026-11-11 Pagada',
  'TOTALES IBC',
  'IBC PENSIÓN IBC SALUD IBC RIESGOS IBC CAJAS IBC PARAF',
  '3.414.569 3.414.569 3.414.569 0 0',
  'SUBSISTEMA CÓDIGO NIT DV AFILIADOS VALOR LIQUIDADO VALOR UPC INTERESES MORA SALDOS E INCAPACIDADES DESCONTADOS VALOR A PAGAR',
  'AFP(Administradoras: 1) 1 546.400 0 0 0 546.400',
  'PORVENIR 230301 800224808 8 1 546.400 0 0 0 546.400',
  'EPS(Administradoras: 1) 1 426.900 0 0 0 426.900',
  'EPS SURA EPS010 800088702 2 1 426.900 0 0 0 426.900',
  'ARP(Administradoras: 1) 1 17.900 0 0 0 17.900',
  'ARL SURA 14-11 890903790 5 1 17.900 0 0 0 17.900',
  'Gran Total 991.200 0 0 0 991.200',
  'Página 1 2026-10-19',
];

describe('parser: Asopagos (resumen planilla pagada)', () => {
  it('lee los aportes, no los IBC', () => {
    const r = parsePlanillaText(FILAS.join('\n'));
    expect(r.tipo).toBe('planilla');
    expect([r.numero, r.periodo]).toEqual(['38783023', '2026-10']);
    expect([r.salud, r.pension, r.arl, r.ccf]).toEqual([426900, 546400, 17900, 0]);
    expect([r.mora, r.total, r.ibc]).toEqual([0, 991200, 3414569]);
    expect(r.tarifaArl).toBe(0.00522);
    expect(r.confianza).toBe('alta');
    expect(r.notas.join(' | ')).toMatch(/Asopagos/);
  });

  it('también con todo en una sola línea (otro orden de pdf.js)', () => {
    const r = parsePlanillaText(FILAS.join(' '));
    expect([r.salud, r.pension, r.arl, r.total]).toEqual([426900, 546400, 17900, 991200]);
  });

  it('con mora: la mora no se suma a los aportes', () => {
    const t = FILAS.join('\n')
      .replace('ARP(Administradoras: 1) 1 17.900 0 0 0 17.900', 'ARP(Administradoras: 1) 1 17.900 0 1.200 0 19.100')
      .replace('Gran Total 991.200 0 0 0 991.200', 'Gran Total 991.200 0 1.200 0 992.400');
    const r = parsePlanillaText(t);
    expect([r.arl, r.mora, r.total]).toEqual([17900, 1200, 992400]);
  });
});

// Texto REAL de pdf.js para una planilla Asopagos (anonimizado): las celdas salen desordenadas, no por filas.
import fs from 'node:fs';
import path from 'node:path';
const DESORDENADO = fs.readFileSync(path.join(__dirname, 'fixtures', 'asopagos-desordenado.txt'), 'utf8');

describe('parser: Asopagos con el texto desordenado de pdf.js (caso real oct. 2026)', () => {
  it('lee salud, pensión y ARL por aritmética, sin depender del orden', () => {
    const r = parsePlanillaText(DESORDENADO);
    expect([r.numero, r.periodo]).toEqual(['38783023', '2026-10']);
    expect([r.salud, r.pension, r.arl, r.ccf, r.mora, r.total, r.ibc]).toEqual([426900, 546400, 17900, 0, 0, 991200, 3414569]);
    expect(r.tarifaArl).toBe(0.00522);
    expect(r.confianza).toBe('alta');
  });
});

// Texto REAL de pdf.js (anonimizado) de una planilla detallada de Enlace Operativo / SuAporte, "Reporte individual".
// El PDF venía con contraseña (la cédula); también sale desordenado.
const REPORTE_INDIVIDUAL = fs.readFileSync(path.join(__dirname, 'fixtures', 'enlace-reporte-individual.txt'), 'utf8');

describe('parser: Enlace Operativo "Reporte individual" (caso real oct. 2026)', () => {
  it('lee n.º, periodo y aportes (IBC al piso de 1 SMMLV, riesgo III)', () => {
    const r = parsePlanillaText(REPORTE_INDIVIDUAL);
    expect([r.numero, r.periodo]).toEqual(['88775145', '2026-10']);
    expect([r.salud, r.pension, r.arl, r.ccf, r.mora, r.total, r.ibc]).toEqual([218900, 280200, 42700, 0, 0, 541800, 1750905]);
    expect(r.tarifaArl).toBe(0.02436);
    expect(r.confianza).toBe('alta');
    expect(r.notas.join(' | ')).toMatch(/reporte individual/);
  });
});
