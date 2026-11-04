/** PDF con contraseña: se prueba sin clave y luego con las claves (la cédula). pdf.js simulado. */
import { describe, it, expect } from 'vitest';
import { extraerTextoPdfConClave } from '../pdfText';

function pdfjsFalso(clave: string | null) {
  const intentos: Array<string | undefined> = [];
  const lib = {
    intentos,
    getDocument(o: { password?: string }) {
      intentos.push(o.password);
      if (clave !== null && o.password !== clave) {
        const e = new Error(o.password ? 'Incorrect Password' : 'No password given');
        e.name = 'PasswordException';
        return { promise: Promise.reject(e) };
      }
      const pagina = { getTextContent: () => Promise.resolve({ items: [{ str: 'PLANILLA 123', transform: [0, 0, 0, 8, 0, 10] }] }), cleanup() {} };
      return { promise: Promise.resolve({ numPages: 1, getPage: () => Promise.resolve(pagina), destroy() {} }) };
    },
  };
  return lib;
}
const ab = new ArrayBuffer(8);

describe('extraerTextoPdfConClave', () => {
  it('PDF sin clave: lo lee al primer intento', async () => {
    const lib = pdfjsFalso(null);
    expect(await extraerTextoPdfConClave(lib, ab, ['1000000001'])).toEqual({ texto: 'PLANILLA 123', protegido: false });
    expect(lib.intentos).toEqual([undefined]);
  });
  it('PDF con la cédula como clave: lo abre con la cédula', async () => {
    const lib = pdfjsFalso('1000000001');
    expect(await extraerTextoPdfConClave(lib, ab, ['1000000001'])).toEqual({ texto: 'PLANILLA 123', protegido: false });
    expect(lib.intentos).toEqual([undefined, '1000000001']);
  });
  it('PDF con otra clave: queda protegido y sin texto', async () => {
    const lib = pdfjsFalso('otra');
    expect(await extraerTextoPdfConClave(lib, ab, ['1000000001', ''])).toEqual({ texto: '', protegido: true });
    expect(lib.intentos).toEqual([undefined, '1000000001']);
  });
});
