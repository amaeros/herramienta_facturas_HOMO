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
| `contratos` | id, nombre, cedula (texto, solo dígitos), direccion, telefono, ciudad, cargo, numero_contrato, objeto, inicio (date), fin (date), honorario (int), valor_total (int), riesgo, riesgo_nuevo, riesgo_desde (date), reviso_nombre, reviso_cargo, activo (bool), correo, linea, **estado** ('activa' por defecto, 'pendiente' o 'rechazada'; migración `0005_registro_estado`, que deja las filas existentes en 'activa'). Para entrar hace falta `estado = 'activa'` **y** `activo = true`: desactivar (activo = false) no toca el estado. Una solicitud de registro nace `pendiente` + `activo = false` |
| `cargas` | id, contrato_id, mes ('YYYY-MM'), fecha_inicio, fecha_corte, planilla_numero, planilla_mes ('YYYY-MM'), ss_declarada (int), adicionales (jsonb [{numero, mes, valor, archivo}]), dias_manual (int null), motivo_novedad, doc_num, dias, valor, acumulado, pct, ss_esperada, desglose, estado ('OK'/'REVISAR'/'ERROR'), mensaje, lectura ('auto'/'corregido'/'manual'), archivo_planilla (pathname blob), observacion, aprobado (bool), creado, actualizado. **UNIQUE (contrato_id, mes)**: reenviar el mismo mes REEMPLAZA la fila (y borra "aprobado") |
| `lecturas` | temp_id (uuid), contrato_id, archivo (pathname blob), tipo, lectura (jsonb), leyo (bool), creado. Caducan a las 6 h |
| `intentos_pin` | clave, fallos, ultimo_fallo, bloqueado_hasta. Claves: nombre normalizado (PIN de contratista), `__admin__` (contraseña de admin) y `__registro__:<ip>` (intentos de registro por IP: `ultimo_fallo` = cuándo empezó la hora, `fallos` = cuántos intentos van) |
| `cambios_contrato` | id, contrato_id (FK, **borra en cascada**), autor ('contratista'/'admin'), campo (camelCase: 'inicio', 'fin', 'valorTotal', 'ciudad'...), antes, despues (texto ya legible: fechas DD/MM/AAAA, dinero `$7.174.000`, vacío = `(vacío)`; dirección, teléfono y correo siempre `(dato personal)`), alerta (bool, por defecto false: la contratista guardó un valor total distinto al esperado), creado (timestamptz). Bitácora de cambios al contrato; nunca guarda datos personales |

| `documentos` | id, contrato_id (FK, **borra en cascada**), tipo ('contrato' / 'acta_prorroga' / 'poliza' / 'desconocido'), nombre_archivo, archivo (pathname del PDF en Blob privado; nunca sale al navegador), campos (jsonb: lo que **el servidor** leyó con `leerDocumento`: n.º de contrato, nombre, cédula, objeto, honorario, valor total, inicio, fin, dirección, ciudad, teléfono), notas (jsonb string[]: avisos del lector), subido (timestamptz). Migración `0006_documentos_verificacion`. PDF que sube el supervisor para "Verificar con documento" (ver `docs/ADMIN.md`); contiene datos personales: nunca se loguean ni van a la bitácora |

`contratos` tiene además **`verificada_en`** (timestamptz, null): la fecha en que el supervisor marcó la cuenta como "verificada" con los documentos. La borra `PUT /api/mi-contrato` cuando la contratista **cambia de verdad** cualquier dato de su contrato (si guarda lo mismo que ya tenía, no); las ediciones del supervisor (`PUT /api/admin/contratos/[id]`, "Usar el del documento", aprobar una solicitud) no la tocan.

Valores por defecto de `parametros` = los de PARAMETROS de la hoja (ver `legacy/apps-script/CONTRATO_DATOS.md`).

## Sesiones

- Contratista: `POST /api/login` con nombre + PIN (últimos 4 de la cédula; nombre sin tildes/mayúsculas). Ok → cookie `sesion` httpOnly, Secure, SameSite=Lax, firmada con HMAC-SHA256 (`SESSION_SECRET`), con `{contratoId, exp}` y 2 h de vida.
- Límite: 5 fallos por nombre en 10 min → bloqueado 10 min, incluso con el PIN correcto. Un acierto limpia el contador.
- Las rutas de contratista leen la cookie; sin sesión válida → 401 `{ok:false, error:'Tu sesión venció. Vuelve a entrar.'}`.
- Admin (fase 3): `ADMIN_PASSWORD` en variables de entorno, cookie `admin` aparte.

## Archivos (Vercel Blob, `access: 'private'`)

- Ruta: `planillas/<contratoId>/<AAAA-MM>/<uuid>-<nombre limpio>`. Nunca se devuelve la URL del blob a la contratista.
- Documentos de "Verificar con documento": `documentos/<contratoId>/<uuid>-<nombre limpio>.pdf` (solo PDF, 4 MB, se revisan los primeros bytes). Se ven solo desde `GET /api/admin/documentos/<id>/archivo` (cookie de admin). Se borran al quitar el documento, al borrar la trabajadora (`borrarContrato`) y al rechazar la solicitud (`rechazarSolicitud`); el PDF se borra de Blob **antes** que la fila, para no dejar archivos huérfanos si Blob falla.
- La factura .xlsx **no se guarda**: se genera al vuelo desde la fila de `cargas`. Los datos del contrato que usa la factura (nombre, cédula, n.º de contrato, objeto, valor total, riesgo vigente, etc.) se congelan al enviar en `cargas.contrato_snapshot` (jsonb), así un otrosí (editar `fin` y `valor_total` del contrato) no cambia las cuentas ya enviadas. Reenviar el mismo mes refresca la foto. Cuentas viejas sin foto (`null`) usan el contrato actual.
- Otrosí = prórroga + adición del mismo contrato: el supervisor edita solo `fin` y `valor_total` (el inicio no cambia; el acumulado sigue sumando desde el inicio). `recalcularAcumulados` solo toca las cargas cuyo mes está dentro de [inicio, fin] vigente.
- Límite: 4 MB por archivo (el cuerpo de una función de Vercel admite ~4,5 MB). Tipos: PDF, JPG, PNG (validar magic bytes).

## Respuestas

Todas: `{ok:true, ...}` o `{ok:false, error:'mensaje amable en español'}`. Errores inesperados → mensaje genérico, sin detalles internos.

## Rutas

| Ruta | Entrada | Salida (además de ok) |
|---|---|---|
| `GET /api/contratistas` | — | `nombres: string[]` (solo `estado = 'activa'` y `activo`, orden alfabético sin tildes) |
| `POST /api/registro` | ver "Registro propio" abajo (público, sin cookie) | `{ok:true}` (201) |
| `POST /api/login` | `{nombre, pin}` | `contrato: Resumen` (+ cookie) |
| `POST /api/logout` | — | — |
| `GET /api/sesion` | cookie | `contrato: Resumen` (para refrescar tras enviar) |
| `GET /api/mi-contrato` | cookie | `datos:{direccion, telefono, ciudad, correo, cargo, objeto, inicio, fin, valorTotal, revisoNombre, revisoCargo, valorTotalEsperado}` (fechas `AAAA-MM-DD`, o `''` si el contrato aún no las tiene; `valorTotal` y `valorTotalEsperado`: número o `null`) |
| `PUT /api/mi-contrato` | cookie + cualquiera de las 11 claves de arriba (sin `valorTotalEsperado`) | `datos` (lo guardado) + `contrato: Resumen` (para refrescar la lista de meses y `perfilCompleto`) + `aviso?` (valor total distinto al esperado; no bloquea) |
| `POST /api/evaluar` | `{mes, fechaInicio, fechaCorte, datos:{numero, periodo, salud, pension, arl}, adicionales:[{numero, periodo, valor, tempId}], diasManual:{dias, motivo}\|null}` | `evaluacion` (= `Calc.evaluate`) — no guarda nada |
| `POST /api/planilla` | multipart: `archivo` (File), `texto` (texto que extrajo pdf.js en el navegador, puede venir vacío), `mes`, `fechaInicio`, `fechaCorte`, `adicionales` (JSON), `diasManual` (JSON), `adicional` ('1' si es planilla adicional) | `tempId, leyo, confianza, tipoDoc, fuente:'navegador'\|'ninguna', notas[], lectura:{numero, periodo, salud, pension, arl}, evaluacion\|null, valor\|null` |
| `POST /api/enviar` | `{mes, fechaInicio, fechaCorte, datos, tempId, adicionales, diasManual}` | `estado, estadoTexto, emoji, mensaje, factura:{nombre, url}` (url = `/api/factura/<cargaId>`) |
| `GET /api/factura/[id]` | cookie de la contratista dueña (o admin) | el .xlsx (`Content-Disposition: attachment`) |

`Resumen` = `{nombre, numeroContrato, honorario, inicio, fin, riesgo, meses:[{key, label, inicio, corte, dias, valor, enviado}], mesDefault, perfilCompleto, faltan}` (igual que `resumenContrato_` del legacy; `enviado` = estadoTexto de la carga de ese mes o ''). `perfilCompleto` (bool) y `faltan` (etiquetas legibles: 'Dirección', 'Fecha de fin'...) salen de `faltanDelPerfil` (`src/server/perfil.ts`): el perfil está completo cuando dirección, teléfono, ciudad, cargo, objeto, inicio, fin, valor total, nombre y cargo de quien revisa tienen algo (el correo es opcional). Para entrar basta con el honorario: si faltan las fechas, `meses:[]`, `mesDefault:''`, `inicio/fin:''` y la contratista las escribe en "Antes de empezar"; para enviar una cuenta sí hacen falta.

### Mi contrato (`/api/mi-contrato`)

La contratista llena y corrige **11 campos de su propio contrato**: `direccion`, `telefono`, `ciudad`, `correo` (opcional), `cargo`, `objeto`, `inicio`, `fin`, `valorTotal`, `revisoNombre` y `revisoCargo`. Todo lo demás (nombre, cédula, n.º de contrato, honorario, riesgo, riesgo nuevo/desde, línea, activo) lo cambia solo el supervisor: si llega en el cuerpo, **se ignora** sin error.

- `PUT` solo mira esas 11 claves en camelCase; lo que no viene se conserva. Si no viene ninguna → 400 `No hay nada que guardar.`
- Validación (todos los errores juntos), todo recortado: ninguno de los 10 obligatorios puede quedar vacío si se manda; máximos `direccion` 150, `ciudad` 80, `cargo` 120, `objeto` 1500, `revisoNombre`/`revisoCargo` 120, `correo` 200; `telefono` solo dígitos, espacios y `+` con 7 a 15 dígitos; `correo` formato `a@b.c` (o vacío); `inicio`/`fin` `AAAA-MM-DD` reales y `fin >= inicio` (si solo viene uno, se compara con el guardado); `valorTotal` en pesos (acepta `"$ 44.099.000"`, `44099000` o número), mayor que cero, no menor que el honorario y hasta 2.000.000.000. Reutiliza las reglas del admin (`src/server/entrada.ts`).
- Error: `400 {ok:false, error, campos:{ <campo>: mensaje }}` (`error` = el primer mensaje). Sin sesión, o contrato desactivado → `401 {ok:false, error:'Tu sesión venció. Vuelve a entrar.'}`.
- **Valor total esperado** (`valorTotalEsperado`, `expectedTotal` en `src/lib/calc.ts`): la suma, mes a mes de `monthsBetween(inicio, fin)`, de `periodValue(honorario, commercialDays(periodo esperado))`, o sea lo mismo que suma `cumulative` cuando todavía no hay cuentas. Un inicio el 16/01 cuenta enero con 15 días. `null` si faltan fechas u honorario.
- **Aviso (no bloquea):** si el `PUT` trae `valorTotal` y lo guardado difiere de `valorTotalEsperado` (calculado con las fechas ya guardadas), la respuesta trae `aviso` con las dos cifras ("Revísalo con tu acta; si tu acta dice otra cifra, déjalo así."). Se guarda igual.
- Si hubo al menos un cambio de verdad, **`contratos.verificada_en` vuelve a null** (en el mismo `UPDATE`): el supervisor tiene que revisarla de nuevo contra los documentos.
- Escribe **una fila de `cambios_contrato` por campo que de verdad cambió** (mandar el mismo valor no anota nada). Dirección, teléfono y correo se anotan como `(dato personal)` en `antes` y `despues`: nunca su valor. La fila de `valorTotal` lleva `alerta: true` cuando lo guardado difiere del esperado. Corre `recalcularAcumulados` (acumulado/% de las cargas dentro del nuevo periodo; el valor de cada mes no se re-evalúa). Las cuentas ya enviadas conservan su `contrato_snapshot`.
- La edición del admin (`PUT /api/admin/contratos/[id]`) también anota sus cambios, con `autor:'admin'` (inicio, fin, quién revisa, n.º de contrato, objeto, honorario, valor total, riesgo, riesgo nuevo/desde y activa; nunca cédula, dirección, teléfono, correo, ciudad ni cargo) y nunca con `alerta`.
- El supervisor los ve en `GET /api/admin/cambios` (ver `docs/ADMIN.md`).

### Registro propio (`POST /api/registro`, público)

Una contratista nueva pide su cuenta desde el celular; **no puede entrar hasta que el supervisor la apruebe** (ver "Solicitudes" en `docs/ADMIN.md`). Código: `src/server/registro.ts`.

- Cuerpo (JSON): `nombre, cedula, direccion, telefono, ciudad, correo?, linea, numeroContrato, cargo, objeto, inicio, fin, honorario, valorTotal, riesgo, revisoNombre, revisoCargo` más el campo trampa `sitio_web`. Todo es obligatorio menos `correo`. Cualquier otra clave (`activo`, `estado`, `riesgoNuevo`...) se ignora.
- Validación: la del panel (`validarContrato`: cédula 6 a 10 dígitos, fechas reales, `fin >= inicio`, riesgo I a V o 1 a 5, honorario y valor total en pesos, `valorTotal >= honorario`, correo con formato) más el teléfono (7 a 15 dígitos) y los máximos de "Mi contrato" (dirección 150, ciudad 80, cargo 120, objeto 1500, quien revisa 120). Errores: `400 {ok:false, error, campos:{ campo: mensaje }}`.
- **Nombre y cédula únicos entre TODAS las filas**, pendientes incluidas (el nombre sin tildes ni mayúsculas). Los únicos mensajes que revelan algo: `Ya existe una cuenta con esa cédula. Si es tuya, habla con tu supervisor.` y `Ya existe una cuenta con ese nombre. Si es tuya, habla con tu supervisor.`
- Crea la fila con `estado = 'pendiente'` y `activo = false`, y anota en `cambios_contrato` (`autor: 'contratista'`, `campo: 'registro'`); esa fila también da la "fecha de solicitud" de la lista del supervisor. Mientras sea pendiente: no sale en `GET /api/contratistas`, no entra (el login responde igual que con un PIN malo), `contratoActivo` da 401 y el panel (`/api/admin/contratos`, `/api/admin/cambios`) no la muestra.
- Orden de las defensas: 1) **campo trampa** `sitio_web` lleno → no se guarda nada y la ruta responde `201 {ok:true}` igual (no se le da pista al robot ni cuenta contra el límite); 2) **límite por IP**: 5 intentos por hora (cuentan todos los que pasan la trampa, también los que traen errores, para que la ruta no sirva de oráculo de cédulas), con la primera IP de `x-forwarded-for` y la clave `__registro__:<ip>` en `intentos_pin`; el 6.º → `429 Enviaste muchas solicitudes seguidas...`; 3) **tope de 30 solicitudes pendientes** en total → `429 No se pueden recibir más solicitudes por ahora.`; 4) validación e inserción.

### Pantallas de la contratista para estos datos

- **"¿Eres nueva? Crea tu cuenta"** (botón secundario del paso 1) abre `PasoRegistro.tsx`: tres grupos (Tus datos, Tu contrato con equipo o línea, n.º de contrato, cargo, objeto, fechas, honorario, valor total y riesgo ARL, y Quién revisa tu cuenta), la explicación del PIN (los últimos 4 números de la cédula), campo trampa oculto y "Enviar solicitud". Los errores de `campos` salen junto a cada campo. Al enviar muestra la confirmación "Tu solicitud quedó enviada". Reglas puras y pruebas: `src/components/registro.ts`. El campo reutiliza `CampoFormulario.tsx` (el mismo de "Mis datos del contrato").
- Tras el login (`Contratista.tsx`), si `perfilCompleto` es `false` se muestra **"Antes de empezar, completa tus datos"** (antes del paso 2, fuera de los 4 pasos, sin barra de progreso) y recién después el paso 2. Manda **todos** los campos con "Guardar y continuar".
- "Revisar mis datos del contrato" (paso 2) abre el mismo formulario (`PasoMiContrato`, prop `inicial`) con "Guardar cambios": manda solo lo que cambió.
- Si la respuesta trae `aviso`, se muestra en una franja ámbar bajo el valor total con "Continuar de todas formas"; cualquier edición la quita y se vuelve a guardar. Helpers puros y sus pruebas: `src/components/miContrato.ts`.

Reglas de `/api/planilla` y `/api/enviar`: copiar la lógica de `api_leerPlanilla` / `procesarEnvio_` del legacy:
texto del navegador si tiene ≥150 caracteres (si no, `fuente:'ninguna'` y la contratista escribe los datos a mano; **no hay OCR**);
confianza 'baja' → `lectura` en blanco; `lectura` de la carga = auto / corregido / manual; el servidor **re-evalúa** antes de guardar y solo rechaza si `bloquea`;
acumulado y % se recalculan para todas las cargas del contrato; planillas repetidas = números de planilla de otras cargas (todas las contratistas) menos la misma contratista+mes.

## Variables de entorno

`DATABASE_URL` (Neon), `BLOB_READ_WRITE_TOKEN` (Blob), `SESSION_SECRET` (32+ caracteres aleatorios), `ADMIN_PASSWORD` (fase 3), `RESEND_API_KEY` (fase 3).
