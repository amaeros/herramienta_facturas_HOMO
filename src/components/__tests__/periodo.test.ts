import { describe, expect, it } from "vitest";
import { commercialDays, expectedPeriod, monthLabel, periodValue } from "../../lib/calc";
import {
  diasManualDeMotivo, eleccionSoloDias, esError, limitesDelMes, MES_COMPLETO, periodoElegido, type PeriodoElegido,
} from "../periodo";
import type { MesInfo } from "../tipos";

const HONORARIO = 4009000; // dato inventado

/** Arma el MesInfo igual que lo hace el servidor (Resumen.meses). */
function mesDe(key: string, inicio: string, fin: string): MesInfo {
  const p = expectedPeriod(key, inicio, fin)!;
  const dias = commercialDays(p.inicio, p.corte)!;
  return { key, label: monthLabel(key), inicio: p.inicio, corte: p.corte, dias, valor: periodValue(HONORARIO, dias), enviado: "" };
}

const CONTRATO = { inicio: "2026-01-01", fin: "2026-09-30", honorario: HONORARIO };
const CONTRATO_16 = { inicio: "2026-01-16", fin: "2026-09-30", honorario: HONORARIO };

function ok(r: ReturnType<typeof periodoElegido>): PeriodoElegido {
  if (esError(r)) throw new Error("se esperaba un periodo y salió: " + r.error);
  return r;
}

describe("periodoElegido: el mes completo", () => {
  it("usa el periodo del Resumen (30 días, honorario entero)", () => {
    const r = ok(periodoElegido(mesDe("2026-09", CONTRATO.inicio, CONTRATO.fin), CONTRATO, "completo", "", ""));
    expect(r).toEqual({ inicio: "2026-09-01", corte: "2026-09-30", dias: 30, valor: HONORARIO });
  });

  it("primer mes parcial de un contrato que empieza el 16/01: 15 días", () => {
    const r = ok(periodoElegido(mesDe("2026-01", CONTRATO_16.inicio, CONTRATO_16.fin), CONTRATO_16, "completo", "", ""));
    expect(r).toEqual({ inicio: "2026-01-16", corte: "2026-01-30", dias: 15, valor: Math.round((HONORARIO * 15) / 30) });
  });

  it("ignora Del y Al aunque vengan escritos", () => {
    const r = ok(periodoElegido(mesDe("2026-09", CONTRATO.inicio, CONTRATO.fin), CONTRATO, "completo", "2026-09-05", "2026-09-10"));
    expect(r.dias).toBe(30);
  });
});

describe("periodoElegido: solo unos días", () => {
  const sep = mesDe("2026-09", CONTRATO.inicio, CONTRATO.fin);

  it("un rango dentro del mes cuenta los días y el valor", () => {
    const r = ok(periodoElegido(sep, CONTRATO, "dias", "2026-09-01", "2026-09-10"));
    expect(r).toEqual({ inicio: "2026-09-01", corte: "2026-09-10", dias: 10, valor: Math.round((HONORARIO * 10) / 30) });
  });

  it("mes de 31 días: llegar al 31 cuenta como 30", () => {
    const mes = mesDe("2026-03", CONTRATO.inicio, CONTRATO.fin);
    const r = ok(periodoElegido(mes, CONTRATO, "dias", "2026-03-01", "2026-03-31"));
    expect(r.dias).toBe(30);
    expect(r.valor).toBe(HONORARIO);
  });

  it("mes de 31 días: del 16 al 31 son 15 días", () => {
    const mes = mesDe("2026-03", CONTRATO.inicio, CONTRATO.fin);
    expect(ok(periodoElegido(mes, CONTRATO, "dias", "2026-03-16", "2026-03-31")).dias).toBe(15);
  });

  it("febrero hasta el último día cuenta 30", () => {
    const mes = mesDe("2026-02", CONTRATO.inicio, CONTRATO.fin);
    const r = ok(periodoElegido(mes, CONTRATO, "dias", "2026-02-01", "2026-02-28"));
    expect(r.dias).toBe(30);
    expect(r.valor).toBe(HONORARIO);
  });

  it("un solo día es válido (Del = Al)", () => {
    expect(ok(periodoElegido(sep, CONTRATO, "dias", "2026-09-15", "2026-09-15")).dias).toBe(1);
  });

  it("fuera del contrato: antes del inicio es un error en Del", () => {
    const ene = mesDe("2026-01", CONTRATO_16.inicio, CONTRATO_16.fin);
    const r = periodoElegido(ene, CONTRATO_16, "dias", "2026-01-10", "2026-01-20");
    expect(esError(r) && r.campo).toBe("del");
    expect(esError(r) && r.error).toMatch(/antes de que empezara tu contrato/);
  });

  it("fuera del contrato: después del fin es un error en Al", () => {
    const corto = { inicio: "2026-01-01", fin: "2026-09-20", honorario: HONORARIO };
    const r = periodoElegido(mesDe("2026-09", corto.inicio, corto.fin), corto, "dias", "2026-09-10", "2026-09-25");
    expect(esError(r) && r.campo).toBe("al");
    expect(esError(r) && r.error).toMatch(/después de que terminara tu contrato/);
  });

  it("Al antes de Del es un error", () => {
    const r = periodoElegido(sep, CONTRATO, "dias", "2026-09-20", "2026-09-10");
    expect(esError(r) && r.campo).toBe("al");
    expect(esError(r) && r.error).toMatch(/no puede ser antes/);
  });

  it("otro mes distinto al que se cobra es un error", () => {
    const r = periodoElegido(sep, CONTRATO, "dias", "2026-08-20", "2026-09-10");
    expect(esError(r) && r.campo).toBe("del");
    expect(esError(r) && r.error).toMatch(/Septiembre 2026/);
  });

  it("campos vacíos o fechas imposibles piden escoger", () => {
    const a = periodoElegido(sep, CONTRATO, "dias", "", "2026-09-10");
    expect(esError(a) && a.campo).toBe("del");
    const b = periodoElegido(sep, CONTRATO, "dias", "2026-09-01", "");
    expect(esError(b) && b.campo).toBe("al");
    const c = periodoElegido(sep, CONTRATO, "dias", "2026-09-31", "2026-09-10");
    expect(esError(c) && c.campo).toBe("del");
  });

  it("los mensajes están en español sencillo: sin flechas ni mayúsculas sostenidas", () => {
    const r = periodoElegido(sep, CONTRATO, "dias", "2026-09-20", "2026-09-10");
    const texto = esError(r) ? r.error : "";
    expect(texto).not.toMatch(/→/);
    expect(texto).not.toBe(texto.toUpperCase());
  });
});

describe("limitesDelMes", () => {
  it("el mes entero si el contrato lo cubre", () => {
    expect(limitesDelMes("2026-03", CONTRATO)).toEqual({ min: "2026-03-01", max: "2026-03-31" });
    expect(limitesDelMes("2026-02", CONTRATO)).toEqual({ min: "2026-02-01", max: "2026-02-28" });
  });

  it("se recorta al inicio y al fin del contrato", () => {
    expect(limitesDelMes("2026-01", CONTRATO_16).min).toBe("2026-01-16");
    expect(limitesDelMes("2026-09", { inicio: "2026-01-01", fin: "2026-09-20" }).max).toBe("2026-09-20");
  });
});

describe("eleccion y motivo", () => {
  it("al marcar «Solo unos días» las fechas arrancan en las del mes", () => {
    const mes = mesDe("2026-01", CONTRATO_16.inicio, CONTRATO_16.fin);
    expect(eleccionSoloDias(mes)).toEqual({ opcion: "dias", del: "2026-01-16", al: "2026-01-30", motivo: "" });
    expect(MES_COMPLETO.opcion).toBe("completo");
  });

  const sep = mesDe("2026-09", CONTRATO.inicio, CONTRATO.fin);

  it("el motivo viaja con los días ya contados, nunca escritos a mano", () => {
    const e = periodoElegido(sep, CONTRATO, "dias", "2026-09-01", "2026-09-10");
    expect(diasManualDeMotivo("dias", e, "  licencia   no remunerada ")).toEqual({ dias: "10", motivo: "licencia no remunerada" });
  });

  it("sin motivo, con el mes completo o con fechas malas no se manda nada", () => {
    const bueno = periodoElegido(sep, CONTRATO, "dias", "2026-09-01", "2026-09-10");
    expect(diasManualDeMotivo("dias", bueno, "   ")).toBeNull();
    expect(diasManualDeMotivo("completo", periodoElegido(sep, CONTRATO, "completo", "", ""), "licencia")).toBeNull();
    expect(diasManualDeMotivo("dias", periodoElegido(sep, CONTRATO, "dias", "2026-09-20", "2026-09-10"), "licencia")).toBeNull();
  });
});
