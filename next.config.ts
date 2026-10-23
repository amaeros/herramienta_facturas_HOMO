import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: {
    // la plantilla oficial de la factura se lee del disco en las rutas de la API
    "/api/**": ["./src/assets/plantilla_factura.xlsx"],
    // el PDF de la cuenta de cobro también lee las fuentes (Liberation Sans y Carlito) y la plantilla
    "/api/factura/**": ["./src/assets/plantilla_factura.xlsx", "./src/assets/fuentes/*.ttf"],
  },
};

export default nextConfig;
