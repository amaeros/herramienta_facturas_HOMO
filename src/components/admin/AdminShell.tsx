"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { alVencerSesion, apiAdmin, MSG_SESION_ADMIN_VENCIDA, textoError } from "./apiAdmin";
import { YaEntroContext } from "./ConSesion";
import LoginAdmin from "./LoginAdmin";
import css from "./admin.module.css";

type Estado =
  | { tipo: "verificando" }
  | { tipo: "error"; msg: string }
  | { tipo: "fuera"; aviso?: string }
  | { tipo: "dentro" };

const ENLACES = [
  { href: "/admin/cuentas", texto: "Cuentas del mes" },
  { href: "/admin/trabajadoras", texto: "Trabajadoras" },
  { href: "/admin/parametros", texto: "Parámetros" },
];

/**
 * Envuelve todo /admin: revisa la sesión, muestra la contraseña cuando hace falta y dibuja la barra superior.
 * Si una llamada recibe 401 (sesión vencida), vuelve a pedir la contraseña sin perder lo que había en pantalla.
 */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "verificando" });
  // Las pantallas se montan la primera vez que entra y se conservan (ocultas) si la sesión vence
  const [yaEntro, setYaEntro] = useState(false);
  const [intento, setIntento] = useState(0);
  const [saliendo, setSaliendo] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let vivo = true;
    apiAdmin
      .hayEntrada()
      .then((ok) => {
        if (!vivo) return;
        if (ok) {
          setEstado({ tipo: "dentro" });
          setYaEntro(true);
        } else setEstado({ tipo: "fuera" });
      })
      .catch((e) => {
        if (vivo) setEstado({ tipo: "error", msg: textoError(e) });
      });
    return () => {
      vivo = false;
    };
  }, [intento]);

  useEffect(
    () =>
      alVencerSesion(() => {
        setEstado((prev) => (prev.tipo === "dentro" ? { tipo: "fuera", aviso: MSG_SESION_ADMIN_VENCIDA } : prev));
      }),
    [],
  );

  function entro() {
    setEstado({ tipo: "dentro" });
    setYaEntro(true);
  }

  async function salir() {
    setSaliendo(true);
    try {
      await apiAdmin.salir();
    } catch {
      /* si no se pudo avisar al servidor, igual cerramos la pantalla; la cookie vence sola a las 8 h */
    }
    setSaliendo(false);
    setYaEntro(false);
    setEstado({ tipo: "fuera" });
    router.replace("/admin");
  }

  const dentro = estado.tipo === "dentro";

  return (
    <>
      <header className={css.barra}>
        <div className={css.barraInterior}>
          <div>
            <div className={css.marca}>Hospital Mental de Antioquia · HOMO</div>
            <div className={css.marcaTitulo}>Panel del supervisor</div>
          </div>
          {dentro && (
            <nav className={css.nav} aria-label="Secciones del panel">
              {ENLACES.map((e) => {
                const activo = pathname === e.href || pathname.startsWith(e.href + "/");
                return (
                  <Link
                    key={e.href}
                    href={e.href}
                    className={`${css.navLink} ${activo ? css.navActivo : ""}`}
                    aria-current={activo ? "page" : undefined}
                  >
                    {e.texto}
                  </Link>
                );
              })}
              <button type="button" className={css.navSalir} onClick={salir} disabled={saliendo}>
                {saliendo ? "Saliendo…" : "Salir"}
              </button>
            </nav>
          )}
        </div>
      </header>

      {estado.tipo === "verificando" && (
        <div className={css.cargandoCaja} role="status">
          <span className={css.rueda} aria-hidden="true" />
          Revisando tu sesión…
        </div>
      )}

      {estado.tipo === "error" && (
        <div className={css.paginaAngosta} role="main">
          <div className="aviso error" role="alert">
            {estado.msg}
          </div>
          <button
            type="button"
            className={css.btn}
            onClick={() => {
              setEstado({ tipo: "verificando" });
              setIntento((n) => n + 1);
            }}
          >
            Intentar de nuevo
          </button>
        </div>
      )}

      {estado.tipo === "fuera" && <LoginAdmin aviso={estado.aviso} onEntrar={entro} />}

      <YaEntroContext.Provider value={yaEntro}>
        <div hidden={!dentro}>{children}</div>
      </YaEntroContext.Provider>
    </>
  );
}
