import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

// Una sola familia, pensada para leerse bien en pantallas pequeñas y con prisa. Pesos 400, 600 y 700.
const fuente = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--fuente",
});

export const metadata: Metadata = {
  title: "Cuenta de cobro HOMO",
  description: "Genera tu cuenta de cobro del Hospital Mental de Antioquia subiendo tu planilla de seguridad social.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={fuente.variable}>
      <body>{children}</body>
    </html>
  );
}
