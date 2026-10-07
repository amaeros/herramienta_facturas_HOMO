"use client";

import css from "./admin.module.css";

export interface CampoAdminProps {
  /** Nombre del campo: el id del input es `<prefijo><campo>` (por defecto `f-`). */
  campo: string;
  prefijo?: string;
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  error?: string;
  tipo?: "text" | "date" | "email" | "tel";
  hint?: string;
  opcional?: boolean;
  inputMode?: "numeric" | "text" | "email" | "tel";
  /** Símbolo pegado al inicio del campo (por ejemplo "$"). */
  simbolo?: string;
  ancho?: boolean;
  area?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
  autoComplete?: string;
}

/** Campo del panel del supervisor: etiqueta, ayuda y error junto al campo. */
export default function CampoAdmin(p: CampoAdminProps) {
  const id = (p.prefijo ?? "f-") + p.campo;
  const idError = id + "-error";
  const idHint = id + "-hint";
  const describe = [p.error ? idError : "", p.hint ? idHint : ""].filter(Boolean).join(" ") || undefined;
  const comunes = {
    id,
    value: p.valor,
    disabled: p.disabled,
    "aria-invalid": p.error ? true : undefined,
    "aria-describedby": describe,
  } as const;
  return (
    <div className={`${css.campo} ${p.ancho ? css.ancho : ""}`}>
      <label className={css.etiqueta} htmlFor={id}>
        {p.etiqueta} {p.opcional && <span className={css.opcional}>(opcional)</span>}
      </label>
      {p.area ? (
        <textarea
          {...comunes}
          className={`${css.area} ${p.error ? css.invalido : ""}`}
          onChange={(e) => p.onCambio(e.target.value)}
        />
      ) : (
        <div className={p.simbolo ? css.conPrefijo : undefined} style={{ position: "relative" }}>
          {p.simbolo && <span className={css.prefijo} aria-hidden="true">{p.simbolo}</span>}
          <input
            {...comunes}
            type={p.tipo ?? "text"}
            inputMode={p.inputMode}
            autoComplete={p.autoComplete ?? "off"}
            className={`${css.texto} ${p.error ? css.invalido : ""}`}
            onChange={(e) => p.onCambio(e.target.value)}
            onBlur={p.onBlur}
          />
        </div>
      )}
      {p.hint && <p id={idHint} className={css.pista}>{p.hint}</p>}
      {p.error && <p id={idError} className={css.errorCampo} role="alert">{p.error}</p>}
    </div>
  );
}
