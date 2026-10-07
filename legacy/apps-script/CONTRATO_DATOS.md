# Contrato de datos compartido (Google Sheet "Centro de Control Facturas HOMO")

## PARAMETROS (col A etiqueta, col B valor)
B2 %IBC = 0.40 | B3 salud = 0.125 | B4 pensión = 0.16 | B5 SMMLV = 1750905 | B6 IBC piso (múltiplo SMMLV) = 1 | B7 IBC techo (múltiplo SMMLV) = 25
A9:B13 tabla ARL: I 0.00522 | II 0.01044 | III 0.02436 | IV 0.0435 | V 0.0696
B15 ID carpeta Drive raíz (vacío = el script la crea y escribe el ID aquí)
B16 Enviar correo con la factura a la contratista (Sí/No)
B17 Correo del supervisor para avisos (opcional)
B18 Tolerancia SS en pesos = 100

## CONTRATOS (fila 1 encabezados, datos desde fila 2)
A Nombre completo | B Cédula | C Dirección | D Teléfono | E Ciudad | F Cargo | G N.º contrato | H Objeto
I Fecha inicio | J Fecha terminación | K Honorario mensual | L Valor total contrato | M Riesgo ARL inicial (I..V)
N Riesgo ARL nuevo (opcional) | O Desde (fecha día 1, opcional) | P Revisó nombre | Q Revisó cargo | R Activo (Sí/No) | S Correo (opcional)

## CARGA (fila 1 encabezados, datos desde fila 2). El SCRIPT escribe todas las columnas (valores, no fórmulas), salvo T y U que llena el supervisor.
A Marca de tiempo | B Contratista (nombre exacto de CONTRATOS!A) | C Mes a cobrar (fecha día 1) | D Fecha inicio periodo | E Fecha corte periodo
F N.º planilla (texto) | G Mes cotizado (fecha día 1) | H Valor SS declarado | I N.º documento (AAAAMM) | J Días | K Valor del periodo
L Acumulado a la fecha | M % ejecución (fracción) | N SS esperada (número) | O Desglose SS (texto) | P Estado ("✅ OK" | "🟡 REVISAR" | "🔴 ERROR")
Q Mensaje | R URL PDF planilla | S URL de la cuenta de cobro en EXCEL (el encabezado original "URL PDF factura" pasa a "URL factura (Excel)" al migrar) | T Observación supervisor | U Aprobado (Sí/No) | V Lectura ("auto" si los datos se leyeron del PDF sin cambios, "corregido" si la contratista los editó, "manual" si no se pudo leer)
Columnas v3 / v3.1 (las agrega la función actualizarHojaV3; antes de migrar CARGA tiene 22 columnas A..V y la app solo maneja 1 planilla):
W Planilla 2 n.º | X Planilla 2 mes cotizado (fecha día 1) | Y Planilla 2 valor | Z/AA/AB Planilla 3 (n.º, mes cotizado, valor) | AC/AD/AE Planilla 4 (n.º, mes cotizado, valor)
AF Días cobrados manualmente (vacío = días calculados por fechas) | AG Motivo de la novedad | AH URLs PDFs adicionales (una por línea) | AI URL PDF factura (v3.1: el PDF de la cuenta de cobro, copia de lectura; si la hoja no la tiene la app funciona igual y el link del PDF solo va en el correo; actualizarHojaV3 la agrega sin tocar nada más)
Las planillas 2..4 (correcciones, ajustes de ARL, meses anteriores) son opcionales; cada una lleva UN solo valor total pagado sin intereses de mora, siempre positivo. Solo la planilla principal (F..H) se compara contra lo esperado.
Si AF tiene valor: K = ROUND(honorario × AF / 30), y el acumulado y el % se calculan con ese valor.
Las alertas NO bloquean: P (Estado) y Q (Mensaje) las registran y la cuenta de cobro se genera siempre. Solo bloquea la falta de un dato obligatorio (mes a cobrar, fechas válidas, planilla con n.º y valor) o un formato imposible (n.º con letras, fechas fuera del contrato).
P: "🟡 REVISAR" = cotizó más de lo esperado, planilla repetida, mes cotizado raro, ARL con otra tarifa, días a mano. "🔴 ERROR" = cotizó menos de lo que corresponde.
Clave única: (B, C). Un reenvío del mismo contratista+mes REEMPLAZA la fila.

## FACTURA (formato oficial HOMO)
FACTURA!P1 = número de fila de CARGA a imprimir (lo escribe el script antes de exportar). Todas las celdas variables leen con INDEX(CARGA!col, $P$1) y los datos fijos con INDEX(CONTRATOS!col, MATCH(nombre, CONTRATOS!A:A, 0)).
Después de migrar a v3, FACTURA tiene 3 filas nuevas (29, 30 y 31) justo debajo de la fila de "planilla pila" (28), con el mismo formato y combinadas. Leen las columnas W..AE de CARGA con INDEX(...,$P$1) y quedan vacías si no hay esa planilla; el script OCULTA las filas vacías antes de exportar y las vuelve a mostrar al terminar.
Área a exportar: A1:N{última fila con contenido}, calculada por el script (A1:N48 con el formato original; A1:N51 después de migrar), carta vertical, ajustar a 1 página.
La cuenta de cobro se entrega en EXCEL (principal, "AAAAMM - NOMBRE - Cuenta de cobro.xlsx") y en PDF (copia de lectura, mismo nombre .pdf); ambos se guardan en la carpeta del mes y se adjuntan al correo de la contratista. Excel: el script crea una hoja de cálculo temporal (carpeta _temporal), copia FACTURA con sheet.copyTo, pone TODO como valores (los de la hoja original ya calculados), ELIMINA (deleteRows, no oculta) las filas de planillas adicionales vacías, borra la columna P y lo que queda fuera de A1:N(última), deja una sola hoja "FACTURA", exporta con /export?format=xlsx y manda la temporal a la papelera. Si falla uno de los dos formatos, el otro se entrega con aviso.

## PANEL
B2 = Mes de revisión (fecha día 1). Resto con fórmulas de Google Sheets.

## Interfaz del lector de planillas (archivo Parser.gs, función pura, sin APIs de Google)
parsePlanillaText(texto) -> {
  numero: string|null,        // n.º de planilla, solo dígitos
  periodo: 'AAAA-MM'|null,    // periodo de cotización de pensión/salud
  salud: number|null, pension: number|null, arl: number|null,   // valores liquidados, sin intereses de mora
  ccf: number|null, mora: number|null, total: number|null,
  ibc: number|null, dias: number|null, tarifaArl: number|null,  // ej. 0.02436
  confianza: 'alta'|'media'|'baja', notas: string[]
}
El texto viene de convertir el PDF a Google Doc con OCR (Drive API) — el orden/espaciado puede diferir de pdftotext.
