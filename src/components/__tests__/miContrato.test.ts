import { describe, expect, it } from "vitest";
import {
  cambiosDeMiContrato, erroresDeMiContrato, formCompleto, formatearValorTotal, formDeDatos, MI_CONTRATO_VACIO,
  primerCampoConError, validarMiContrato, type FormMiContrato,
} from "../miContrato";
import type { DatosMiContrato } from "../tipos";

const datos: DatosMiContrato = {
  direccion: "Calle 1 # 2-3",
  telefono: "300 000 0000",
  ciudad: "Medellín",
  correo: "",
  cargo: "Profesional de prueba",
  objeto: "Objeto ficticio de prueba.",
  inicio: "2026-01-01",
  fin: "2026-09-30",
  valorTotal: 36081000,
  revisoNombre: "Supervisor Prueba",
  revisoCargo: "Apoyo técnico",
  valorTotalEsperado: 36081000,
};
const original: FormMiContrato = formDeDatos(datos);

describe("formDeDatos", () => {
  it("el valor total sale con puntos de miles y lo vacío queda vacío", () => {
    expect(original.valorTotal).toBe("36.081.000");
    expect(formDeDatos({ ...datos, valorTotal: null }).valorTotal).toBe("");
    expect(formDeDatos({ ...datos, valorTotal: null, inicio: "", fin: "" })).toMatchObject({ inicio: "", fin: "", valorTotal: "" });
  });

  it("no lleva el valor esperado: eso no se edita", () => {
    expect(original).not.toHaveProperty("valorTotalEsperado");
  });
});

describe("cambiosDeMiContrato", () => {
  it("sin cambios no devuelve nada", () => {
    expect(cambiosDeMiContrato(original, { ...original })).toEqual({});
  });

  it("solo devuelve lo que cambió", () => {
    expect(cambiosDeMiContrato(original, { ...original, fin: "2026-11-30" })).toEqual({ fin: "2026-11-30" });
    expect(cambiosDeMiContrato(original, { ...original, fin: "2026-11-30", revisoCargo: "Coordinación" })).toEqual({
      fin: "2026-11-30",
      revisoCargo: "Coordinación",
    });
  });

  it("ignora espacios de más y manda el texto limpio", () => {
    expect(cambiosDeMiContrato(original, { ...original, revisoNombre: "  Supervisor Prueba " })).toEqual({});
    expect(cambiosDeMiContrato(original, { ...original, revisoNombre: "  Otra Persona " })).toEqual({ revisoNombre: "Otra Persona" });
  });

  it("vaciar un campo cuenta como cambio", () => {
    expect(cambiosDeMiContrato(original, { ...original, revisoCargo: "" })).toEqual({ revisoCargo: "" });
    expect(cambiosDeMiContrato(original, { ...original, fin: "" })).toEqual({ fin: "" });
  });

  it("el valor total se compara como número: otra forma de escribirlo no es un cambio", () => {
    expect(cambiosDeMiContrato(original, { ...original, valorTotal: "36081000" })).toEqual({});
    expect(cambiosDeMiContrato(original, { ...original, valorTotal: "$ 36.081.000" })).toEqual({});
    expect(cambiosDeMiContrato(original, { ...original, valorTotal: "$ 44.099.000" })).toEqual({ valorTotal: "$ 44.099.000" });
  });

  it("dirección, teléfono y correo también se detectan", () => {
    expect(cambiosDeMiContrato(original, { ...original, direccion: "Otra", telefono: "3111111111", correo: "a@b.co" })).toEqual({
      direccion: "Otra", telefono: "3111111111", correo: "a@b.co",
    });
  });
});

describe("formCompleto", () => {
  it("manda todos los campos, recortados (así lo usa 'Antes de empezar')", () => {
    const f = formCompleto({ ...original, ciudad: "  Bello ", correo: " " });
    expect(Object.keys(f)).toEqual(Object.keys(MI_CONTRATO_VACIO));
    expect(f.ciudad).toBe("Bello");
    expect(f.correo).toBe("");
  });
});

describe("formatearValorTotal", () => {
  it("pone los puntos de miles si lo entiende y si no lo deja como está", () => {
    expect(formatearValorTotal("44099000")).toBe("44.099.000");
    expect(formatearValorTotal("$ 44.099.000")).toBe("44.099.000");
    expect(formatearValorTotal("abc")).toBe("abc");
    expect(formatearValorTotal("")).toBe("");
    expect(formatearValorTotal("0")).toBe("0");
  });
});

describe("validarMiContrato", () => {
  it("un formulario lleno y correcto no tiene errores (el correo puede ir vacío)", () => {
    expect(validarMiContrato(original)).toEqual({});
  });

  it("vacío: todos son obligatorios menos el correo", () => {
    const e = validarMiContrato(MI_CONTRATO_VACIO);
    expect(Object.keys(e).sort()).toEqual(
      ["cargo", "ciudad", "direccion", "fin", "inicio", "objeto", "revisoCargo", "revisoNombre", "telefono", "valorTotal"],
    );
    expect(e.direccion).toBe("Escribe tu dirección.");
    expect(e.correo).toBeUndefined();
  });

  it("solo espacios cuenta como vacío", () => {
    expect(validarMiContrato({ ...original, ciudad: "   " }).ciudad).toBe("Escribe tu ciudad.");
  });

  it("teléfono: números, espacios y +, de 7 a 15 dígitos", () => {
    for (const malo of ["123456", "abc1234567", "300-123-4567", "1234567890123456"]) {
      expect(validarMiContrato({ ...original, telefono: malo }).telefono).toMatch(/entre 7 y 15 dígitos/);
    }
    for (const bueno of ["1234567", "+57 300 123 4567", "3001234567"]) {
      expect(validarMiContrato({ ...original, telefono: bueno }).telefono).toBeUndefined();
    }
  });

  it("correo: formato válido si lo escribe", () => {
    expect(validarMiContrato({ ...original, correo: "sin-arroba" }).correo).toMatch(/no parece válido/);
    expect(validarMiContrato({ ...original, correo: "nombre@correo.com" }).correo).toBeUndefined();
  });

  it("fin no puede ser antes del inicio", () => {
    expect(validarMiContrato({ ...original, inicio: "2026-06-01", fin: "2026-05-31" }).fin).toMatch(/no puede ser antes/);
    expect(validarMiContrato({ ...original, inicio: "2026-06-01", fin: "2026-06-01" }).fin).toBeUndefined();
  });

  it("valor total: acepta '$ 44.099.000' y rechaza lo que no es plata", () => {
    expect(validarMiContrato({ ...original, valorTotal: "$ 44.099.000" }).valorTotal).toBeUndefined();
    expect(validarMiContrato({ ...original, valorTotal: "44099000" }).valorTotal).toBeUndefined();
    expect(validarMiContrato({ ...original, valorTotal: "mucho" }).valorTotal).toMatch(/en pesos/);
    expect(validarMiContrato({ ...original, valorTotal: "0" }).valorTotal).toMatch(/en pesos/);
  });

  it("largos máximos como el servidor", () => {
    expect(validarMiContrato({ ...original, direccion: "d".repeat(151) }).direccion).toMatch(/150/);
    expect(validarMiContrato({ ...original, objeto: "o".repeat(1501) }).objeto).toMatch(/1500/);
    expect(validarMiContrato({ ...original, objeto: "o".repeat(1500) }).objeto).toBeUndefined();
  });
});

describe("errores por campo", () => {
  it("deja pasar solo los campos de la pantalla", () => {
    expect(erroresDeMiContrato({ fin: "Mal", honorario: "no existe", revisoNombre: "Largo", valorTotal: "Poco" })).toEqual({
      fin: "Mal", revisoNombre: "Largo", valorTotal: "Poco",
    });
    expect(erroresDeMiContrato(undefined)).toEqual({});
  });

  it("el primer campo con error sigue el orden de la pantalla", () => {
    expect(primerCampoConError({ revisoCargo: "x", fin: "y" })).toBe("fin");
    expect(primerCampoConError({ valorTotal: "x", direccion: "y" })).toBe("direccion");
    expect(primerCampoConError({})).toBeNull();
  });
});
