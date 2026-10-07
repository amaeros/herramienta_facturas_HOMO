import { describe, expect, it } from "vitest";
import {
  CAMPOS_REGISTRO, erroresDeRegistro, limpiarCedula, payloadDeRegistro, pinDeCedula, primerCampoConErrorRegistro, REGISTRO_VACIO,
  validarRegistro, type FormRegistro,
} from "../registro";

const lleno: FormRegistro = {
  nombre: "Nueva Prueba Uno",
  cedula: "1.000.005.551",
  direccion: "Carrera 5 # 6-7",
  telefono: "300 000 0000",
  ciudad: "Medellín",
  correo: "",
  linea: "Línea de prueba",
  numeroContrato: "2026CPS555",
  cargo: "Profesional de prueba",
  objeto: "Objeto ficticio de prueba.",
  inicio: "2026-01-01",
  fin: "2026-09-30",
  honorario: "4.009.000",
  valorTotal: "36.081.000",
  riesgo: "III",
  revisoNombre: "Revisora de Prueba",
  revisoCargo: "Apoyo técnico",
};

describe("validarRegistro", () => {
  it("un formulario completo no tiene errores (el correo es opcional)", () => {
    expect(validarRegistro(lleno)).toEqual({});
  });

  it("todo lo demás es obligatorio, con la frase del servidor", () => {
    const e = validarRegistro(REGISTRO_VACIO);
    expect(Object.keys(e).sort()).toEqual(CAMPOS_REGISTRO.filter((c) => c !== "correo").sort());
    expect(e.nombre).toBe("Escribe tu nombre completo.");
    expect(e.linea).toBe("Escribe tu equipo o línea.");
    expect(e.riesgo).toMatch(/riesgo ARL/);
  });

  it("formatos: cédula, teléfono, correo, fechas, montos y riesgo", () => {
    const e = validarRegistro({
      ...lleno, cedula: "12", telefono: "abc", correo: "no-es-correo", inicio: "2026-09-30", fin: "2026-01-01",
      honorario: "5.000.000", valorTotal: "1.000.000", riesgo: "X",
    });
    expect(e.cedula).toMatch(/entre 6 y 10/);
    expect(e.telefono).toMatch(/entre 7 y 15 dígitos/);
    expect(e.correo).toMatch(/no parece válido/);
    expect(e.fin).toMatch(/antes de la fecha de inicio/);
    expect(e.valorTotal).toMatch(/menor que el honorario/);
    expect(e.riesgo).toBeTruthy();
    expect(validarRegistro({ ...lleno, cedula: "10abc" }).cedula).toMatch(/solo lleva números/);
    expect(validarRegistro({ ...lleno, honorario: "mucho" }).honorario).toMatch(/en pesos/);
  });

  it("largo máximo de los textos", () => {
    expect(validarRegistro({ ...lleno, objeto: "x".repeat(1501) }).objeto).toMatch(/máximo 1500/);
  });
});

describe("payloadDeRegistro", () => {
  it("recorta, deja la cédula solo con números y manda los montos como número", () => {
    const p = payloadDeRegistro({ ...lleno, nombre: "  Nueva Prueba Uno ", correo: " a@b.co " });
    expect(p.nombre).toBe("Nueva Prueba Uno");
    expect(p.cedula).toBe("1000005551");
    expect(p.honorario).toBe(4009000);
    expect(p.valorTotal).toBe(36081000);
    expect(p.correo).toBe("a@b.co");
    expect(p.sitio_web).toBe("");
  });

  it("lleva el campo trampa tal cual y nada de activo ni estado", () => {
    const p = payloadDeRegistro(lleno, "x");
    expect(p.sitio_web).toBe("x");
    expect(p).not.toHaveProperty("activo");
    expect(p).not.toHaveProperty("estado");
  });
});

describe("ayudas", () => {
  it("el PIN son los últimos 4 números de la cédula", () => {
    expect(pinDeCedula("1.000.005.551")).toBe("5551");
    expect(pinDeCedula("123")).toBe("");
    expect(limpiarCedula(" 1.000 005.551 ")).toBe("1000005551");
  });

  it("errores del servidor: solo los campos del formulario y el primero en el orden de la pantalla", () => {
    const e = erroresDeRegistro({ cedula: "Ya existe una cuenta con esa cédula. Si es tuya, habla con tu supervisor.", nombre: "x", raro: "y" });
    expect(e).toEqual({ cedula: expect.any(String), nombre: "x" });
    expect(primerCampoConErrorRegistro(e)).toBe("nombre");
    expect(primerCampoConErrorRegistro({})).toBeNull();
    expect(erroresDeRegistro(undefined)).toEqual({});
  });
});
