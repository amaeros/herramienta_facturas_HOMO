// Pruebas del PDF de la cuenta de cobro. TODOS los datos son inventados.
// El PDF se lee de vuelta con pdf.js (el mismo que usa Firefox) para comprobar página, tamaño y texto.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatosFactura } from '../factura';
import { formatoNumero, generarFacturaPdf, nombreArchivoFacturaPdf } from '../facturaPdf';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjs: any;

const LARGO = 'Prestación de servicios como Profesional sin experiencia, en el marco de la ejecución del contrato '
  + 'interadministrativo N° 4600018487 de 2025, suscrito con la Secretaría de las Mujeres del Departamento de Antioquia, '
  + 'cuyo objeto es: “FORTALECER ACCIONES DE LA POLÍTICA PÚBLICA DE LAS MUJERES DESDE UN ENFOQUE SICOSOCIAL PARA LA '
  + 'GARANTÍA DE SUS DERECHOS HUMANOS, EL FORTALECIMIENTO DE SU AUTONOMÍA ECONÓMICA Y EL DERECHO A VIVIR UNA VIDA LIBRE '
  + 'DE VIOLENCIAS.”';

const base: DatosFactura = {
  nombre: 'PRUEBA PÉREZ DE LA TORRE',
  cedula: '1000000001',
  direccion: 'Calle 1 # 2-3 Apto 4',
  telefono: '3000000000',
  ciudad: 'Medellín',
  cargo: 'Profesional Universitaria',
  numeroContrato: '2026CPSP999',
  objeto: 'Prestar servicios profesionales de prueba para el observatorio ficticio.',
  valorTotalContrato: 55704000,
  revisoNombre: 'Revisora de Prueba',
  revisoCargo: 'Apoyo Técnico',
  docNum: '202609',
  fechaInicio: '2026-09-01',
  fechaCorte: '2026-09-30',
  valorPeriodo: 5064000,
  acumulado: 50640000, // 50.640.000 / 55.704.000 = 90,91 %
  ssDeclarada: 626700,
  planillaNumero: '1234567890',
  planillaMes: '2026-09',
  adicionales: [],
};

const tres = [
  { numero: '1111111111', mes: '2026-08', valor: 15000 },
  { numero: '2222222222', mes: '2026-07', valor: 22000 },
  { numero: '3333333333', mes: '2026-06', valor: 9000 },
];

type Item = { str: string; x: number; y: number; w: number };
type Leido = { paginas: number; vista: number[]; items: Item[]; texto: string };

async function leer(buf: Buffer): Promise<Leido> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  const pagina = await doc.getPage(1);
  const contenido = await pagina.getTextContent();
  const items: Item[] = contenido.items
    .filter((i: { str?: string }) => typeof i.str === 'string' && i.str.trim() !== '')
    .map((i: { str: string; transform: number[]; width: number }) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
  return {
    paginas: doc.numPages,
    vista: pagina.view,
    items,
    texto: items.map((i) => i.str).join(' '),
  };
}

const palabras = (s: string) => s.split(/\s+/).filter(Boolean);

const carpetaMuestras = path.join(process.cwd(), 'privado', 'muestras');
let pdf0: Buffer;
let pdf3: Buffer;
let pdfLargo: Buffer;
let l0: Leido;
let l3: Leido;
let lLargo: Leido;

beforeAll(async () => {
  pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  pdf0 = await generarFacturaPdf(base);
  pdf3 = await generarFacturaPdf({ ...base, adicionales: tres, valorPeriodo: 2532000, ssDeclarada: 313350, fechaInicio: '2026-09-16' });
  pdfLargo = await generarFacturaPdf({ ...base, objeto: LARGO });
  [l0, l3, lLargo] = await Promise.all([leer(pdf0), leer(pdf3), leer(pdfLargo)]);
  // muestras para mirarlas a ojo (privado/ no va a git): node scripts/pdf-a-png.mjs <pdf> <png>
  fs.mkdirSync(carpetaMuestras, { recursive: true });
  fs.writeFileSync(path.join(carpetaMuestras, 'factura_pdf_sin_adicionales.pdf'), pdf0);
  fs.writeFileSync(path.join(carpetaMuestras, 'factura_pdf_3_adicionales.pdf'), pdf3);
  fs.writeFileSync(path.join(carpetaMuestras, 'factura_pdf_objeto_largo.pdf'), pdfLargo);
});

describe('generarFacturaPdf', () => {
  it('es un PDF válido de una sola página carta vertical', () => {
    for (const [buf, l] of [[pdf0, l0], [pdf3, l3], [pdfLargo, lLargo]] as const) {
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(buf.subarray(-1024).toString('latin1')).toContain('%%EOF');
      expect(l.paginas).toBe(1);
      expect(l.vista).toEqual([0, 0, 612, 792]); // carta, en puntos
    }
  });

  it('trae los textos clave tal como están en el formato', () => {
    const t = l0.texto;
    expect(t).toContain('PRUEBA PÉREZ DE LA TORRE');
    expect(t).toContain('1.000.000.001');
    expect(t).toContain('DOCUMENTO EQUIVALENTE A LA FACTURA');
    expect(t).toContain('202609');
    expect(t).toContain('2026CPSP999');
    expect(t).toContain('01 de septiembre de 2026');
    expect(t).toContain('30 de septiembre de 2026');
    expect(t).toContain('5.064.000');
    expect(t).toContain('50.640.000');
    expect(t).toContain('55.704.000');
    expect(t).toContain('90,91%');
    expect(t).toContain('$ 626.700');
    expect(t).toContain('1234567890');
    expect(t).toContain('Septiembre');
    expect(t).toContain('GJ-CO-FR-15');
    expect(t).toContain('890.905.166-8');
    expect(t).toContain('observatorio ficticio');
    expect(t).toContain('Prueba Pérez de la Torre'); // quien proyectó
    expect(t).toContain('Revisora de Prueba');
  });

  it('con 3 planillas adicionales sigue en una página y las trae todas', () => {
    expect(l3.paginas).toBe(1);
    const t = l3.texto;
    for (const p of tres) expect(t).toContain(p.numero);
    expect(t).toContain('$ 15.000');
    expect(t).toContain('$ 22.000');
    expect(t).toContain('$ 9.000');
    expect(t).toContain('Agosto');
    expect(t).toContain('Julio');
    expect(t).toContain('Junio');
    expect(t).toContain('16 de septiembre de 2026');
    expect(t).toContain('GJ-CO-FR-15'); // el pie también se movió hacia abajo
    expect(t).toContain('Revisora de Prueba');
  });

  it('un objeto largo (~466 caracteres) sale completo, sin cortar palabras', () => {
    expect(LARGO.length).toBeGreaterThan(440);
    const salida = new Set(palabras(lLargo.texto));
    for (const p of palabras(LARGO)) expect(salida.has(p), `falta la palabra «${p}»`).toBe(true);
    expect(lLargo.texto).toContain('VIOLENCIAS.”');
    expect(lLargo.paginas).toBe(1);
  });

  it('un objeto larguísimo (1.500 caracteres, con saltos de línea) crece la fila y sigue completo en una página', async () => {
    const enorme = (LARGO + '\n').repeat(3).trim();
    const buf = await generarFacturaPdf({ ...base, objeto: enorme });
    const l = await leer(buf);
    expect(l.paginas).toBe(1);
    const salida = new Set(palabras(l.texto));
    for (const p of palabras(enorme)) expect(salida.has(p), `falta la palabra «${p}»`).toBe(true);
  });

  it('nada del texto queda fuera de la hoja (márgenes de ~0,4 pulgadas)', () => {
    for (const l of [l0, l3, lLargo]) {
      for (const i of l.items) {
        expect(i.x).toBeGreaterThanOrEqual(25);
        expect(i.x + i.w).toBeLessThanOrEqual(612 - 25);
        expect(i.y).toBeGreaterThanOrEqual(25);
        expect(i.y).toBeLessThanOrEqual(792 - 25);
      }
    }
  });

  it('el pie y el encabezado conservan su orden vertical', () => {
    const y = (l: Leido, s: string) => l.items.find((i) => i.str.includes(s))!.y;
    expect(y(l0, 'DOCUMENTO EQUIVALENTE A LA FACTURA')).toBeGreaterThan(y(l0, 'NOMBRE COMPLETO'));
    expect(y(l0, 'NOMBRE COMPLETO')).toBeGreaterThan(y(l0, 'OBJETO DEL CONTRATO'));
    expect(y(l0, 'OBJETO DEL CONTRATO')).toBeGreaterThan(y(l0, 'FIRMA CONTRATISTA'));
    expect(y(l0, 'FIRMA CONTRATISTA')).toBeGreaterThan(y(l0, 'GJ-CO-FR-15'));
  });

  it('el nombre del archivo es el del Excel, con .pdf', () => {
    expect(nombreArchivoFacturaPdf('202609', 'PRUEBA PÉREZ')).toBe('202609 - PRUEBA PÉREZ - Cuenta de cobro.pdf');
  });
});

describe('formatoNumero (como lo muestra Excel en español)', () => {
  it('formatos de la hoja', () => {
    expect(formatoNumero(7174000, '#,##0')).toBe('7.174.000');
    expect(formatoNumero(626700, '"$ "#,##0')).toBe('$ 626.700');
    expect(formatoNumero(50640000 / 55704000, '0.00%')).toBe('90,91%');
    expect(formatoNumero(1, '0.00%')).toBe('100,00%');
    expect(formatoNumero(202609, '0')).toBe('202609');
    expect(formatoNumero(42, '0000')).toBe('0042');
    expect(formatoNumero(3000000000)).toBe('3000000000');
    expect(formatoNumero(0.5)).toBe('0,5');
    expect(formatoNumero(0, '#,##0')).toBe('0');
  });
});
