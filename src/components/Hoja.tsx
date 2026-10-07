import type { ReactNode } from "react";
import { fmtFecha, fmtMoney, labelMes } from "./formato";
import { fraseEstado, type ClaseEstado } from "./Semaforo";

/** Lo que la hoja sabe hasta ahora. Todo lo que falta se dibuja como una raya. */
export interface HojaDatos {
  /** AAAAMM del mes cobrado (n.º del documento) */
  docNum?: string;
  nombre?: string;
  /** AAAA-MM-DD */
  inicio?: string;
  corte?: string;
  dias?: number | null;
  valor?: number | null;
  planilla?: string | null;
  /** AAAA-MM */
  mesCotizado?: string | null;
  salud?: number | null;
  pension?: number | null;
  arl?: number | null;
  /** undefined = todavía no hay revisión y la fila no se muestra; null = revisión pendiente */
  estado?: ClaseEstado | null;
  /** la cuenta ya se generó: aparece el sello */
  completa?: boolean;
  /** se está leyendo o generando: barrido suave en los renglones vacíos */
  cargando?: boolean;
}

function Raya() {
  return (
    <span className="raya">
      <span className="solo-lectura">Sin dato</span>
    </span>
  );
}

function Fila({ etiqueta, children, clase }: { etiqueta: string; children: ReactNode; clase?: string }) {
  return (
    <div className={"hoja-fila" + (clase ? " " + clase : "")}>
      <dt>{etiqueta}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * La "hoja": una vista previa del formato oficial GJ-CO-FR-15 que se va llenando a medida que la persona avanza.
 * Solo muestra datos; no tiene estado propio.
 */
export default function Hoja(d: HojaDatos) {
  const periodo = d.inicio && d.corte ? fmtFecha(d.inicio) + " – " + fmtFecha(d.corte) : null;
  const tieneSs = d.salud != null && d.pension != null && d.arl != null;
  const totalSs = tieneSs ? (d.salud as number) + (d.pension as number) + (d.arl as number) : null;
  const hayDetalleSs = d.salud != null || d.pension != null || d.arl != null;

  return (
    <article
      className={"hoja" + (d.cargando ? " cargando" : "") + (d.completa ? " completa" : "")}
      aria-label="Vista previa de tu cuenta de cobro"
    >
      <header className="hoja-cab">
        <h3 className="hoja-titulo">
          Cuenta de cobro <span className="cifra">{d.docNum ?? ""}</span>
        </h3>
        {d.nombre && <p className="hoja-nombre">{d.nombre}</p>}
      </header>

      <dl className="hoja-filas">
        <Fila etiqueta="Periodo">
          {periodo ? <span className="cifra">{periodo}</span> : <Raya />}
        </Fila>
        <Fila etiqueta="Valor" clase="hoja-fila-valor">
          {d.valor != null ? (
            <>
              <span className="cifra">{fmtMoney(d.valor)}</span>
              {d.dias != null && <span className="hoja-detalle">{d.dias} días</span>}
            </>
          ) : (
            <Raya />
          )}
        </Fila>
        <Fila etiqueta="Planilla">{d.planilla ? <span className="cifra">{d.planilla}</span> : <Raya />}</Fila>
        <Fila etiqueta="Mes cotizado">
          {d.mesCotizado ? <span>{labelMes(d.mesCotizado)}</span> : <Raya />}
        </Fila>
        <Fila etiqueta="Seguridad social">
          {totalSs != null ? <span className="cifra">{fmtMoney(totalSs)}</span> : <Raya />}
        </Fila>
        {hayDetalleSs && (
          <>
            <Fila etiqueta="Salud" clase="hoja-sub">{d.salud != null ? <span className="cifra">{fmtMoney(d.salud)}</span> : <Raya />}</Fila>
            <Fila etiqueta="Pensión" clase="hoja-sub">{d.pension != null ? <span className="cifra">{fmtMoney(d.pension)}</span> : <Raya />}</Fila>
            <Fila etiqueta="ARL" clase="hoja-sub">{d.arl != null ? <span className="cifra">{fmtMoney(d.arl)}</span> : <Raya />}</Fila>
          </>
        )}
        {d.estado !== undefined && (
          <Fila etiqueta="Revisión">
            {d.estado && d.estado !== "gris" ? (
              <span className={"hoja-revision " + d.estado}>{fraseEstado(d.estado)}</span>
            ) : (
              <Raya />
            )}
          </Fila>
        )}
      </dl>

      <p className="hoja-pie">GJ-CO-FR-15 v02</p>
      {d.completa && (
        <div className="sello" role="img" aria-label="Lista para descargar">
          <span aria-hidden="true">Lista para descargar</span>
        </div>
      )}
    </article>
  );
}
