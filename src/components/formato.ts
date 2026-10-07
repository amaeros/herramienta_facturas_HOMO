/** Utilidades de formato y lectura de números (réplica de las de legacy/apps-script/Index.html). */

export const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
  "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function pad2(n: number): string {
  return (n < 10 ? "0" : "") + n;
}

/** 7174000 -> '$7.174.000'; vacío o inválido -> '—'. */
export function fmtMoney(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "" || isNaN(Number(n))) return "—";
  let s = String(Math.round(Math.abs(Number(n))));
  let out = "";
  while (s.length > 3) {
    out = "." + s.slice(-3) + out;
    s = s.slice(0, -3);
  }
  return "$" + s + out;
}

/** Igual que fmtMoney pero sin el signo $ y '' si no hay valor (para los campos de texto). */
export function dinero(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : fmtMoney(n).replace("$", "");
}

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA'. */
export function fmtFecha(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  return m ? m[3] + "/" + m[2] + "/" + m[1] : "—";
}

/** 'AAAA-MM' -> 'Septiembre 2026'. */
export function labelMes(k: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(k || "");
  return m && MESES[Number(m[2]) - 1] ? MESES[Number(m[2]) - 1] + " " + m[1] : "—";
}

export function tituloNombre(s: string): string {
  return String(s).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** Lee un valor escrito por la persona ('358.700', '$ 358,700', '70000'). null si no es un número válido. */
export function soloNumero(s: string | number | null | undefined): number | null {
  const t = String(s === null || s === undefined ? "" : s).replace(/[$\s]/g, "");
  if (!t) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  if (/^\d{1,3}([.,]\d{3})+[.,]\d{1,2}$/.test(t)) return Number(t.replace(/[.,]\d{1,2}$/, "").replace(/[.,]/g, ""));
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d+[.,]\d{1,2}$/.test(t)) return Math.round(Number(t.replace(",", ".")));
  return null;
}
