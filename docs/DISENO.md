# Diseño visual

## Brief

- **Qué es:** el trámite mensual de la cuenta de cobro de las contratistas del Observatorio de Asuntos de Mujer y Género, pagadas por la ESE Hospital Mental de Antioquia (HOMO).
- **Quién lo usa:**
  - Contratistas, una vez al mes, desde celulares Android baratos, muchas veces con prisa.
  - El supervisor (Jacobo, médico), desde el computador.
- **Trabajo principal:** convertir el PDF de la planilla PILA en una cuenta de cobro correcta en menos de 2 minutos, y que ella **confíe** en que quedó bien.
- **Vocabulario propio del tema:**
  - el formato oficial GJ-CO-FR-15 (una hoja de papel con tablas y un código al pie);
  - el verde institucional del HOMO y su logo;
  - el sello de "revisado";
  - el lenguaje de trámite ("periodo", "planilla", "seguridad social", "acumulado").

## Idea central (lo memorable, solo esto)

**La cuenta de cobro se va llenando a la vista.** En la pantalla de la contratista hay una "hoja" que imita el formato oficial: blanca, casi sin curvas y con renglones finos.

- A medida que ella avanza, la hoja se completa con el periodo, el valor, la planilla leída y la seguridad social.
- Al final la hoja queda completa y aparece un **sello circular** verde, con un leve giro, que dice "Lista para descargar".
- Ese sello es **el único momento animado** de la app.
- Todo lo demás es quieto, plano y disciplinado.

En el panel del supervisor no hay hoja. Ahí el protagonista es la **tabla del mes**: limpia, densa y legible, con el estado como una franja de color al inicio de cada fila.

## Tokens

### Color (claro, sin modo oscuro por ahora)

| Nombre | Hex | Uso |
|---|---|---|
| `--verde-homo` | `#0B5640` | botón principal, títulos, enlaces |
| `--verde-logo` | `#1E9A4B` | foco de teclado, sello, estado "Todo cuadra" |
| `--tinta` | `#17302A` | texto (negro verdoso, no #111) |
| `--fondo` | `#EEF2EF` | fondo de la app (gris verdoso frío, **no crema**) |
| `--papel` | `#FFFFFF` | la hoja y los campos |
| `--linea` | `#C9D3CE` | renglones, bordes de campos |
| `--ambar` | `#9A5B00` (fondo `#FFF4DC`) | estado "Revisa esto" |
| `--rojo` | `#B3261E` (fondo `#FDECEA`) | estado "Hay un problema" y errores |
| `--texto-suave` | `#4F625B` | ayudas y textos secundarios (contraste ≥ 4.5:1 sobre `--fondo`) |

### Tipografía

- **Atkinson Hyperlegible Next** (Google Fonts, vía `next/font/google`, `display: swap`).
  - Diseñada por el Braille Institute para máxima legibilidad.
  - Se eligió pensando en pantallas pequeñas y en personas con prisa.
  - **Una sola familia**, pesos 400 / 600 / 700.
- Cifras de dinero y fechas con `font-variant-numeric: tabular-nums`.
- Escala en celular: 14 (ayudas) / 16 (texto) / 19 (subtítulos) / 24 (título del paso) / 30 (cifra protagonista).
- Interlineado 1.5 para texto y 1.2 para títulos. Líneas de menos de 70 caracteres.
- **Prohibido:**
  - etiquetas en MAYÚSCULAS;
  - textos con puntos medios ("A · B");
  - "→" en botones;
  - resaltar una sola palabra del título con otro color o en cursiva;
  - fuente monoespaciada para datos.

### Forma

- La hoja lleva radio de 4 px y una sombra de papel muy leve (`0 1px 0 #C9D3CE, 0 8px 24px -16px rgba(23,48,42,.35)`). **Es el único elemento con sombra.**
- Campos y botones: radio de 10 px, borde de 1.5 px `--linea`, con foco de 3 px `--verde-logo`.
- Las secciones se separan con espacio y renglones finos, no con tarjetas.
- Área táctil mínima de 48 px. Botón principal de ancho completo y fijo abajo en celular, con el área segura del teléfono respetada.

## Pantallas de la contratista (celular primero)

```
┌──────────────────────────────┐
│ [logo HOMO]  Tu cuenta de cobro  │  encabezado blanco con el logo real (public/homo-logo.png)
├──────────────────────────────┤
│ Paso 2 de 4                  │  progreso: 4 segmentos (es una secuencia real)
│ ▬▬▬▬▬▬▬▬▭▭▭▭▭▭▭▭              │
│                              │
│ Sube tu planilla             │  título del paso (24)
│ La resumida o la detallada,  │  ayuda (14, --texto-suave)
│ no el comprobante del banco. │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │  zona de subida grande, borde punteado
│   Elegir PDF o tomar foto    │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│                              │
│ ┌──────────────────────────┐ │  LA HOJA (vista previa del formato)
│ │ Cuenta de cobro 202609   │ │
│ │ ───────────────────────  │ │
│ │ Periodo   01/09 – 30/09  │ │
│ │ Valor     $ 4.009.000    │ │  cifra protagonista
│ │ Planilla  ——             │ │  lo que falta se ve como raya, no vacío
│ │ Seg. social ——           │ │
│ │ GJ-CO-FR-15 v02          │ │  código al pie, como el formato real
│ └──────────────────────────┘ │
│ [      Continuar        ]    │  fijo abajo
└──────────────────────────────┘
```

- **Paso 1 (Entrar):** sin hoja. Logo, "¿Quién eres?", nombre y PIN. Texto corto de ayuda.
- **Paso 2 (Mes y planilla):** como el boceto.
- **Paso 3 (Revisar):**
  - La hoja con los datos leídos.
  - Los campos editables van **debajo** de la hoja, con el estado de la revisión.
  - El estado se muestra como una franja de color con una frase:
    - "Todo cuadra";
    - "Revisa esto: …";
    - "Hay un problema: …".
  - Los emoji solo se guardan en la base; no se usan como icono principal.
- **Paso 4 (Lista):** la hoja completa, el sello y los botones "Descargar Excel" y "Enviar otro mes".
- **Cargando:** la hoja con un barrido suave en los renglones vacíos. Si el usuario pide reducir el movimiento, sin animación.

## Panel del supervisor (computador primero, funciona en celular)

- Encabezado blanco con el logo pequeño, "Panel del supervisor" y la navegación en texto: Cuentas del mes, Trabajadoras, Parámetros y Salir. La sección activa va subrayada en `--verde-homo`.
- **Cuentas del mes:**
  - El mes va como título grande ("Septiembre 2026") con botones ‹ › a los lados.
  - Tabla sobre papel blanco con renglones finos. Cada fila empieza con una franja de 4 px del color del estado, seguida de la palabra del estado.
  - Los montos van alineados a la derecha.
  - En celular, la tabla se convierte en lista de bloques.
- **Trabajadoras:** la tabla en el mismo estilo; el formulario va en un panel lateral (en celular, pantalla completa) agrupado en secciones con títulos de 19 px, no en tarjetas.
- **Parámetros:** formulario de una columna con ayudas cortas.

## Calidad mínima (sin anunciarla)

- Funciona a 360 px de ancho.
- Foco de teclado visible.
- Respeta `prefers-reduced-motion`.
- Contraste AA.
- Etiquetas reales en todos los campos.
- Errores junto al campo, que dicen qué pasó y cómo arreglarlo, sin disculparse.
