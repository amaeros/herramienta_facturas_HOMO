import { MESES, pad2 } from "./formato";

/** Años que se ofrecen: el del mes que se cobra, uno antes y uno después (y el que venga leído, si es otro). */
export function aniosOpciones(mesKey: string, extra?: string): string[] {
  const y = Number(mesKey.slice(0, 4));
  const lista: string[] = [];
  if (y) for (let a = y - 1; a <= y + 1; a++) lista.push(String(a));
  if (extra && /^\d{4}$/.test(extra) && !lista.includes(extra)) lista.push(extra);
  return lista.sort();
}

interface Props {
  idMes: string;
  idAnio: string;
  mesKey: string;
  mes: string; // '01'..'12' o ''
  anio: string; // 'AAAA' o ''
  onMes: (v: string) => void;
  onAnio: (v: string) => void;
}

/** Dos listas: mes y año cotizado. */
export default function SelectorPeriodo({ idMes, idAnio, mesKey, mes, anio, onMes, onAnio }: Props) {
  return (
    <div className="dos">
      <select id={idMes} aria-label="Mes cotizado" value={mes} onChange={(e) => onMes(e.target.value)}>
        <option value="">Mes…</option>
        {MESES.map((n, i) => (
          <option key={n} value={pad2(i + 1)}>{n}</option>
        ))}
      </select>
      <select id={idAnio} aria-label="Año cotizado" value={anio} onChange={(e) => onAnio(e.target.value)}>
        <option value="">Año…</option>
        {aniosOpciones(mesKey, anio).map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
    </div>
  );
}
