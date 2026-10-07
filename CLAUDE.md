@AGENTS.md

# Cuentas de cobro HOMO (versión Vercel)

Escribe siempre en **español colombiano, casual**. El usuario es Jacobo.

## 1. Quién es el usuario y cómo trabajar con él

- **Jacobo** es médico y supervisor de las contratistas del **Observatorio de Asuntos de Mujer y Género** (Secretaría de las Mujeres, Gobernación de Antioquia). Las paga la **ESE Hospital Mental de Antioquia (HOMO)**, contrato interadministrativo **N.º 4600018487 de 2025**.
- **No es programador.** Explícale todo **paso a paso**: dónde hacer clic y qué debe ver (✋ puntos de control). Prefiere diagramas y tablas antes que texto corrido. Pídele pantallazos para verificar.
- **Preferencia explícita:** delega investigación, borradores y código a subagentes de modelos económicos (sonnet/haiku), en paralelo cuando se pueda. Tú planificas, auditas y entregas.
- Las contratistas son aún menos técnicas: la pantalla del celular tiene que ser a prueba de todo.
- A veces deja la sesión corriendo sin estar frente al PC. Antes de algo que abra una ventana de permiso de Windows, avísale.

## 2. Objetivo

La contratista entra con **nombre + PIN** (los últimos 4 de su cédula), **sube el PDF de su planilla PILA desde el celular** y la app genera la cuenta de cobro (formato oficial HOMO **GJ-CO-FR-15 v02**) **en Excel (.xlsx)**, con lo precargado de su contrato más lo leído de la planilla. Las alertas **no bloquean**: la herramienta es un apoyo. **Solo Excel; PDF no por ahora.**

## 3. Reglas de negocio (confirmadas por Jacobo)

1. **Fecha final del periodo: siempre el día 30**, también en meses de 31. En febrero, el último día de febrero. Si el contrato termina antes, la fecha de terminación (si termina un 31, cuenta 30).
2. **Mes comercial de 30 días.** Días = corte − inicio + 1. El 31 y el último de febrero cuentan como 30. Valor = honorario si son 30 días; si no, ROUND(honorario × días / 30).
3. **Fecha inicial** = MAX(día 1 del mes, inicio del contrato).
4. **N.º documento** = AAAAMM del mes cobrado. **Fecha de expedición** = fecha de corte. **Acumulado** = suma de lo cobrado hasta ese mes. **% ejecución** = acumulado / valor total del contrato.
5. **Seguridad social en la factura** = salud + pensión + ARL, **sin caja de compensación y sin mora**. IBC = 40 % del honorario (piso 1 SMMLV, 2026: $1.750.905; techo 25 SMMLV). Salud 12,5 %, pensión 16 %, ARL I 0,522 % · II 1,044 % · III 2,436 % · IV 4,35 % · V 6,96 %. Cada aporte se redondea **hacia arriba a la centena**. Ejemplos: 7.174.000 riesgo III → 358.700 + 459.200 + 70.000; 4.009.000 riesgo III (IBC al piso) → 218.900 + 280.200 + 42.700.
6. Planilla del **mismo mes o del anterior**: las dos valen.
7. **Alertas que no bloquean:** cotizó más → 🟡; cotizó menos → 🔴 (igual se genera); ARL con otra tarifa, planilla repetida, mes cotizado raro o días a mano → 🟡. Solo bloquea si **falta un dato obligatorio**.
8. **Hasta 4 planillas por cuenta** (correcciones, ajustes de ARL). En la factura van una por fila debajo de la fila 28. Solo la principal se valida.
9. **Días a mano** (suspensión, licencia) con motivo → 🟡.
10. El **objeto del contrato** es por contratista.

## 4. Arquitectura

```
Contratista (celular) ──► Next.js en Vercel ──► Neon Postgres (contratos, cargas, intentos de PIN)
  nombre + PIN, sube PDF        │              ├─► Vercel Blob (planillas y facturas)
  (pdf.js lee el texto          │              └─► Resend (correo con la factura)
   EN EL NAVEGADOR)             ▼
                     lib: parser (lee planilla) → calc (reglas) → factura (ExcelJS sobre la plantilla oficial)
Jacobo ──► /admin: ver cargas, aprobar + observación, editar contratistas, descargar Excel
```

| Carpeta | Qué es |
|---|---|
| `src/lib/` | lógica pura: `calc` (reglas), `parser` (lector de planillas PILA), `factura` (Excel) |
| `src/app/` | pantallas y rutas de servidor (Next.js App Router) |
| `legacy/apps-script/` | versión anterior en Google Apps Script (v3.1), **solo de referencia**. `CONTRATO_DATOS.md` describe sus columnas y celdas |
| `privado/` | **ignorada por git**: plantilla original con datos reales, fixture con cédulas, tests viejos con PINs. Nunca se sube |

## 5. Datos personales: reglas duras

- **Nunca** subir a git cédulas, teléfonos, direcciones, PINs ni planillas reales. El PIN es parte de la cédula: si se filtra la cédula, se filtra el acceso.
- Los tests usan **datos inventados**. Las planillas reales para probar el lector están **fuera del repo**: `FX_DIR=C:\Users\EQUIPO\Downloads\planillas_homo` (subcarpetas `ana/`, `laura/`, `erika/`).
- Los datos reales de contratistas se cargan desde /admin o con un archivo `*.local.*` (ignorado por git).
- Antes de cada commit revisa `git status` para que no se cuele nada de `privado/`.

## 6. Estado

- La app de Google (cuenta andreamar4810@gmail.com, versión anterior a la v3.1) **se deja quieta** hasta que esta versión esté probada.
- Migración por fases: 0) repo y GitHub · 1) esqueleto + login + base de datos · 2) planilla → cálculo → .xlsx · 3) /admin y correo · 4) datos reales y prueba con Andrea.
