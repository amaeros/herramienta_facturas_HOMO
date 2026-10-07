import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // la plantilla oficial de la factura se lee del disco en las rutas de la API
  outputFileTracingIncludes: { "/api/**": ["./src/assets/plantilla_factura.xlsx"] },
};

export default nextConfig;
