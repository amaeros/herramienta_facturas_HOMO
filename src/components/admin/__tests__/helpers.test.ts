import { describe, expect, it } from "vitest";
import { normalizarContrato, extraerParametros, type Contrato, type Parametros } from "../apiAdmin";
import {
  campoDeMensaje, enmascararCedula, erroresDeCampos, erroresParamDeCampos, filtrarContratos, formDeContrato, formDeParametros, formVacio, fraccionAPorcentaje,
  mesActualBogota, mesAnterior, mesPorDefecto, nombreCoincide, parseDecimal, parseEntero, payloadDeContrato, payloadDeForm,
  payloadDeParametros, pesos, porcentajeAFraccion, puntos, ultimos4, ultimosMeses, validarForm, validarParametros,
} from "../helpers";

const contrato: Contrato = {
  id: 7, nombre: "Ana Prueba Ejemplo", cedula: "1000000123", direccion: "Calle 1", telefono: "3000000000", ciudad: "Medellín",
  correo: "ana@ejemplo.com", numeroContrato: "2026CPSP000", objeto: "Apoyar", cargo: "Profesional", linea: "Línea X",
  inicio: "2026-01-01", fin: "2026-09-30", honorario: 7174000, valorTotal: 64566000, riesgo: "III", riesgoNuevo: "", riesgoDesde: null,
  revisoNombre: "Supervisor", revisoCargo: "Apoyo", activo: true, cargas: 3,
};

describe("formato", () => {
  it("pesos y puntos", () => {
    expect(pesos(7174000)).toBe("$ 7.174.000");
    expect(pesos(0)).toBe("$ 0");
    expect(pesos(null)).toBe("—");
    expect(puntos(1750905)).toBe("1.750.905");
    expect(puntos(null)).toBe("");
  });

  it("cédula siempre enmascarada", () => {
    expect(enmascararCedula("1000000123")).toBe("…0123");
    expect(enmascararCedula("")).toBe("—");
    expect(ultimos4("…1234")).toBe("…1234");
    expect(ultimos4("1234")).toBe("…1234");
    expect(ultimos4("")).toBe("—");
  });

  it("parseEntero acepta los formatos de la spec y rechaza el resto", () => {
    expect(parseEntero("7.174.000")).toBe(7174000);
    expect(parseEntero("$ 7.174.000")).toBe(7174000);
    expect(parseEntero("7174000")).toBe(7174000);
    expect(parseEntero("7,174,000")).toBe(7174000);
    expect(parseEntero("")).toBeNull();
    expect(parseEntero("7.17")).toBeNull();
    expect(parseEntero("abc")).toBeNull();
    expect(parseEntero("-5")).toBeNull();
  });
});

describe("porcentajes", () => {
  it("fracción -> texto legible", () => {
    expect(fraccionAPorcentaje(0.125)).toBe("12,5");
    expect(fraccionAPorcentaje(0.16)).toBe("16");
    expect(fraccionAPorcentaje(0.4)).toBe("40");
    expect(fraccionAPorcentaje(0.00522)).toBe("0,522");
    expect(fraccionAPorcentaje(0.02436)).toBe("2,436");
    expect(fraccionAPorcentaje(0.0435)).toBe("4,35");
  });

  it("texto -> fracción (ida y vuelta exacta)", () => {
    expect(porcentajeAFraccion("12,5")).toBe(0.125);
    expect(porcentajeAFraccion("12.5 %")).toBe(0.125);
    expect(porcentajeAFraccion("0,522")).toBe(0.00522);
    expect(porcentajeAFraccion("")).toBeNull();
    expect(porcentajeAFraccion("doce")).toBeNull();
    for (const f of [0.4, 0.125, 0.16, 0.00522, 0.01044, 0.02436, 0.0435, 0.0696]) {
      expect(porcentajeAFraccion(fraccionAPorcentaje(f))).toBe(f);
    }
  });

  it("parseDecimal", () => {
    expect(parseDecimal("1,5")).toBe(1.5);
    expect(parseDecimal("25")).toBe(25);
    expect(parseDecimal("x")).toBeNull();
  });
});

describe("meses", () => {
  it("mes anterior y por defecto en hora de Bogotá", () => {
    expect(mesAnterior("2026-01")).toBe("2025-12");
    expect(mesAnterior("2026-10")).toBe("2026-09");
    expect(mesPorDefecto(new Date("2026-10-06T15:00:00Z"))).toBe("2026-09");
    // 1 de noviembre 02:00 UTC todavía es 31 de octubre en Bogotá (UTC-5)
    expect(mesActualBogota(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10");
    expect(mesPorDefecto(new Date("2026-11-01T02:00:00Z"))).toBe("2026-09");
  });

  it("ultimosMeses", () => {
    const l = ultimosMeses("2026-02", 3);
    expect(l.map((m) => m.key)).toEqual(["2026-02", "2026-01", "2025-12"]);
    expect(l[0].label).toBe("Febrero 2026");
  });
});

describe("formulario de trabajadora", () => {
  it("ida y vuelta de un contrato", () => {
    const f = formDeContrato(contrato);
    expect(f.honorario).toBe("7.174.000");
    expect(validarForm(f)).toEqual({});
    const p = payloadDeForm(f);
    expect(p.honorario).toBe(7174000);
    expect(p.valorTotal).toBe(64566000);
    expect(p.cedula).toBe("1000000123");
    expect(p.riesgoDesde).toBeNull();
    expect("id" in p).toBe(false);
  });

  it("errores por campo", () => {
    const f = { ...formVacio(), cedula: "12", correo: "no-es-correo", inicio: "2026-05-01", fin: "2026-04-01", honorario: "abc" };
    const e = validarForm(f);
    expect(Object.keys(e).sort()).toEqual(["cedula", "correo", "fin", "honorario", "nombre"]);
  });

  it("cédula con puntos se limpia; con letras no pasa", () => {
    expect(payloadDeForm({ ...formVacio(), nombre: "X", cedula: "1.000.000.123" }).cedula).toBe("1000000123");
    expect(validarForm({ ...formVacio(), nombre: "X", cedula: "10A0000123" }).cedula).toMatch(/solo lleva números/);
  });

  it("valor total menor que honorario", () => {
    const e = validarForm({ ...formDeContrato(contrato), valorTotal: "1.000.000" });
    expect(e.valorTotal).toMatch(/menor/);
  });

  it("riesgo nuevo exige fecha día 1", () => {
    const base = { ...formDeContrato(contrato), riesgoNuevo: "III" };
    expect(validarForm(base).riesgoDesde).toMatch(/desde/);
    expect(validarForm({ ...base, riesgoDesde: "2026-06-15" }).riesgoDesde).toMatch(/día 1/);
    expect(validarForm({ ...base, riesgoDesde: "2026-06-01" }).riesgoDesde).toBeUndefined();
    // sin riesgo nuevo no se manda la fecha
    expect(payloadDeForm({ ...formVacio(), nombre: "X", cedula: "123456", riesgoDesde: "2026-06-01" }).riesgoDesde).toBeNull();
  });

  it("contrato por completar (sin fechas ni honorario) es válido", () => {
    expect(validarForm({ ...formVacio(), nombre: "Nueva Persona", cedula: "123456" })).toEqual({});
  });

  it("payloadDeContrato conserva todo y cambia solo lo pedido", () => {
    const p = payloadDeContrato(contrato, { activo: false });
    expect(p.activo).toBe(false);
    expect(p.nombre).toBe(contrato.nombre);
    expect("cargas" in p).toBe(false);
  });

  it("campoDeMensaje reconoce el campo en los mensajes del servidor", () => {
    expect(campoDeMensaje("Ya existe otra trabajadora con ese nombre.")).toBe("nombre");
    expect(campoDeMensaje("La cédula ya está registrada a nombre de María.")).toBe("cedula");
    expect(campoDeMensaje("El honorario debe ser un número mayor que 0.")).toBe("honorario");
    expect(campoDeMensaje("El valor total no puede ser menor que el honorario.")).toBe("valorTotal");
    expect(campoDeMensaje("La fecha de fin no puede ser anterior al inicio.")).toBe("fin");
    expect(campoDeMensaje("Indica desde cuándo aplica el riesgo nuevo.")).toBe("riesgoDesde");
    expect(campoDeMensaje("Algo raro pasó.")).toBeNull();
  });

  it("errores por campo que manda el servidor", () => {
    expect(erroresDeCampos({ cedula: "Ya hay otra.", noExiste: "x", fin: "Mal" })).toEqual({ cedula: "Ya hay otra.", fin: "Mal" });
    expect(erroresDeCampos(undefined)).toEqual({});
    expect(erroresParamDeCampos({ "arl.III": "Mal", salud: "Mal2", raro: "x" })).toEqual({ arlIII: "Mal", salud: "Mal2" });
  });

  it("confirmar borrado: sin tildes, mayúsculas ni espacios repetidos", () => {
    expect(nombreCoincide("  ana  PRUEBA ejemplo ", "Ana Prueba Ejemplo")).toBe(true);
    expect(nombreCoincide("María", "Maria")).toBe(true);
    expect(nombreCoincide("", "Ana")).toBe(false);
    expect(nombreCoincide("Ana", "Ana Prueba")).toBe(false);
  });

  it("buscador sin tildes", () => {
    const lista = [contrato, { ...contrato, id: 8, nombre: "María Camila Prueba" }];
    expect(filtrarContratos(lista, "maria").map((c) => c.id)).toEqual([8]);
    expect(filtrarContratos(lista, "  ").length).toBe(2);
  });
});

describe("parámetros", () => {
  const p: Parametros = {
    pctIbc: 0.4, salud: 0.125, pension: 0.16, smmlv: 1750905, ibcPisoMult: 1, ibcTechoMult: 25,
    arl: { I: 0.00522, II: 0.01044, III: 0.02436, IV: 0.0435, V: 0.0696 },
    enviarCorreo: false, correoSupervisor: "", toleranciaSs: 100,
  };

  it("se muestran legibles", () => {
    const f = formDeParametros(p);
    expect(f.salud).toBe("12,5");
    expect(f.pctIbc).toBe("40");
    expect(f.smmlv).toBe("1.750.905");
    expect(f.arl.III).toBe("2,436");
    expect(f.ibcPisoMult).toBe("1");
  });

  it("al guardar vuelven EXACTAMENTE a las fracciones originales", () => {
    expect(payloadDeParametros(p, formDeParametros(p))).toEqual(p);
  });

  it("cambios del usuario", () => {
    const f = { ...formDeParametros(p), salud: "12", smmlv: "1.800.000", ibcTechoMult: "25,5" };
    const out = payloadDeParametros(p, f);
    expect(out.salud).toBe(0.12);
    expect(out.smmlv).toBe(1800000);
    expect(out.ibcTechoMult).toBe(25.5);
  });

  it("validación", () => {
    expect(validarParametros(formDeParametros(p))).toEqual({});
    const mal = { ...formDeParametros(p), salud: "150", smmlv: "0", correoSupervisor: "x", toleranciaSs: "-1" };
    mal.arl = { ...mal.arl, V: "30" };
    expect(Object.keys(validarParametros(mal)).sort()).toEqual(["arlV", "correoSupervisor", "salud", "smmlv", "toleranciaSs"]);
  });

  it("extraerParametros acepta la fila suelta o anidada y snake_case", () => {
    expect(extraerParametros({ ok: true, parametros: p })).toEqual(p);
    expect(extraerParametros({ ok: true, ...p })).toEqual(p);
    const snake = extraerParametros({ pct_ibc: 0.4, ibc_piso_mult: 1, ibc_techo_mult: 25, smmlv: 1, salud: 0.125, pension: 0.16, arl: p.arl, tolerancia_ss: 100 });
    expect(snake.pctIbc).toBe(0.4);
    expect(snake.toleranciaSs).toBe(100);
  });
});

describe("normalizarContrato", () => {
  it("acepta snake_case y fechas con hora", () => {
    const c = normalizarContrato({
      id: 1, nombre: "X", cedula: "123456", numero_contrato: "A1", valor_total: "5000", riesgo_nuevo: "", riesgo_desde: null,
      inicio: "2026-01-01T00:00:00.000Z", honorario: 100, activo: false, cargas: 2, reviso_nombre: "R",
    });
    expect(c.numeroContrato).toBe("A1");
    expect(c.valorTotal).toBe(5000);
    expect(c.inicio).toBe("2026-01-01");
    expect(c.activo).toBe(false);
    expect(c.revisoNombre).toBe("R");
    expect(c.cargas).toBe(2);
  });
});
