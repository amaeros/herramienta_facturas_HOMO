/** "¿Dónde encuentro cada dato en mi planilla?": dibujo de ejemplo y leyenda. */
export default function AyudaPlanilla({ abierta }: { abierta: boolean }) {
  return (
    <details open={abierta}>
      <summary>¿Dónde encuentro cada dato en mi planilla?</summary>
      <svg viewBox="0 0 320 250" role="img" aria-label="Dibujo de ejemplo de una planilla con los datos señalados">
        <rect x="6" y="6" width="308" height="238" rx="8" fill="#fafafa" stroke="#9fb2a8" />
        <rect x="16" y="16" width="150" height="16" rx="3" fill="#dfe8e3" />
        <text x="22" y="28" fontSize="10" fill="#3a4640">PLANILLA INTEGRADA DE LIQUIDACIÓN</text>
        <rect x="196" y="14" width="112" height="24" rx="4" fill="#fff3c4" stroke="#d9a400" strokeWidth="2" />
        <text x="202" y="24" fontSize="8" fill="#5a4000">N.º de planilla / Clave</text>
        <text x="202" y="34" fontSize="10" fill="#5a4000" fontWeight="bold">9509633245</text>
        <circle cx="188" cy="26" r="9" fill="#0b5640" /><text x="184.5" y="30" fontSize="11" fill="#fff" fontWeight="bold">1</text>
        <rect x="16" y="52" width="180" height="26" rx="4" fill="#fff3c4" stroke="#d9a400" strokeWidth="2" />
        <text x="22" y="63" fontSize="8" fill="#5a4000">Periodo de pago (salud y pensión)</text>
        <text x="22" y="74" fontSize="10" fill="#5a4000" fontWeight="bold">2026-09  Septiembre</text>
        <circle cx="208" cy="65" r="9" fill="#0b5640" /><text x="204.5" y="69" fontSize="11" fill="#fff" fontWeight="bold">2</text>
        <rect x="16" y="98" width="288" height="16" fill="#dfe8e3" />
        <text x="22" y="110" fontSize="9" fill="#3a4640">Subsistema</text><text x="150" y="110" fontSize="9" fill="#3a4640">Valor liquidado</text>
        <rect x="16" y="120" width="288" height="18" fill="#fff3c4" stroke="#d9a400" strokeWidth="2" />
        <text x="22" y="133" fontSize="10" fill="#5a4000">Salud (EPS)</text><text x="222" y="133" fontSize="10" fill="#5a4000" fontWeight="bold">$ 358.700</text>
        <circle cx="292" cy="129" r="9" fill="#0b5640" /><text x="288.5" y="133" fontSize="11" fill="#fff" fontWeight="bold">3</text>
        <rect x="16" y="142" width="288" height="18" fill="#fff3c4" stroke="#d9a400" strokeWidth="2" />
        <text x="22" y="155" fontSize="10" fill="#5a4000">Pensión (AFP)</text><text x="222" y="155" fontSize="10" fill="#5a4000" fontWeight="bold">$ 459.200</text>
        <circle cx="292" cy="151" r="9" fill="#0b5640" /><text x="288.5" y="155" fontSize="11" fill="#fff" fontWeight="bold">4</text>
        <rect x="16" y="164" width="288" height="18" fill="#fff3c4" stroke="#d9a400" strokeWidth="2" />
        <text x="22" y="177" fontSize="10" fill="#5a4000">Riesgos laborales (ARL)</text><text x="222" y="177" fontSize="10" fill="#5a4000" fontWeight="bold">$ 70.000</text>
        <circle cx="292" cy="173" r="9" fill="#0b5640" /><text x="288.5" y="177" fontSize="11" fill="#fff" fontWeight="bold">5</text>
        <rect x="16" y="186" width="288" height="18" fill="#f1f1f1" />
        <text x="22" y="199" fontSize="10" fill="#8a8a8a">Caja de compensación · intereses de mora (no van)</text>
        <text x="16" y="228" fontSize="9" fill="#5c6b65">Ejemplo: tu planilla puede verse distinta, busca las mismas palabras.</text>
      </svg>
      <ol className="leyenda">
        <li><strong>N.º de planilla:</strong> arriba, dice «Número de planilla», «Planilla n.º» o «Clave».</li>
        <li><strong>Mes cotizado:</strong> «Periodo de pago» o «Periodo de cotización» de salud y pensión.</li>
        <li><strong>Salud, pensión y ARL:</strong> el valor liquidado de cada uno, sin caja de compensación ni intereses de mora.</li>
      </ol>
    </details>
  );
}
