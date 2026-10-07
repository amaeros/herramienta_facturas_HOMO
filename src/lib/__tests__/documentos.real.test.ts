/* eslint-disable */
/**
 * Prueba del lector de documentos contra los 3 PDF REALES del contrato (fuera del repo, carpeta privado/).
 *
 * Se ejecuta solo si existe DOCS_DIR (carpeta con contrato.pdf, acta_prorroga.pdf y poliza.pdf):
 *   PowerShell:  $env:DOCS_DIR="C:\Users\EQUIPO\proyectos\cuentas-homo\privado\documentos"; npx vitest run src/lib/__tests__/documentos.real.test.ts
 * Sin DOCS_DIR se omite. NUNCA copiar los PDF al repo ni imprimir cedulas, nombres, direcciones o telefonos:
 * aqui solo se comparan los documentos entre si y se verifican formatos.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { leerDocumento, type DocumentoLeido } from '../documentos';
import { extraerTextoPdf } from '../pdfText';

const DIR = process.env.DOCS_DIR || '';
const require = createRequire(import.meta.url);

let pdfjsLib: any = null;
function getPdfjs() {
  if (!pdfjsLib) pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  return pdfjsLib;
}

async function leer(nombre: string): Promise<DocumentoLeido> {
  const buf = fs.readFileSync(path.join(DIR, nombre));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const texto = await extraerTextoPdf(getPdfjs(), ab);
  return leerDocumento(texto);
}

describe.skipIf(!DIR || !fs.existsSync(DIR))('documentos reales (DOCS_DIR)', () => {
  let contrato: DocumentoLeido, acta: DocumentoLeido, poliza: DocumentoLeido;

  beforeAll(async () => {
    contrato = await leer('contrato.pdf');
    acta = await leer('acta_prorroga.pdf');
    poliza = await leer('poliza.pdf');
  }, 60_000);

  it('contrato: tipo y campos clave', () => {
    expect(contrato.tipo).toBe('contrato');
    const c = contrato.campos;
    expect(c.numeroContrato).toMatch(/^20\d\dCPSP?\d{3,4}$/);
    expect(c.nombre).toBeTruthy();
    expect(c.cedula).toMatch(/^\d{6,10}$/);
    expect(c.objeto).toBeTruthy();
    expect(c.objeto).not.toMatch(/\s{2,}/);
    expect(c.honorario).toBe(4009000);
    expect(c.valorTotal).toBe(36081000);
    expect(c.fin).toBe('2026-09-30');
    expect(c.inicio).toBeUndefined();
  });

  it('acta de prorroga: tipo y campos clave', () => {
    expect(acta.tipo).toBe('acta_prorroga');
    const c = acta.campos;
    expect(c.numeroContrato).toMatch(/^20\d\dCPSP?\d{3,4}$/);
    expect(c.nombre).toBeTruthy();
    expect(c.cedula).toMatch(/^\d{6,10}$/);
    expect(c.objeto).toBeTruthy();
    expect(c.inicio).toBe('2026-01-01');
    expect(c.fin).toBe('2026-11-30');
    expect(c.valorTotal).toBe(44099000);
    expect(c.honorario).toBe(4009000);
  });

  it('poliza: tipo y campos clave (sin fin)', () => {
    expect(poliza.tipo).toBe('poliza');
    const c = poliza.campos;
    expect(c.nombre).toBeTruthy();
    expect(c.cedula).toMatch(/^\d{6,10}$/);
    expect(c.inicio).toBe('2026-01-01');
    expect(c.fin).toBeUndefined();
    expect(c.direccion).toBeTruthy();
    expect(c.ciudad).toBeTruthy();
    expect(c.telefono).toMatch(/^\d{7,10}$/);
    expect(poliza.notas.join(' ')).toMatch(/no indica la fecha de fin/i);
  });

  it('los 3 documentos coinciden entre si (cedula, numero de contrato, inicio, honorario)', () => {
    expect(acta.campos.cedula).toBe(contrato.campos.cedula);
    expect(poliza.campos.cedula).toBe(contrato.campos.cedula);
    expect(acta.campos.numeroContrato).toBe(contrato.campos.numeroContrato);
    expect(poliza.campos.inicio).toBe(acta.campos.inicio);
    expect(acta.campos.honorario).toBe(contrato.campos.honorario);
    // el acta suma la adicion al valor inicial del contrato
    expect(acta.campos.valorTotal!).toBeGreaterThan(contrato.campos.valorTotal!);
  });

  it('el nombre es el mismo en los 3 documentos (sin importar mayusculas ni el orden de apellidos/nombres)', () => {
    const palabras = (s?: string) => (s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean).sort().join(' ');
    expect(palabras(acta.campos.nombre)).toBe(palabras(contrato.campos.nombre));
    expect(palabras(poliza.campos.nombre)).toBe(palabras(contrato.campos.nombre));
  });
});
