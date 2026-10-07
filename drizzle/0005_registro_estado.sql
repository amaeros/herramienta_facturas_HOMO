ALTER TABLE "contratos" ADD COLUMN "estado" text DEFAULT 'activa' NOT NULL;
--> statement-breakpoint
-- Las cuentas que ya existian quedan activas; las solicitudes de registro nuevas nacen pendientes.
UPDATE "contratos" SET "estado" = 'activa';
