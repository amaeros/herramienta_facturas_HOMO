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
| `GET /api/admin/contratos` | — | `contratos: Contrato[]` (todos los campos + `cargas: number`), orden por nombre sin tildes |
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

## Parámetros

`GET /api/admin/parametros` → la fila; `PUT /api/admin/parametros` → valida (porcentajes entre 0 y 1, SMMLV entero > 0, multiplicadores > 0, ARL I..V entre 0 y 0.2, correo supervisor vacío o válido, tolerancia ≥ 0) y guarda.

## Pantallas (`src/app/admin/**`, componentes en `src/components/admin/**`)

- `/admin` → si no hay sesión, formulario de contraseña; si hay, redirige a `/admin/cuentas`.
- Barra superior: **Cuentas del mes · Trabajadoras · Parámetros · Salir**.
- `/admin/cuentas`: selector de mes; tabla con semáforo (emoji), nombre, valor, seguridad social (esperada vs declarada), mensaje (expandible), botones **Descargar Excel**, **Ver planilla**, checkbox **Aprobado**, campo **Observación** (guarda al salir del campo, con ✓ de guardado). Debajo: "Faltan por enviar: …".
- `/admin/trabajadoras`: tabla (nombre, contrato, honorario, riesgo, fechas, activa, n.º cuentas) con buscador; botón **➕ Nueva trabajadora**; por fila **✏️ Editar**, **⏸️ Desactivar/Activar**, **🗑️ Borrar**. Formulario agrupado: *Datos personales* (nombre, cédula, dirección, teléfono, ciudad, correo) · *Contrato* (n.º, objeto, cargo, línea, inicio, fin, honorario, valor total) · *ARL* (riesgo, riesgo nuevo, desde) · *Revisó* (nombre, cargo) · *Activa*. Errores junto al campo. Borrar con diálogo de confirmación (pide escribir el nombre si tiene cuentas).
  Botón **📥 Importar desde Excel**: subir → mostrar la vista previa (crear / actualizar con antes→después / errores) → botón **Aplicar cambios**.
- `/admin/parametros`: formulario con los valores en porcentaje legible (12,5 %) y SMMLV con puntos.
- La cédula se muestra completa solo dentro del formulario de edición; en tablas, enmascarada (`…1234`).
