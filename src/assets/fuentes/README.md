# Fuentes de la cuenta de cobro en PDF

Las usa `src/lib/facturaPdf.ts` para que el PDF salga igual en cualquier equipo. Son compatibles en medidas con las
del formato oficial en Excel, así que los saltos de línea quedan donde los pone Excel.

| Archivo | Reemplaza a | Origen | Licencia |
|---|---|---|---|
| `LiberationSans-Regular.ttf`, `LiberationSans-Bold.ttf` | Arial | Liberation Fonts 2.1.5, https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5 (`liberation-fonts-ttf-2.1.5.tar.gz`) | SIL OFL 1.1, ver `LICENSE-LiberationSans.txt` y `AUTHORS-LiberationSans.txt` |
| `Carlito-Regular.ttf`, `Carlito-Bold.ttf` | Calibri | Proyecto Carlito (Google Fonts), https://github.com/google/fonts/tree/main/ofl/carlito | SIL OFL 1.1, ver `LICENSE-Carlito.txt` |

Los archivos no se modifican. Entran al paquete de las rutas de la API por `outputFileTracingIncludes` en `next.config.ts`.
