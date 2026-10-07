"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import css from "./admin.module.css";

// Con sesión iniciada, /admin lleva directo a las cuentas del mes.
export default function Entrada() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/cuentas");
  }, [router]);
  return (
    <div className={css.cargandoCaja} role="status">
      Entrando…
    </div>
  );
}
