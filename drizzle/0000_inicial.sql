CREATE TABLE "cargas" (
	"id" serial PRIMARY KEY NOT NULL,
	"contrato_id" integer NOT NULL,
	"mes" text NOT NULL,
	"fecha_inicio" date NOT NULL,
	"fecha_corte" date NOT NULL,
	"planilla_numero" text DEFAULT '' NOT NULL,
	"planilla_mes" text DEFAULT '' NOT NULL,
	"ss_declarada" integer,
	"adicionales" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dias_manual" integer,
	"motivo_novedad" text DEFAULT '' NOT NULL,
	"doc_num" integer NOT NULL,
	"dias" integer NOT NULL,
	"valor" integer NOT NULL,
	"acumulado" integer DEFAULT 0 NOT NULL,
	"pct" double precision DEFAULT 0 NOT NULL,
	"ss_esperada" integer,
	"desglose" text DEFAULT '' NOT NULL,
	"estado" text NOT NULL,
	"mensaje" text DEFAULT '' NOT NULL,
	"lectura" text NOT NULL,
	"archivo_planilla" text DEFAULT '' NOT NULL,
	"observacion" text DEFAULT '' NOT NULL,
	"aprobado" boolean DEFAULT false NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargas_contrato_mes_uq" UNIQUE("contrato_id","mes")
);
--> statement-breakpoint
CREATE TABLE "contratos" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"cedula" text DEFAULT '' NOT NULL,
	"direccion" text DEFAULT '' NOT NULL,
	"telefono" text DEFAULT '' NOT NULL,
	"ciudad" text DEFAULT '' NOT NULL,
	"cargo" text DEFAULT '' NOT NULL,
	"numero_contrato" text DEFAULT '' NOT NULL,
	"objeto" text DEFAULT '' NOT NULL,
	"inicio" date,
	"fin" date,
	"honorario" integer,
	"valor_total" integer,
	"riesgo" text DEFAULT 'I' NOT NULL,
	"riesgo_nuevo" text DEFAULT '' NOT NULL,
	"riesgo_desde" date,
	"reviso_nombre" text DEFAULT '' NOT NULL,
	"reviso_cargo" text DEFAULT '' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"correo" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intentos_pin" (
	"clave" text PRIMARY KEY NOT NULL,
	"fallos" integer DEFAULT 0 NOT NULL,
	"ultimo_fallo" timestamp with time zone,
	"bloqueado_hasta" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lecturas" (
	"temp_id" uuid PRIMARY KEY NOT NULL,
	"contrato_id" integer NOT NULL,
	"archivo" text NOT NULL,
	"tipo" text NOT NULL,
	"lectura" jsonb NOT NULL,
	"leyo" boolean DEFAULT false NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parametros" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"pct_ibc" double precision NOT NULL,
	"salud" double precision NOT NULL,
	"pension" double precision NOT NULL,
	"smmlv" integer NOT NULL,
	"ibc_piso_mult" double precision NOT NULL,
	"ibc_techo_mult" double precision NOT NULL,
	"arl" jsonb NOT NULL,
	"enviar_correo" boolean DEFAULT false NOT NULL,
	"correo_supervisor" text DEFAULT '' NOT NULL,
	"tolerancia_ss" integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cargas" ADD CONSTRAINT "cargas_contrato_id_contratos_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturas" ADD CONSTRAINT "lecturas_contrato_id_contratos_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lecturas_creado_idx" ON "lecturas" USING btree ("creado");

--> statement-breakpoint
INSERT INTO "parametros" ("id", "pct_ibc", "salud", "pension", "smmlv", "ibc_piso_mult", "ibc_techo_mult", "arl", "enviar_correo", "correo_supervisor", "tolerancia_ss")
VALUES (1, 0.4, 0.125, 0.16, 1750905, 1, 25, '{"I": 0.00522, "II": 0.01044, "III": 0.02436, "IV": 0.0435, "V": 0.0696}'::jsonb, false, '', 100)
ON CONFLICT ("id") DO NOTHING;