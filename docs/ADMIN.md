# Panel del supervisor (/admin): especificación (fase 3)

Usuario: Jacobo (supervisor, no programador). Pantallas claras, en español, que funcionen en computador y también en celular.
Complementa `docs/ARQUITECTURA.md` (mismas convenciones: `{ok:true,...}` / `{ok:false,error}`, rutas delgadas, lógica en `src/server/`).

## Acceso

- `ADMIN_PASSWORD` (variable de entorno, la define Jacobo en Vercel). Sin la variable, el login de admin siempre falla con un mensaje claro.
- `POST /api/admin/login {password}` → cookie `admin` httpOnly, firmada con `SESSION_SECRET` (HMAC, igual que la de contratista pero con otro propósito), 8 h, Secure en producción. Comparación timing-safe.
- Límite: 5 fallos en 10 min → bloqueado 10 min (reusar la tabla `intentos_pin` con la clave `__admin__`).
- `POST /api/admin/logout`, `GET /api/admin/sesion` → `{ok, admin:true}` o 401.
- Todas las rutas `/api/admin/**` exigen la cookie `admin` (401 si no). `GET /api/factura/[id]` acepta también la cookie `admin`.

## Trabajadoras (tabla `contratos`)

Nuevo campo opcional: `linea` (texto, "Línea política pública", viene del Excel de control). Requiere migración drizzle nueva (no editar la 0000).

| Ruta | Entrada | Salida |
|---|---|---|
| `GET /api/admin/contratos` | — | `contratos: Contrato[]` (todos los campos + `cargas: number`), orden por nombre sin tildes. **No incluye las solicitudes pendientes** (`estado = 'pendiente'`; esas van en `/api/admin/solicitudes`). `PUT`/`DELETE` sobre una pendiente dan 404 |
| `POST /api/admin/contratos/lote` | `{ids: number[], fin?, inicio?}` (ver "Cambio en lote") | `resultados: [{id, nombre, ok, error?}]`, `aplicadas`, `fallidas` |
| `POST /api/admin/contratos` | campos del contrato | `contrato` |
| `PUT /api/admin/contratos/[id]` | campos del contrato | `contrato` |
| `DELETE /api/admin/contratos/[id]` | `{confirmar?: string}` | — |

Validaciones (mensajes amables, en español, indicando el campo):
- `nombre` obligatorio, **único** sin distinguir tildes/mayúsculas/espacios repetidos (el login es por nombre). Se guarda tal cual lo escribe (recortado).
- `cedula` obligatoria, solo dígitos (quitar puntos/espacios al guardar), 6–10 dígitos, **única**.
- `riesgo` y `riesgo_nuevo` ∈ I..V (`riesgo_nuevo` puede ir vacío); si hay `riesgo_nuevo`, `riesgo_desde` obligatorio y día 1 de un mes.
- `inicio`, `fin`: fechas válidas, fin ≥ inicio. Se permiten vacías (contrato "por completar"), pero la trabajadora no podrá entrar hasta completarlas (eso ya lo controla el login).
- `honorario` entero > 0; `valor_total` entero ≥ honorario (si ambos están). Aceptar "7.174.000", "$ 7.174.000", "7174000".
- `correo` vacío o con formato de correo.
- Al guardar un contrato que tiene cargas: recalcular `acumulado` y `pct` de sus cargas (reusar la función del envío). NO re-evaluar el valor de cada mes.
- Borrar: si tiene 0 cargas, se borra. Si tiene cargas, exige `confirmar` = nombre exacto (sin distinguir tildes/mayúsculas); borra cargas, lecturas y los archivos en Blob de esas cargas, y luego el contrato. Si no coincide → error "Para borrar a X con N cuentas enviadas, escribe su nombre completo. Si solo quieres que no aparezca en el celular, desactívala."

## Solicitudes de cuenta (registro propio de la contratista)

La contratista nueva se registra sola (`POST /api/registro`, ver `docs/ARQUITECTURA.md`) y queda como **solicitud** (`estado = 'pendiente'`, `activo = false`). El supervisor la revisa aquí. Código: `src/server/solicitudes.ts`.

| Ruta | Entrada | Salida |
|---|---|---|
| `GET /api/admin/solicitudes` | — | `solicitudes: [{...todos los campos menos la cédula, cedulaFinal4: '…1234', solicitada}]`, solo pendientes, de la más antigua a la más nueva. `solicitada` = fecha ISO en que la envió |
| `GET /api/admin/solicitudes/[id]` | — | `solicitud: {...todos los campos, cedula completa, solicitada}` (para el formulario de revisión) |
| `POST /api/admin/solicitudes/[id]/aprobar` | cuerpo opcional con campos corregidos (los del formulario de una trabajadora) | `contrato`. Valida como `PUT /api/admin/contratos/[id]` (lo que no viene se conserva; errores `{ok:false, error, campos}`), la deja `estado = 'activa'` y `activo = true`, y anota en la bitácora (`autor: 'admin'`) lo que corrigió y `aprobada` |
| `POST /api/admin/solicitudes/[id]/rechazar` | — | — |

- **Rechazar borra la fila** (su bitácora se borra en cascada). Solo actúa sobre solicitudes pendientes: sobre una cuenta ya activa da 404 y no borra nada. Aprobar una que ya no está pendiente también da 404 (`No encontramos esa solicitud...`).
- Al aprobar se vuelven a revisar nombre y cédula únicos (contra todas las demás filas).
- La bitácora de una solicitud no sale en "Cambios recientes" hasta que se aprueba; ahí aparecen `registro` ("Envió la solicitud de cuenta", autor la contratista) y `aprobada` ("Aprobó la solicitud de cuenta", autor el supervisor).
- El importador de Excel no toca solicitudes pendientes: una fila con la cédula de una pendiente sale como error.

## Cambio en lote

`POST /api/admin/contratos/lote` con `{ids: number[], fin?: 'AAAA-MM-DD', inicio?: 'AAAA-MM-DD'}`: cambia la fecha de fin, la de inicio o las dos de varias trabajadoras. **Solo esos dos campos** (cualquier otra clave se ignora). Máximo 100 ids; al menos una de las dos fechas; `fin >= inicio` si vienen las dos (error `{ok:false, error, campos:{ids|fin|inicio}}` y no se toca nada).

- A cada id se le aplica `actualizarContrato` (la misma edición del panel): validaciones contra lo que ya tiene (por ejemplo, un fin anterior a su inicio), bitácora (`autor: 'admin'`) y recálculo de acumulados.
- Una que falla no frena a las demás. Respuesta: `resultados: [{id, nombre, ok, error?}]` en el orden pedido (sin repetidos), `aplicadas` y `fallidas`. Un id que no existe o es una solicitud pendiente sale con `ok: false` y `No encontramos a esa trabajadora.`

## Otrosí y contrato nuevo (guiados)

No son rutas nuevas: la pantalla arma un `PUT /api/admin/contratos/[id]` completo (lo vigente más lo que cambia), así que quedan en la bitácora y los acumulados se recalculan. Las cuentas ya enviadas conservan su foto del contrato.

| Acción | Qué cambia | Efecto en el acumulado |
|---|---|---|
| **Registrar otrosí** | `fin` y/o `valorTotal` (el inicio no cambia) | Sigue sumando desde el inicio del contrato; el % pasa a ser sobre el valor total nuevo |
| **Registrar contrato nuevo** | `numeroContrato`, `inicio`, `fin`, `honorario`, `valorTotal` y `objeto` | Empieza de cero desde la nueva fecha de inicio (`recalcularAcumulados` solo toca los meses dentro de la vigencia nueva) |

En la pantalla: `fin >= inicio` y `valorTotal >= honorario` se revisan antes de enviar (el servidor repite); en "contrato nuevo", si la fecha de inicio no es posterior al fin del contrato anterior sale un aviso ámbar que no bloquea. Reglas puras y pruebas: `src/components/admin/helpers.ts`.

## Importar desde el Excel de control

`POST /api/admin/importar` (multipart: `archivo` .xlsx, `aplicar` '0'|'1').
- Formato de referencia (hoja 1, encabezados en la fila 1, nombres aproximados, sin distinguir tildes/mayúsculas/espacios): `CEDULA`, `NOMBRE`, `CONTRATO…` (cualquier encabezado que empiece por "CONTRATO"), `HONORARIOS`, `RIESGO ARL` (número 1–5 o romano), `Línea política pública`. Las demás columnas (cálculos del mes) se ignoran. Detectar la fila de encabezados buscando `CEDULA` y `NOMBRE` en las primeras 10 filas.
- Clave: cédula. Existe → actualizar solo nombre, numero_contrato, honorario, riesgo, linea si cambiaron. No existe → crear (activo = true, resto vacío).
- `aplicar='0'` → vista previa sin guardar: `{crear:[{nombre, cedulaFinal4}], actualizar:[{id, nombre, cambios:[{campo, antes, despues}]}], sinCambios: n, errores:[{fila, mensaje}]}`. **Nunca devolver la cédula completa**, solo los últimos 4 (`…1234`).
- `aplicar='1'` → aplica lo mismo y devuelve el mismo resumen. Las filas con error se saltan.
- Máx. 1 MB, máx. 200 filas. El archivo no se guarda.

## Cuentas del mes

| Ruta | Entrada | Salida |
|---|---|---|
| `GET /api/admin/cargas?mes=YYYY-MM` | mes (por defecto el mes anterior al actual en Bogotá) | `cargas: [{id, contratoId, nombre, mes, estado, emoji, mensaje, docNum, dias, valor, acumulado, pct, ssEsperada, ssDeclarada, planillaNumero, planillaMes, adicionales, lectura, aprobado, observacion, actualizado}]` + `faltan: [{contratoId, nombre}]` (activas sin carga ese mes) |
| `PATCH /api/admin/cargas/[id]` | `{aprobado?: boolean, observacion?: string}` | `carga` |
| `GET /api/admin/planilla/[cargaId]?n=0` | n = 0 principal, 1..3 adicionales | el archivo desde Blob privado (Content-Type correcto, `inline`) |

## Bitácora de cambios al contrato

La contratista llena y corrige 11 datos de su contrato desde el celular (`PUT /api/mi-contrato`: dirección, teléfono, ciudad, correo, cargo, objeto, fechas de inicio y fin, valor total y quién revisa; la primera vez, en la pantalla "Antes de empezar, completa tus datos"; ver `docs/ARQUITECTURA.md`). Cada cambio, y los que hace el supervisor al editar una trabajadora (`PUT /api/admin/contratos/[id]`), queda anotado en `cambios_contrato`.

| Ruta | Entrada | Salida |
|---|---|---|
| `GET /api/admin/cambios?contratoId=<id>` | `contratoId` opcional (entero). Sin él: los de todas las trabajadoras. Mal escrito → 400 | `cambios: [{id, contratoId, nombre, autor, campo, etiqueta, antes, despues, alerta, creado}]`, del más nuevo al más viejo, **máximo 100** |

- `autor` = `'contratista'` o `'admin'`; `creado` = fecha ISO (UTC); `antes`/`despues` ya vienen legibles (fechas `DD/MM/AAAA`, dinero `$7.174.000`, vacío = `(vacío)`).
- `alerta` (bool): `true` cuando la contratista guardó un **valor total distinto al que da su honorario por la vigencia**. En "Cambios recientes" y en el historial de cada trabajadora esa fila lleva la franja ámbar y el texto "Valor total distinto al esperado". El admin nunca genera alertas.
- `etiqueta` = nombre para mostrar: `inicio` → "Fecha de inicio", `fin` → "Fecha de fin", `revisoNombre` → "Revisó (nombre)", `revisoCargo` → "Revisó (cargo)", `valorTotal` → "Valor total del contrato", `objeto` → "Objeto del contrato", `direccion` → "Dirección", `telefono` → "Teléfono", `correo` → "Correo", `ciudad` → "Ciudad", `cargo` → "Cargo". Los tres datos personales (dirección, teléfono, correo) **nunca guardan su valor**: `antes` y `despues` son `(dato personal)` y la pantalla dice "se actualizó". El admin además anota `numeroContrato`, `objeto`, `honorario`, `valorTotal`, `riesgo`, `riesgoNuevo`, `riesgoDesde` y `activo` (nunca datos personales, ciudad ni cargo).
- Solo se anota lo que realmente cambió. Si se borra la trabajadora, su bitácora se borra con ella.
- Sin cookie de admin → 401.

## Parámetros

`GET /api/admin/parametros` → la fila; `PUT /api/admin/parametros` → valida (porcentajes entre 0 y 1, SMMLV entero > 0, multiplicadores > 0, ARL I..V entre 0 y 0.2, correo supervisor vacío o válido, tolerancia ≥ 0) y guarda.

## Pantallas (`src/app/admin/**`, componentes en `src/components/admin/**`)

- `/admin` → si no hay sesión, formulario de contraseña; si hay, redirige a `/admin/cuentas`.
- Barra superior: **Cuentas del mes · Trabajadoras · Solicitudes · Parámetros · Salir**. "Solicitudes" lleva al lado el número de solicitudes pendientes (una insignia ámbar; se vuelve a contar al cambiar de pantalla y al aprobar o rechazar).
- `/admin/solicitudes`: tabla de pendientes (nombre con los últimos 4 de la cédula, equipo o línea, contrato con fechas, fecha de solicitud, estado "Por revisar"). **Revisar** abre en el panel lateral el mismo formulario de una trabajadora, con todos los datos editables y los botones **Aprobar** (manda también lo corregido) y **Rechazar** (con diálogo de confirmación). Sin pendientes: "No hay solicitudes pendientes."
- `/admin/cuentas`: selector de mes; tabla con semáforo (emoji), nombre, valor, seguridad social (esperada vs declarada), mensaje (expandible), botones **Descargar Excel**, **Ver planilla**, checkbox **Aprobado**, campo **Observación** (guarda al salir del campo, con ✓ de guardado). Debajo: "Faltan por enviar: …".
- `/admin/trabajadoras`: tabla (nombre, contrato, honorario, riesgo, fechas, activa, n.º cuentas) con buscador; botón **➕ Nueva trabajadora**; por fila **✏️ Editar**, **⏸️ Desactivar/Activar**, **🗑️ Borrar**. Formulario agrupado: *Datos personales* (nombre, cédula, dirección, teléfono, ciudad, correo) · *Contrato* (n.º, objeto, cargo, línea, inicio, fin, honorario, valor total) · *ARL* (riesgo, riesgo nuevo, desde) · *Revisó* (nombre, cargo) · *Activa*. Errores junto al campo. Borrar con diálogo de confirmación (pide escribir el nombre si tiene cuentas).
  En el panel de edición de una trabajadora hay dos acciones guiadas, **Registrar otrosí** (nueva fecha de fin y nuevo valor total) y **Registrar contrato nuevo** (n.º, fechas, honorario, valor total, objeto); ver "Otrosí y contrato nuevo". En la tabla hay casillas para escoger varias y el botón **Cambiar a varias** (fecha de fin y/o de inicio; ver "Cambio en lote"), que al terminar muestra cuántas se cambiaron y por qué no se cambió alguna.
  Botón **📥 Importar desde Excel**: subir → mostrar la vista previa (crear / actualizar con antes→después / errores) → botón **Aplicar cambios**.
- `/admin/parametros`: formulario con los valores en porcentaje legible (12,5 %) y SMMLV con puntos.
- La cédula se muestra completa solo dentro del formulario de edición; en tablas, enmascarada (`…1234`).
