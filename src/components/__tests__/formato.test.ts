import { describe, expect, it } from "vitest";
import { problemaArchivo, MAX_BYTES, MSG_PESO, MSG_TIPO } from "../archivos";
import { dinero, fmtFecha, fmtMoney, labelMes, soloNumero, tituloNombre } from "../formato";
import { datosDeInputs, faltaAlgo, inputsDeLectura } from "../lectura";

describe("formato", () => {
  it("fmtMoney / dinero", () => {
    expect(fmtMoney(7174000)).toBe("$7.174.000");
    expect(fmtMoney(0)).toBe("$0");
    expect(fmtMoney(null)).toBe("—");
    expect(fmtMoney("abc")).toBe("—");
    expect(dinero(358700)).toBe("358.700");
    expect(dinero(null)).toBe("");
  });

  it("fechas y meses", () => {
    expect(fmtFecha("2026-09-30")).toBe("30/09/2026");
    expect(fmtFecha("")).toBe("—");
    expect(labelMes("2026-09")).toBe("Septiembre 2026");
    expect(labelMes("2026-13")).toBe("—");
    expect(tituloNombre("ANA MARIA QUICENO")).toBe("Ana Maria Quiceno");
  });

  it("soloNumero entiende puntos, comas y signos", () => {
    expect(soloNumero("358.700")).toBe(358700);
    expect(soloNumero("$ 1,234,567")).toBe(1234567);
    expect(soloNumero("70000")).toBe(70000);
    expect(soloNumero("21.400,50")).toBe(21400);
    expect(soloNumero("")).toBeNull();
    expect(soloNumero("12a")).toBeNull();
  });
});

describe("lectura", () => {
  it("convierte lo leído en campos y de vuelta en datos", () => {
    const i = inputsDeLectura({ numero: "9509633245", periodo: "2026-09", salud: 358700, pension: 459200, arl: 70000 });
    expect(i).toEqual({ numero: "9509633245", mes: "09", anio: "2026", salud: "358.700", pension: "459.200", arl: "70.000" });
    const d = datosDeInputs(i);
    expect(d).toEqual({ numero: "9509633245", periodo: "2026-09", salud: 358700, pension: 459200, arl: 70000 });
    expect(faltaAlgo(d)).toBe(false);
  });

  it("lectura vacía = falta todo", () => {
    expect(faltaAlgo(datosDeInputs(inputsDeLectura(null)))).toBe(true);
  });
});

describe("problemaArchivo", () => {
  it("acepta PDF e imágenes y rechaza el resto", () => {
    expect(problemaArchivo({ name: "a.pdf", type: "application/pdf", size: 1000 })).toBe("");
    expect(problemaArchivo({ name: "a.jpg", type: "image/jpeg", size: 1000 })).toBe("");
    expect(problemaArchivo({ name: "a.docx", type: "application/msword", size: 1000 })).toBe(MSG_TIPO);
  });

  it("un PDF de más de 4 MB no pasa, una foto grande sí (se reduce antes de enviar)", () => {
    expect(problemaArchivo({ name: "a.pdf", type: "application/pdf", size: MAX_BYTES + 1 })).toBe(MSG_PESO);
    expect(problemaArchivo({ name: "a.jpg", type: "image/jpeg", size: MAX_BYTES * 2 })).toBe("");
  });
});
