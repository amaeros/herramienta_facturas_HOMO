// Generador de la cuenta de cobro (documento equivalente a la factura, formato oficial HOMO GJ-CO-FR-15 v02).
// Llena la plantilla src/assets/plantilla_factura.xlsx (hoja FACTURA) con ExcelJS y devuelve el .xlsx.
//
// Mapa de celdas (ver legacy/apps-script/CONTRATO_DATOS.md):
//   B8 nombre · B10 cédula · B12 dirección · B14 teléfono · B16 ciudad
//   H8 n.º documento (AAAAMM) · H11 fecha de expedición (texto) · H14 n.º de contrato
//   G21 fecha inicial · L21 fecha final · G22 valor del periodo · L22 acumulado
//   B25 objeto · K25 % ejecución · L25 valor total del contrato
//   Fila 28: B seguridad social · G n.º planilla · L mes cotizado (+ filas extra de planillas adicionales)
//   Pie: B38 nombre · B39 "C.C: " + cédula · C42 proyectó · G42 cargo · M42/M43 fecha · C43/G43 revisó

import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

export type PlanillaAdicional = {
  numero: string;
  /** Mes cotizado, 'YYYY-MM'. */
  mes: string;
  /** Valor de seguridad social de esa planilla. */
  valor: number;
};

export type DatosFactura = {
  nombre: string;
  cedula: string;
  direccion: string;
  telefono: string;
  ciudad: string;
  cargo: string;
  numeroContrato: string;
  objeto: string;
  valorTotalContrato: number;
  revisoNombre: string;
  revisoCargo: string;
  /** AAAAMM del mes cobrado. */
  docNum: string;
  /** YYYY-MM-DD */
  fechaInicio: string;
  /** YYYY-MM-DD (también es la fecha de expedición). */
  fechaCorte: string;
  valorPeriodo: number;
  acumulado: number;
  /** Salud + pensión + ARL de la planilla principal. */
  ssDeclarada: number;
  planillaNumero: string;
  /** Mes cotizado de la planilla principal, 'YYYY-MM'. */
  planillaMes: string;
  /** Hasta 3 planillas adicionales (correcciones, ajustes de ARL...). */
  adicionales: PlanillaAdicional[];
};

const MAX_ADICIONALES = 3;
const FILA_PLANILLA = 28; // fila de la planilla principal
const ULTIMA_FILA = 48; // última fila de la plantilla
const ULTIMA_COLUMNA = 14; // N
const RUTA_PLANTILLA = ['src', 'assets', 'plantilla_factura.xlsx'];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

let plantillaEnMemoria: Buffer | null = null;
async function leerPlantilla(): Promise<Buffer> {
  if (!plantillaEnMemoria) {
    // la plantilla entra al paquete por outputFileTracingIncludes (next.config.ts), no por trazado
    plantillaEnMemoria = await fs.promises.readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), ...RUTA_PLANTILLA));
  }
  return plantillaEnMemoria;
}

function partesFecha(iso: string): { y: number; m: number; d: number } {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!r) throw new Error('Fecha inválida (se espera YYYY-MM-DD): ' + iso);
  return { y: Number(r[1]), m: Number(r[2]), d: Number(r[3]) };
}

function fechaExcel(iso: string): Date {
  const { y, m, d } = partesFecha(iso);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "DD de mes de AAAA" con el mes en minúscula, como en la plantilla original. */
function fechaTexto(iso: string): string {
  const { y, m, d } = partesFecha(iso);
  return String(d).padStart(2, '0') + ' de ' + MESES[m - 1] + ' de ' + y;
}

/** Nombre del mes (Capitalizado) de 'YYYY-MM'. Vacío si no se puede leer. */
function nombreMes(ym: string): string {
  const r = /^(\d{4})-(\d{2})/.exec(ym || '');
  if (!r) return '';
  const m = Number(r[2]);
  if (m < 1 || m > 12) return '';
  return MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1);
}

/** Igual que PROPER() de Excel, dejando " de ", " del ", " la " y " y " en minúscula (como C42 de la plantilla). */
function nombreProyecto(nombre: string): string {
  let s = nombre.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_t, a: string, b: string) => a + b.toUpperCase());
  for (const [de, a] of [[' De ', ' de '], [' Del ', ' del '], [' La ', ' la '], [' Y ', ' y ']]) s = s.split(de).join(a);
  return s;
}

function cedulaConPuntos(cedula: string): string {
  const limpia = String(cedula ?? '').trim();
  return /^\d+$/.test(limpia) ? limpia.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : limpia;
}

/** Números de verdad cuando el texto es solo dígitos (como quedaba en la hoja original); texto en otro caso. */
function numeroOTexto(valor: string): string | number {
  const v = String(valor ?? '').trim();
  return /^\d{1,15}$/.test(v) ? Number(v) : v;
}

type Instantanea = { alto: number | undefined; celdas: { valor: ExcelJS.CellValue; estilo: Partial<ExcelJS.Style> }[] };

function tomarFila(ws: ExcelJS.Worksheet, r: number): Instantanea {
  const row = ws.getRow(r);
  const celdas: Instantanea['celdas'] = [];
  for (let c = 1; c <= ULTIMA_COLUMNA; c++) {
    const cell = row.getCell(c);
    const esEsclava = cell.isMerged && cell.master.address !== cell.address;
    celdas.push({ valor: esEsclava ? null : cell.value, estilo: { ...cell.style } });
  }
  return { alto: row.height, celdas };
}

function ponerFila(ws: ExcelJS.Worksheet, r: number, snap: Instantanea, conValores: boolean) {
  const row = ws.getRow(r);
  row.height = snap.alto as number;
  snap.celdas.forEach((s, i) => {
    const cell = row.getCell(i + 1);
    cell.value = conValores ? s.valor : null;
    cell.style = { ...s.estilo };
  });
}

function rangoDesplazado(rango: string, n: number): string {
  return rango.replace(/([A-Z]+)(\d+)/g, (_t, col: string, fila: string) => col + (Number(fila) + n));
}

/** Inserta n filas (copias del formato de la fila 28) justo debajo de la fila 28, desplazando todo lo de abajo. */
function insertarFilasPlanilla(ws: ExcelJS.Worksheet, n: number) {
  const primeraAbajo = FILA_PLANILLA + 1;
  const base = tomarFila(ws, FILA_PLANILLA);
  const abajo: Instantanea[] = [];
  for (let r = primeraAbajo; r <= ULTIMA_FILA; r++) abajo.push(tomarFila(ws, r));

  const combinadas = (ws.model.merges as string[]).filter((m) => {
    const fila = Number(/\d+/.exec(m)![0]);
    return fila >= primeraAbajo;
  });
  combinadas.forEach((m) => ws.unMergeCells(m));

  // Mover hacia abajo (de atrás hacia adelante no hace falta: ya hay una copia en memoria).
  abajo.forEach((snap, i) => ponerFila(ws, primeraAbajo + i + n, snap, true));
  // Filas nuevas: formato de la fila 28, sin valores.
  for (let i = 0; i < n; i++) ponerFila(ws, primeraAbajo + i, base, false);

  combinadas.forEach((m) => ws.mergeCellsWithoutStyle(rangoDesplazado(m, n)));
  for (let i = 0; i < n; i++) {
    const r = primeraAbajo + i;
    ws.mergeCellsWithoutStyle(`C${r}:F${r}`);
    ws.mergeCellsWithoutStyle(`G${r}:J${r}`);
  }
}

export async function generarFacturaXlsx(d: DatosFactura): Promise<Buffer> {
  const adicionales = d.adicionales ?? [];
  if (adicionales.length > MAX_ADICIONALES) {
    throw new Error('Máximo ' + MAX_ADICIONALES + ' planillas adicionales (recibidas: ' + adicionales.length + ')');
  }
  const n = adicionales.length;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await leerPlantilla()) as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet('FACTURA');
  if (!ws) throw new Error('La plantilla no tiene la hoja FACTURA');

  if (n > 0) insertarFilasPlanilla(ws, n);
  const desplazar = (fila: number) => (fila > FILA_PLANILLA ? fila + n : fila);

  const fechaCorteTexto = fechaTexto(d.fechaCorte);
  const cedulaTxt = String(d.cedula ?? '').trim();

  // Encabezado: contratista
  ws.getCell('B8').value = d.nombre;
  ws.getCell('B10').value = numeroOTexto(cedulaTxt);
  ws.getCell('B12').value = d.direccion;
  ws.getCell('B14').value = numeroOTexto(d.telefono);
  ws.getCell('B16').value = d.ciudad;
  // Documento
  ws.getCell('H8').value = /^\d+$/.test(d.docNum) ? Number(d.docNum) : d.docNum;
  ws.getCell('H11').value = fechaCorteTexto;
  ws.getCell('H14').value = d.numeroContrato;
  // Periodo y valores
  ws.getCell('G21').value = fechaExcel(d.fechaInicio);
  ws.getCell('L21').value = fechaExcel(d.fechaCorte);
  ws.getCell('G22').value = d.valorPeriodo;
  ws.getCell('L22').value = d.acumulado;
  ws.getCell('B25').value = d.objeto;
  ws.getCell('L25').value = d.valorTotalContrato;
  ws.getCell('K25').value = d.valorTotalContrato === 0 ? 0 : d.acumulado / d.valorTotalContrato;
  // Planilla principal
  ws.getCell('B' + FILA_PLANILLA).value = d.ssDeclarada;
  ws.getCell('G' + FILA_PLANILLA).value = String(d.planillaNumero ?? '');
  ws.getCell('L' + FILA_PLANILLA).value = nombreMes(d.planillaMes);
  // Planillas adicionales (una por fila, debajo de la 28)
  adicionales.forEach((p, i) => {
    const r = FILA_PLANILLA + 1 + i;
    ws.getCell('B' + r).value = p.valor;
    ws.getCell('C' + r).value = 'planilla pila #.';
    ws.getCell('G' + r).value = String(p.numero ?? '');
    ws.getCell('K' + r).value = ', mes cotizado.';
    ws.getCell('L' + r).value = nombreMes(p.mes);
  });
  // Pie de página
  ws.getCell('B' + desplazar(38)).value = d.nombre;
  ws.getCell('B' + desplazar(39)).value = 'C.C: ' + cedulaConPuntos(cedulaTxt);
  ws.getCell('C' + desplazar(42)).value = nombreProyecto(d.nombre);
  ws.getCell('G' + desplazar(42)).value = d.cargo;
  ws.getCell('M' + desplazar(42)).value = fechaCorteTexto;
  ws.getCell('M' + desplazar(43)).value = fechaCorteTexto;
  ws.getCell('C' + desplazar(43)).value = d.revisoNombre;
  ws.getCell('G' + desplazar(43)).value = d.revisoCargo;

  // Impresión: A1:N{última}, una página. ExcelJS antepone "$" a cada extremo, por eso "A$1".
  ws.pageSetup.printArea = 'A$1:N$' + (ULTIMA_FILA + n);
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 1;
  ws.pageSetup.orientation = 'portrait';
  ws.pageSetup.paperSize = 1 as ExcelJS.PaperSize; // Carta
  // ExcelJS escribe <pageSetUpPr> ANTES de <outlinePr> dentro de <sheetPr>; el esquema pide lo contrario y Excel
  // responde "Hemos encontrado un problema con el contenido". outlinePr solo trae los valores por defecto
  // (resumen abajo y a la derecha), así que no se escribe y queda nada que ordenar.
  delete (ws.properties as { outlineProperties?: unknown }).outlineProperties;

  wb.creator = 'Cuentas de cobro HOMO';
  wb.lastModifiedBy = 'Cuentas de cobro HOMO';
  wb.modified = new Date();

  const salida = await wb.xlsx.writeBuffer();
  return Buffer.from(salida as ArrayBuffer);
}

/** "AAAAMM - NOMBRE - Cuenta de cobro.xlsx", sin caracteres que dan problema en nombres de archivo. */
export function nombreArchivoFactura(docNum: string, nombre: string): string {
  const limpio = (s: string) =>
    String(s ?? '')
      .replace(/[\\/:*?"<>|#%]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  return `${limpio(docNum)} - ${limpio(nombre)} - Cuenta de cobro.xlsx`;
}
