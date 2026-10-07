import Contratista from "@/components/Contratista";

export default function Home() {
  return (
    <>
      <header className="top">
        <div className="marca">Hospital Mental de Antioquia · HOMO</div>
        <h1>Tu cuenta de cobro</h1>
      </header>
      <Contratista />
      <p className="pie">Si algo no funciona, habla con tu supervisor.</p>
    </>
  );
}
