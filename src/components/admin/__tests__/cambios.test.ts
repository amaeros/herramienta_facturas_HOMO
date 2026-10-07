import { describe, expect, it } from "vitest";
import { normalizarCambio, type CambioContrato } from "../apiAdmin";
import { contarDeContratistas, fmtFechaHoraCambio, lineaCambio, TEXTO_ALERTA_CAMBIO, textoAutorCambio } from "../helpers";

const base: CambioContrato = {
  id: 1, contratoId: 7, nombre: "Ana Prueba Ejemplo", autor: "contratista", campo: "fin", etiqueta: "Fecha de fin",
  antes: "30/09/2026", despues: "30/11/2026", alerta: false, creado: "2026-10-07T15:04:00.000Z",
};

describe("bitácora de cambios", () => {
  it("la línea dice 'de X a Y', sin flechas", () => {
    const l = lineaCambio(base);
    expect(l).toBe("Fecha de fin: de 30/09/2026 a 30/11/2026");
    expect(l).not.toContain("→");
  });

  it("si antes o después estaban vacíos no escribe '(vacío)'", () => {
    expect(lineaCambio({ ...base, etiqueta: "Revisó (nombre)", antes: "(vacío)", despues: "Juan Pérez" })).toBe("Revisó (nombre): ahora es Juan Pérez");
    expect(lineaCambio({ ...base, etiqueta: "Revisó (cargo)", antes: "Apoyo", despues: "(vacío)" })).toBe("Revisó (cargo): se borró Apoyo");
    expect(lineaCambio({ ...base, antes: "", despues: "01/01/2026" })).toBe("Fecha de fin: ahora es 01/01/2026");
  });

  it("los datos personales no muestran valores: solo dicen que se actualizaron", () => {
    const l = lineaCambio({ etiqueta: "Dirección", antes: "(dato personal)", despues: "(dato personal)" });
    expect(l).toBe("Dirección: se actualizó (el dato no se guarda aquí)");
    expect(l).not.toContain("de (dato personal)");
  });

  it("el texto de la alerta del valor total", () => {
    expect(TEXTO_ALERTA_CAMBIO).toBe("Valor total distinto al esperado");
  });

  it("normaliza `alerta`: solo true cuenta", () => {
    expect(normalizarCambio({ ...base, alerta: true }).alerta).toBe(true);
    expect(normalizarCambio({ ...base, alerta: false }).alerta).toBe(false);
    expect(normalizarCambio({ ...base, alerta: "true" }).alerta).toBe(false);
    const { alerta: _quitado, ...sinAlerta } = base;
    void _quitado;
    expect(normalizarCambio(sinAlerta).alerta).toBe(false);
  });

  it("quién hizo el cambio", () => {
    expect(textoAutorCambio("contratista")).toBe("La contratista");
    expect(textoAutorCambio("admin")).toBe("Supervisor");
  });

  it("cuenta los cambios de contratistas", () => {
    expect(contarDeContratistas([base, { ...base, autor: "admin" }, base])).toBe(2);
    expect(contarDeContratistas([])).toBe(0);
  });

  it("normaliza la fila del servidor", () => {
    const c = normalizarCambio({ ...base, autor: "otro", etiqueta: "", creado: base.creado });
    expect(c.autor).toBe("admin");
    expect(c.etiqueta).toBe("fin");
    expect(normalizarCambio({ ...base }).autor).toBe("contratista");
    expect(normalizarCambio({ ...base }).creado).toBe(base.creado);
  });

  it("fecha y hora en Bogotá", () => {
    // 15:04 UTC son las 10:04 en Bogotá (UTC-5)
    expect(fmtFechaHoraCambio("2026-10-07T15:04:00.000Z")).toMatch(/07\/10\/2026.*10:04/);
    expect(fmtFechaHoraCambio("")).toBe("—");
  });
});
