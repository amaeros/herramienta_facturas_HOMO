# Arquitectura y contrato de la API (fase 1-2)

Fuente de verdad para la pantalla (`src/app/page.tsx` + componentes) y el servidor (`src/app/api/**`, `src/server/**`).
El comportamiento replica la versión Apps Script v3.1 (`legacy/apps-script/Code.gs`, `Index.html`, `CONTRATO_DATOS.md`).

## Capas

```
src/lib/        lógica pura, sin I/O: calc.ts, parser.ts, pdfText.ts, factura.ts   (YA EXISTEN, no reescribir)
src/server/     I/O del servidor: db (drizzle), auth (sesiones, PIN), blob, servicios
src/app/api/    route handlers delgados: validan entrada → llaman a src/server → responden JSON
src/app/        pantallas: / (contratista, celular) · /admin (fase 3)
```

## Base de datos (Neon Postgres + drizzle-orm)

- Driver: `@neondatabase/serverless` (http) en producción con `DATABASE_URL`; `@electric-sql/pglite` en tests (misma definición de esquema drizzle).
- Esquema en `src/server/db/schema.ts`; migraciones SQL generadas con drizzle-kit en `drizzle/`.

| Tabla | Columnas clave |
|---|---|
| `parametros` | una sola fila (id=1): pct_ibc, salud, pension, smmlv, ibc_piso_mult, ibc_techo_mult, arl (jsonb {I..V}), enviar_correo (bool), correo_supervisor, tolerancia_ss |
| `contratos` | id, nombre, cedula (texto, solo dígitos), direccion, telefono, ciudad, cargo, numero_contrato, objeto, inicio (date), fin (date), honorario (int), valor_total (int), riesgo, riesgo_nuevo, riesgo_desde (date), reviso_nombre, reviso_cargo, activo (bool), correo |
| `cargas` | id, contrato_id, mes ('YYYY-MM'), fecha_inicio, fecha_corte, planilla_numero, planilla_mes ('YYYY-MM'), ss_declarada (int), adicionales (jsonb [{numero, mes, valor, archivo}]), dias_manual (int null), motivo_novedad, doc_num, dias, valor, acumulado, pct, ss_esperada, desglose, estado ('OK'/'REVISAR'/'ERROR'), mensaje, lectura ('auto'/'corregido'/'manual'), archivo_planilla (pathname blob), observacion, aprobado (bool), creado, actualizado. **UNIQUE (contrato_id, mes)**: reenviar el mismo mes REEMPLAZA la fila (y borra "aprobado") |
| `lecturas` | temp_id (uuid), contrato_id, archivo (pathname blob), tipo, lectura (jsonb), leyo (bool), creado. Caducan a las 6 h |
| `intentos_pin` | clave (nombre normalizado), fallos, bloqueado_hasta |

Valores por defecto de `parametros` = los de PARAMETROS de la hoja (ver `legacy/apps-script/CONTRATO_DATOS.md`).

## Sesiones

- Contratista: `POST /api/login` con nombre + PIN (últimos 4 de la cédula; nombre sin tildes/mayúsculas). Ok → cookie `sesion` httpOnly, Secure, SameSite=Lax, firmada con HMAC-SHA256 (`SESSION_SECRET`), con `{contratoId, exp}` y 2 h de vida.
- Límite: 5 fallos por nombre en 10 min → bloqueado 10 min, incluso con el PIN correcto. Un acierto limpia el contador.
- Las rutas de contratista leen la cookie; sin sesión válida → 401 `{ok:false, error:'Tu sesión venció. Vuelve a entrar.'}`.
- Admin (fase 3): `ADMIN_PASSWORD` en variables de entorno, cookie `admin` aparte.

## Archivos (Vercel Blob, `access: 'private'`)

- Ruta: `planillas/<contratoId>/<AAAA-MM>/<uuid>-<nombre limpio>`. Nunca se devuelve la URL del blob a la contratista.
- La factura .xlsx **no se guarda**: se genera al vuelo desde la fila de `cargas` (siempre coincide con los datos).
- Límite: 4 MB por archivo (el cuerpo de una función de Vercel admite ~4,5 MB). Tipos: PDF, JPG, PNG (validar magic bytes).

## Respuestas

Todas: `{ok:true, ...}` o `{ok:false, error:'mensaje amable en español'}`. Errores inesperados → mensaje genérico, sin detalles internos.

## Rutas

| Ruta | Entrada | Salida (además de ok) |
|---|---|---|
| `GET /api/contratistas` | — | `nombres: string[]` (activos, orden alfabético sin tildes) |
| `POST /api/login` | `{nombre, pin}` | `contrato: Resumen` (+ cookie) |
| `POST /api/logout` | — | — |
| `GET /api/sesion` | cookie | `contrato: Resumen` (para refrescar tras enviar) |
| `POST /api/evaluar` | `{mes, fechaInicio, fechaCorte, datos:{numero, periodo, salud, pension, arl}, adicionales:[{numero, periodo, valor, tempId}], diasManual:{dias, motivo}\|null}` | `evaluacion` (= `Calc.evaluate`) — no guarda nada |
| `POST /api/planilla` | multipart: `archivo` (File), `texto` (texto que extrajo pdf.js en el navegador, puede venir vacío), `mes`, `fechaInicio`, `fechaCorte`, `adicionales` (JSON), `diasManual` (JSON), `adicional` ('1' si es planilla adicional) | `tempId, leyo, confianza, tipoDoc, fuente:'navegador'\|'ninguna', notas[], lectura:{numero, periodo, salud, pension, arl}, evaluacion\|null, valor\|null` |
| `POST /api/enviar` | `{mes, fechaInicio, fechaCorte, datos, tempId, adicionales, diasManual}` | `estado, estadoTexto, emoji, mensaje, factura:{nombre, url}` (url = `/api/factura/<cargaId>`) |
| `GET /api/factura/[id]` | cookie de la contratista dueña (o admin) | el .xlsx (`Content-Disposition: attachment`) |

`Resumen` = `{nombre, numeroContrato, honorario, inicio, fin, riesgo, meses:[{key, label, inicio, corte, dias, valor, enviado}], mesDefault}` (igual que `resumenContrato_` del legacy; `enviado` = estadoTexto de la carga de ese mes o '').

Reglas de `/api/planilla` y `/api/enviar`: copiar la lógica de `api_leerPlanilla` / `procesarEnvio_` del legacy:
texto del navegador si tiene ≥150 caracteres (si no, `fuente:'ninguna'` y la contratista escribe los datos a mano; **no hay OCR**);
confianza 'baja' → `lectura` en blanco; `lectura` de la carga = auto / corregido / manual; el servidor **re-evalúa** antes de guardar y solo rechaza si `bloquea`;
acumulado y % se recalculan para todas las cargas del contrato; planillas repetidas = números de planilla de otras cargas (todas las contratistas) menos la misma contratista+mes.

## Variables de entorno

`DATABASE_URL` (Neon), `BLOB_READ_WRITE_TOKEN` (Blob), `SESSION_SECRET` (32+ caracteres aleatorios), `ADMIN_PASSWORD` (fase 3), `RESEND_API_KEY` (fase 3).
