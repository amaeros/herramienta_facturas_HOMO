import { describe, expect, it } from "vitest";
import { cambiosDeMiContrato, erroresDeMiContrato, primerCampoConError } from "../miContrato";
import type { DatosMiContrato } from "../tipos";

const original: DatosMiContrato = { inicio: "2026-01-01", fin: "2026-09-30", revisoNombre: "Supervisor Prueba", revisoCargo: "Apoyo técnico" };

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
});

describe("errores por campo", () => {
  it("deja pasar solo los campos de la pantalla", () => {
    expect(erroresDeMiContrato({ fin: "Mal", honorario: "no existe", revisoNombre: "Largo" })).toEqual({ fin: "Mal", revisoNombre: "Largo" });
    expect(erroresDeMiContrato(undefined)).toEqual({});
  });

  it("el primer campo con error sigue el orden de la pantalla", () => {
    expect(primerCampoConError({ revisoCargo: "x", fin: "y" })).toBe("fin");
    expect(primerCampoConError({})).toBeNull();
  });
});
