import { defineConfig } from 'vitest/config';

// Cada archivo de prueba del servidor levanta su propia base pglite (WASM + migraciones). Con varios archivos en
// paralelo en un PC modesto eso pasa de los 10 s por defecto, así que se da más margen.
export default defineConfig({
  test: {
    hookTimeout: 90_000,
    testTimeout: 30_000,
  },
});
