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
| `cambios_contrato` | id, contrato_id (FK, **borra en cascada**), autor ('contratista'/'admin'), campo (camelCase: 'inicio', 'fin', 'revisoNombre', 'revisoCargo'...), antes, despues (texto ya legible: fechas DD/MM/AAAA, dinero `$7.174.000`, vacío = `(vacío)`), creado (timestamptz). Bitácora de cambios al contrato; nunca guarda datos personales |

Valores por defecto de `parametros` = los de PARAMETROS de la hoja (ver `legacy/apps-script/CONTRATO_DATOS.md`).

## Sesiones

- Contratista: `POST /api/login` con nombre + PIN (últimos 4 de la cédula; nombre sin tildes/mayúsculas). Ok → cookie `sesion` httpOnly, Secure, SameSite=Lax, firmada con HMAC-SHA256 (`SESSION_SECRET`), con `{contratoId, exp}` y 2 h de vida.
- Límite: 5 fallos por nombre en 10 min → bloqueado 10 min, incluso con el PIN correcto. Un acierto limpia el contador.
- Las rutas de contratista leen la cookie; sin sesión válida → 401 `{ok:false, error:'Tu sesión venció. Vuelve a entrar.'}`.
- Admin (fase 3): `ADMIN_PASSWORD` en variables de entorno, cookie `admin` aparte.

## Archivos (Vercel Blob, `access: 'private'`)

- Ruta: `planillas/<contratoId>/<AAAA-MM>/<uuid>-<nombre limpio>`. Nunca se devuelve la URL del blob a la contratista.
- La factura .xlsx **no se guarda**: se genera al vuelo desde la fila de `cargas`. Los datos del contrato que usa la factura (nombre, cédula, n.º de contrato, objeto, valor total, riesgo vigente, etc.) se congelan al enviar en `cargas.contrato_snapshot` (jsonb), así un otrosí (editar `fin` y `valor_total` del contrato) no cambia las cuentas ya enviadas. Reenviar el mismo mes refresca la foto. Cuentas viejas sin foto (`null`) usan el contrato actual.
- Otrosí = prórroga + adición del mismo contrato: el supervisor edita solo `fin` y `valor_total` (el inicio no cambia; el acumulado sigue sumando desde el inicio). `recalcularAcumulados` solo toca las cargas cuyo mes está dentro de [inicio, fin] vigente.
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
| `GET /api/mi-contrato` | cookie | `datos:{inicio, fin, revisoNombre, revisoCargo}` (fechas `AAAA-MM-DD`, o `''` si el contrato aún no las tiene) |
| `PUT /api/mi-contrato` | cookie + `{inicio?, fin?, revisoNombre?, revisoCargo?}` | `datos` (lo guardado) + `contrato: Resumen` (para refrescar la lista de meses) |
| `POST /api/evaluar` | `{mes, fechaInicio, fechaCorte, datos:{numero, periodo, salud, pension, arl}, adicionales:[{numero, periodo, valor, tempId}], diasManual:{dias, motivo}\|null}` | `evaluacion` (= `Calc.evaluate`) — no guarda nada |
| `POST /api/planilla` | multipart: `archivo` (File), `texto` (texto que extrajo pdf.js en el navegador, puede venir vacío), `mes`, `fechaInicio`, `fechaCorte`, `adicionales` (JSON), `diasManual` (JSON), `adicional` ('1' si es planilla adicional) | `tempId, leyo, confianza, tipoDoc, fuente:'navegador'\|'ninguna', notas[], lectura:{numero, periodo, salud, pension, arl}, evaluacion\|null, valor\|null` |
| `POST /api/enviar` | `{mes, fechaInicio, fechaCorte, datos, tempId, adicionales, diasManual}` | `estado, estadoTexto, emoji, mensaje, factura:{nombre, url}` (url = `/api/factura/<cargaId>`) |
| `GET /api/factura/[id]` | cookie de la contratista dueña (o admin) | el .xlsx (`Content-Disposition: attachment`) |

`Resumen` = `{nombre, numeroContrato, honorario, inicio, fin, riesgo, meses:[{key, label, inicio, corte, dias, valor, enviado}], mesDefault}` (igual que `resumenContrato_` del legacy; `enviado` = estadoTexto de la carga de ese mes o '').

### Mi contrato (`/api/mi-contrato`)

La contratista edita **solo 4 campos de su propio contrato**: fecha de inicio, fecha de fin, "Revisó (nombre)" y "Revisó (cargo)". Todo lo demás (honorario, valor total, riesgo, n.º de contrato, nombre, cédula...) lo cambia solo el supervisor: si llega en el cuerpo, **se ignora** sin error.

- `PUT` solo mira las 4 claves en camelCase; lo que no viene se conserva. Si no viene ninguna de las 4 → 400 `No hay nada que guardar.`
- Validación (todos los errores juntos): `inicio`/`fin` texto `AAAA-MM-DD` real y **no vacíos** si se mandan; `fin >= inicio` (si solo viene uno, se compara con el guardado); `revisoNombre`/`revisoCargo` texto, recortado, máx. 120 caracteres (puede quedar vacío).
- Error: `400 {ok:false, error, campos:{ inicio?, fin?, revisoNombre?, revisoCargo? }}` (`error` = el primer mensaje). Sin sesión, o contrato desactivado → `401 {ok:false, error:'Tu sesión venció. Vuelve a entrar.'}`.
- Escribe **una fila de `cambios_contrato` por campo que de verdad cambió** (mandar el mismo valor no anota nada), y corre `recalcularAcumulados` (acumulado/% de las cargas dentro del nuevo periodo; el valor de cada mes no se re-evalúa). Las cuentas ya enviadas conservan su `contrato_snapshot`.
- La edición del admin (`PUT /api/admin/contratos/[id]`) también anota sus cambios, con `autor:'admin'` (los 4 campos y además n.º de contrato, objeto, honorario, valor total, riesgo, riesgo nuevo/desde y activa; nunca cédula, dirección, teléfono ni correo).
- El supervisor los ve en `GET /api/admin/cambios` (ver `docs/ADMIN.md`).

Reglas de `/api/planilla` y `/api/enviar`: copiar la lógica de `api_leerPlanilla` / `procesarEnvio_` del legacy:
texto del navegador si tiene ≥150 caracteres (si no, `fuente:'ninguna'` y la contratista escribe los datos a mano; **no hay OCR**);
confianza 'baja' → `lectura` en blanco; `lectura` de la carga = auto / corregido / manual; el servidor **re-evalúa** antes de guardar y solo rechaza si `bloquea`;
acumulado y % se recalculan para todas las cargas del contrato; planillas repetidas = números de planilla de otras cargas (todas las contratistas) menos la misma contratista+mes.

## Variables de entorno

`DATABASE_URL` (Neon), `BLOB_READ_WRITE_TOKEN` (Blob), `SESSION_SECRET` (32+ caracteres aleatorios), `ADMIN_PASSWORD` (fase 3), `RESEND_API_KEY` (fase 3).
