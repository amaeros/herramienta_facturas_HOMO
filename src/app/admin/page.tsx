import ConSesion from "@/components/admin/ConSesion";
import Entrada from "@/components/admin/Entrada";

// /admin: el contenedor pide la contraseña; cuando ya hay sesión, esta pantalla manda a "Cuentas del mes".
export default function AdminInicio() {
  return (
    <ConSesion>
      <Entrada />
    </ConSesion>
  );
}
