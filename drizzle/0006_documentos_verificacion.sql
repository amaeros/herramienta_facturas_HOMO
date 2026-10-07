CREATE TABLE "documentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"contrato_id" integer NOT NULL,
	"tipo" text NOT NULL,
	"nombre_archivo" text NOT NULL,
	"archivo" text NOT NULL,
	"campos" jsonb NOT NULL,
	"notas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subido" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contratos" ADD COLUMN "verificada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_contrato_id_contratos_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documentos_contrato_idx" ON "documentos" USING btree ("contrato_id");