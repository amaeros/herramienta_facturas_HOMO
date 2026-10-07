import Image from "next/image";
import Contratista from "@/components/Contratista";

export default function Home() {
  return (
    <div className="app">
      <header className="encabezado">
        <div className="encabezado-interior">
          <Image
            src="/homo-logo.png"
            alt="Hospital Mental de Antioquia"
            width={36}
            height={40}
            priority
            className="encabezado-logo"
          />
          <p className="encabezado-titulo">Tu cuenta de cobro</p>
        </div>
      </header>
      <Contratista />
      <p className="pie">Si algo no funciona, habla con tu supervisor.</p>
    </div>
  );
}
