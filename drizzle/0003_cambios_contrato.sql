CREATE TABLE "cambios_contrato" (
	"id" serial PRIMARY KEY NOT NULL,
	"contrato_id" integer NOT NULL,
	"autor" text NOT NULL,
	"campo" text NOT NULL,
	"antes" text DEFAULT '' NOT NULL,
	"despues" text DEFAULT '' NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cambios_contrato" ADD CONSTRAINT "cambios_contrato_contrato_id_contratos_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cambios_contrato_contrato_idx" ON "cambios_contrato" USING btree ("contrato_id");--> statement-breakpoint
CREATE INDEX "cambios_contrato_creado_idx" ON "cambios_contrato" USING btree ("creado");