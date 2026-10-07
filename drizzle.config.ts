import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` crea la migración SQL en ./drizzle (no necesita base de datos).
// `npm run db:migrate` la aplica en Neon: define DATABASE_URL en el entorno (nunca en el repo).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
