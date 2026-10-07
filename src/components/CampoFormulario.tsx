"use client";

export interface CampoFormularioProps {
  /** id del input; la ayuda y el error cuelgan de él (`<id>-ayuda`, `<id>-error`). */
  id: string;
  etiqueta: string;
  valor: string;
  error?: string;
  ayuda?: string;
  opcional?: boolean;
  tipo?: "text" | "tel" | "email" | "date" | "dinero" | "area";
  autoComplete?: string;
  maxLength?: number;
  onCambio: (v: string) => void;
  onSalida?: () => void;
}

/** Campo de la hoja de la contratista: etiqueta con * (o "(opcional)"), ayuda debajo de la etiqueta y error en rojo bajo el campo. */
export default function CampoFormulario({
  id, etiqueta, valor, error, ayuda, opcional, tipo = "text", autoComplete = "off", maxLength, onCambio, onSalida,
}: CampoFormularioProps) {
  const descritoPor = [ayuda ? id + "-ayuda" : "", error ? id + "-error" : ""].filter(Boolean).join(" ") || undefined;
  const comunes = {
    id,
    value: valor,
    maxLength,
    autoComplete,
    "aria-invalid": error ? true : undefined,
    "aria-required": opcional ? undefined : true,
    "aria-describedby": descritoPor,
    onBlur: onSalida,
  } as const;
  return (
    <div className="campo">
      <label htmlFor={id}>
        {etiqueta}
        {opcional ? <span className="nota-campo"> (opcional)</span> : <span className="marca-obligatorio" aria-hidden="true"> *</span>}
      </label>
      {ayuda && <p id={id + "-ayuda"} className="ayuda ayuda-campo">{ayuda}</p>}
      {tipo === "area" ? (
        <textarea {...comunes} rows={5} onChange={(e) => onCambio(e.target.value)} />
      ) : (
        <input
          {...comunes}
          type={tipo === "dinero" ? "text" : tipo}
          inputMode={tipo === "dinero" ? "numeric" : tipo === "tel" ? "tel" : tipo === "email" ? "email" : undefined}
          onChange={(e) => onCambio(e.target.value)}
        />
      )}
      {error && <p id={id + "-error"} className="error-campo">{error}</p>}
    </div>
  );
}
