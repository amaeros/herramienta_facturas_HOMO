import { describe, expect, it } from "vitest";
import { normalizarSolicitud, type Contrato } from "../apiAdmin";
import {
  avisoInicioContratoNuevo, erroresGuiadoDeCampos, fmtFechaSolicitud, formContratoNuevoInicial, formOtrosiInicial, lineaCambio,
  payloadContratoNuevo, payloadOtrosi, resumenLote, textoPendientes, validarContratoNuevo, validarOtrosi,
} from "../helpers";

const contrato: Contrato = {
  id: 7, nombre: "Ana Prueba Ejemplo", cedula: "1000000123", direccion: "Calle 1", telefono: "3000000000", ciudad: "Medellín",
  correo: "ana@ejemplo.com", numeroContrato: "2026CPSP000", objeto: "Apoyar el observatorio.", cargo: "Profesional", linea: "Línea X",
  inicio: "2026-01-01", fin: "2026-09-30", honorario: 4009000, valorTotal: 36081000, riesgo: "III", riesgoNuevo: "", riesgoDesde: null,
  revisoNombre: "Supervisor", revisoCargo: "Apoyo", activo: true, verificadaEn: null, cargas: 3,
};

describe("otrosí", () => {
  it("parte de lo vigente", () => {
    expect(formOtrosiInicial(contrato)).toEqual({ fin: "2026-09-30", valorTotal: "36.081.000" });
  });

  it("pide cambiar algo, y la fecha de fin y el valor total tienen que tener sentido", () => {
    expect(validarOtrosi(formOtrosiInicial(contrato), contrato).fin).toMatch(/Cambia la fecha de fin, el valor total o los dos/);
    expect(validarOtrosi({ fin: "2026-11-30", valorTotal: "44.099.000" }, contrato)).toEqual({});
    // solo prórroga o solo adición también valen
    expect(validarOtrosi({ fin: "2026-11-30", valorTotal: "36.081.000" }, contrato)).toEqual({});
    expect(validarOtrosi({ fin: "2026-09-30", valorTotal: "40.000.000" }, contrato)).toEqual({});
    expect(validarOtrosi({ fin: "", valorTotal: "" }, contrato)).toEqual({ fin: expect.any(String), valorTotal: expect.any(String) });
    expect(validarOtrosi({ fin: "2025-12-30", valorTotal: "44.099.000" }, contrato).fin).toMatch(/anterior a la de inicio/);
    expect(validarOtrosi({ fin: "2026-11-30", valorTotal: "1.000.000" }, contrato).valorTotal).toMatch(/menor que el honorario/);
    expect(validarOtrosi({ fin: "2026-11-30", valorTotal: "mucho" }, contrato).valorTotal).toMatch(/en pesos/);
  });

  it("el payload es la edición completa con solo la fecha de fin y el valor total nuevos (el inicio no cambia)", () => {
    const p = payloadOtrosi(contrato, { fin: "2026-11-30", valorTotal: "44.099.000" });
    expect(p).toMatchObject({ fin: "2026-11-30", valorTotal: 44099000, inicio: "2026-01-01", honorario: 4009000, nombre: "Ana Prueba Ejemplo" });
    expect(p).not.toHaveProperty("id");
    expect(p).not.toHaveProperty("cargas");
  });
});

describe("contrato nuevo", () => {
  const completo = { numeroContrato: "2026CPSP999", inicio: "2026-10-01", fin: "2026-12-30", honorario: "4.009.000", valorTotal: "12.027.000", objeto: "Objeto nuevo." };

  it("parte en blanco, con el honorario y el objeto del contrato anterior", () => {
    expect(formContratoNuevoInicial(contrato)).toEqual({
      numeroContrato: "", inicio: "", fin: "", honorario: "4.009.000", valorTotal: "", objeto: "Apoyar el observatorio.",
    });
  });

  it("todo es obligatorio menos el objeto; fin >= inicio y valor total >= honorario", () => {
    expect(validarContratoNuevo(completo)).toEqual({});
    expect(validarContratoNuevo({ ...completo, objeto: "" })).toEqual({});
    const vacio = validarContratoNuevo({ ...formContratoNuevoInicial(contrato), honorario: "" });
    expect(Object.keys(vacio).sort()).toEqual(["fin", "honorario", "inicio", "numeroContrato", "valorTotal"]);
    expect(validarContratoNuevo({ ...completo, fin: "2026-09-01" }).fin).toMatch(/anterior a la de inicio/);
    expect(validarContratoNuevo({ ...completo, valorTotal: "1.000.000" }).valorTotal).toMatch(/menor que el honorario/);
  });

  it("avisa (sin bloquear) si el inicio no es posterior al fin del contrato anterior", () => {
    expect(avisoInicioContratoNuevo("2026-10-01", "2026-09-30")).toBe("");
    expect(avisoInicioContratoNuevo("2026-09-30", "2026-09-30")).toMatch(/no es posterior al fin del contrato anterior \(30\/09\/2026\)/);
    expect(avisoInicioContratoNuevo("2026-06-01", "2026-09-30")).toMatch(/30\/09\/2026/);
    expect(avisoInicioContratoNuevo("", "2026-09-30")).toBe("");
    expect(avisoInicioContratoNuevo("2026-10-01", null)).toBe("");
    // el aviso no se confunde con un error de validación
    expect(validarContratoNuevo({ ...completo, inicio: "2026-06-01" })).toEqual({});
  });

  it("el payload cambia el n.º, las fechas, el honorario, el valor total y el objeto, y conserva lo demás", () => {
    const p = payloadContratoNuevo(contrato, completo);
    expect(p).toMatchObject({
      numeroContrato: "2026CPSP999", inicio: "2026-10-01", fin: "2026-12-30", honorario: 4009000, valorTotal: 12027000, objeto: "Objeto nuevo.",
      nombre: "Ana Prueba Ejemplo", cedula: "1000000123", riesgo: "III", activo: true,
    });
  });
});

describe("errores del servidor en los formularios guiados", () => {
  it("solo deja los campos que están en la pantalla", () => {
    expect(erroresGuiadoDeCampos({ fin: "a", valorTotal: "b", cedula: "c", nombre: "d" })).toEqual({ fin: "a", valorTotal: "b" });
    expect(erroresGuiadoDeCampos(undefined)).toEqual({});
  });
});

describe("cambio en lote", () => {
  it("el resumen dice cuántas se cambiaron", () => {
    expect(resumenLote(3, 3)).toBe("Se cambiaron las 3 trabajadoras.");
    expect(resumenLote(2, 3)).toBe("Se cambiaron 2 de 3 trabajadoras.");
    expect(resumenLote(0, 3)).toBe("No se pudo cambiar a ninguna trabajadora.");
    expect(resumenLote(1, 1)).toBe("Se cambió 1 trabajadora.");
    expect(resumenLote(0, 1)).toBe("No se pudo cambiar a la trabajadora.");
  });
});

describe("solicitudes", () => {
  it("normaliza la fila de la lista (solo los últimos 4 de la cédula)", () => {
    const s = normalizarSolicitud({
      id: 4, nombre: "Nueva Prueba Uno", cedulaFinal4: "…5551", linea: "Línea de prueba", numeroContrato: "2026CPS555", cargo: "Profesional",
      inicio: "2026-01-01", fin: "2026-09-30", honorario: 4009000, riesgo: "III", solicitada: "2026-10-07T15:04:00.000Z",
    });
    expect(s).toMatchObject({ id: 4, cedulaFinal4: "…5551", honorario: 4009000, fin: "2026-09-30" });
    expect(s).not.toHaveProperty("cedula");
    expect(normalizarSolicitud({ id: 1, nombre: "x", solicitada: null }).solicitada).toBe("");
  });

  it("fecha de la solicitud en Bogotá y el texto de pendientes", () => {
    expect(fmtFechaSolicitud("2026-10-07T15:04:00.000Z")).toBe("07/10/2026");
    expect(fmtFechaSolicitud("")).toBe("—");
    expect(textoPendientes(1)).toBe("1 solicitud pendiente");
    expect(textoPendientes(3)).toBe("3 solicitudes pendientes");
  });

  it("en la bitácora, el registro y la aprobación se cuentan como eventos", () => {
    const base = { etiqueta: "Solicitud de cuenta", antes: "", despues: "Solicitud enviada" };
    expect(lineaCambio({ ...base, campo: "registro" })).toBe("Envió la solicitud de cuenta");
    expect(lineaCambio({ ...base, campo: "aprobada", etiqueta: "Solicitud aprobada", despues: "Aprobada" })).toBe("Aprobó la solicitud de cuenta");
    expect(lineaCambio({ etiqueta: "Fecha de fin", antes: "30/09/2026", despues: "30/11/2026", campo: "fin" })).toBe("Fecha de fin: de 30/09/2026 a 30/11/2026");
  });
});
