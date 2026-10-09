/**
 * Pruebas del lector de documentos del contrato (contrato, acta de prorroga/adicion, poliza).
 * Todo el texto es SINTETICO: personas, cedulas, telefonos y direcciones inventados, con el mismo formato
 * y los mismos espacios raros que deja pdf.js en los PDF reales.
 */
import { describe, it, expect } from 'vitest';
import { leerDocumento } from '../documentos';

// ---------------------------------------------------------------------------
// Textos sinteticos
// ---------------------------------------------------------------------------

const OBJETO_INTERADMIN =
  'FORTALECER ACCIONES DE LA POLÍTICA PÚBLICA DE LAS MUJERES DESDE UN ENFOQUE SICOSOCIAL PARA LA GARANTÍA DE SUS DERECHOS HUMANOS.';

const ENCABEZADO_CONTRATO = [
  'CONTRATO N°  2026 CPS 99 9',
  'OBJETO:',
  'Prestación de servicios como Apoyo técnico/administrativo , en el marco de la',
  'ejecución del contrato interadministrativo N°4600018487 de 2025 , suscrito con la',
  'Secretaría de las Mujeres del Departamento de Antioquia, cuyo objeto es:',
  '“ FORTALECER ACCIONES DE LA POLÍTICA PÚBLICA DE LAS MUJERES DESDE',
  'UN ENFOQUE SICOSOCIAL PARA LA GARANTÍA DE SUS DERECHOS',
  'HUMANOS. ”',
  'Código: GJ - CO - FR - 2 3 Versión: 0 5 Fecha: 8 / 10 /202 5',
];

const CONTRATO = [
  ...ENCABEZADO_CONTRATO,
  '1',
  'NUMERO:  2026CPS 9 9 9',
  'CONTRATANTE: EMPRESA SOCIAL DEL ESTADO HOSPITAL MENTAL DE ANTIOQUIA MARIA UPEGUI - HOMO',
  'CONTRATISTA :  PRUEBA PÉREZ DE LA TORRE',
  'PLAZO :  Nueve (09) meses, contados a partir de la firma del acta de inicio',
  'TERMINACION :  Sin exceder el 30 de  Septiembre de 202 6 .',
  'VALOR:  $ 36.081.000',
  'Entre los suscritos a saber, GERENTE DE PRUEBA , identificado con la cédula de ciudadanía número',
  '32.000.111 , en su calidad de Gerente (E), nombrada mediante Decreto Departamental,',
  'HOSPITAL MENTAL DE ANTIOQUIA - HOMO, entidad pública con número de identificación tributaria 890.905.166 - 8, de',
  'una parte quien para efectos del presente contrato se denominará LA ENTIDAD CONTRATANTE, y PRUEBA PÉREZ DE LA',
  'TORRE con número de identificación  1.000.001.234 , persona natural, mayor de edad, qui en obra en su propio nombre y',
  'quien se denominará EL CONTRATISTA. 7. El HOMO, celebró el contrato interadministrativo N°',
  '4600018487 de 2025 con la Secretaría de las Mujeres, con una duración de once (11) meses y quince (15) días, sin',
  'exceder el 30 de septiembre de 2026 y por $ 2.646.635.715. 8. La Gobernación de Antioquia, reconoce la importancia',
  'Previsualización',
  '',
  ...ENCABEZADO_CONTRATO,
  '2',
  'y apoyo a la gestión, se fortalecen las intervenciones. Este contrato se regirá por las CLÁUSULAS que a continuación se',
  'expresan: PRIMERA. OBJETO . Prestación de servicios como Apoyo técnico/administrativo , en el marco de la ejecución',
  'del contrato interadministrativo N°4600018487 de 2025 , cuyo objeto es: “ ' + OBJETO_INTERADMIN + ' ” Parágrafo 1. Las actividades',
  'objeto del presente estudio previo deberán ser desempeñadas en la sede principal. SEGUNDO. VALOR DEL',
  'CONTRATO. La suma TREINTA Y SEIS MILLONES OCHENTA Y UN MIL PESOS ML. ($ 36.081.000 ). TERCERA.',
  'FORMA DE PAGO : La E.S.E. HOMO, entidad pública contrata nte, en contraprestación por los servicios que reciba durante',
  'la vigencia del presente contrato pagará por los servicios recibidos durante los meses de enero a septiembre de 2026 la',
  'suma de CUATRO MILLONES NUEVE MIL PESOS M/L ($ 4.009.000) , respectivamente, los honorarios equivalen a los',
  'días trabajados. Parágrafo 1 : Se reconocerán los debidos honorarios en un término de cinco (5) días hábiles.',
  'Previsualización',
].join('\n');

const ACTA = [
  'ACTA DE PRORROGA O ADICIÓN PARA EL',
  'CONTRATO',
  'Código: GJ-CO-FR-12 Versión: 03 Fecha: 22/01/2025',
  '1',
  'ADICIÓN Y PRORROGA No. 1',
  'INFORMACION DEL CONTRATISTA:',
  'Nombre o Razón Social  PRUEBA PÉREZ DE LA TORRE',
  'Representante legal L N/A',
  'Nit o cédula representante legal y/o persona',
  'natural',
  '1.000.001.234',
  'INFORMACION DEL CONTRATO:',
  'Número:  2026CPS999',
  'Objeto:  Prestación de servicios como Apoyo técnico/administrativo,',
  'en el marco de la ejecución del contrato interadministrativo',
  'N° 4600018487 de 2025, suscrito con la Secretaría de las',
  'Mujeres del Departamento de Antioquia, cuyo objeto es:',
  '“FORTALECER ACCIONES DE LA POLÍTICA PÚBLICA',
  'DE LAS MUJERES DESDE UN ENFOQUE SICOSOCIAL.”',
  'Fecha de Suscripción:  01 de enero de 2026',
  'Fecha Inicio del contrato  01 de enero de 2026',
  'Duración inicial: NUEVE (09) MESES , contados a partir de la fecha de',
  'inicio.',
  'Terminación inicial:  Sin exceder el 30 de  septiembre de 2026.',
  'Valor inicial del contrato  $36.081.000',
  'ADICIÓN N°1',
  'Adición N°1  $8.018.000',
  'Valor del contrato inicial más adición  $44.099.000',
  'PRÓRROGA N°1',
  'Prorroga N°1  DOS (02) MESES',
  'Plazo del contrato más prórrogas  ONCE (11) MESES .',
  'CONCEPTO DEL SUPERVISOR:',
  'Que la E.S.E Hospital Mental de Antioquia suscribió el contrato Nro. 2026CPS999 de 2026 con',
  'la contratista PRUEBA PÉREZ DE LA TORRE identificado/a con C.C. 1.000.001.234 , Que el objeto del contrato es:',
  'El día 04 de Agosto de 2026 la Secretaria de las Mujeres y el Hospital Mental suscribieron el OTROSÍ No. 1 (adición y prórroga) al',
  'contrato interadministrativo No. 460001848 7, adición por un valor de $2.646.635.715 (Dos mil seiscientos cuarenta y seis',
  'millones) y prórroga por dos (2) meses, para un valor total del contrato de Quince mil quinientos nueve millones',
  'treinta y siete mil ciento diez y seis pesos m/l ($15.509.037.116), exento del IVA y una prórroga',
  'Previsualización',
  '',
  'ACTA DE PRORROGA O ADICIÓN PARA EL',
  'CONTRATO',
  'Código: GJ-CO-FR-12 Versión: 03 Fecha: 22/01/2025',
  '2',
  'por dos (2) meses, para una duración total de 13.5 meses a partir de la suscripción del acta de inicio, sin superar el 30',
  'de noviembre de 2026.',
  'NOMBRE', 'DEL', 'CONTRATISTA', 'N°', 'CONTRATO', 'VALOR', 'ACTUAL', 'DEL', 'CONTRATO', 'VALOR', 'ADICIÓN', 'NO. 1',
  'VALOR', 'TOTAL CON', 'ADICIONES', 'PLAZO', 'ACTUAL DEL', 'CONTRATO', 'PLAZO', 'PRORROGA', 'N°1', 'PLAZO FINAL', 'CON', 'PRÓRROGAS',
  'PRUEBA', 'PÉREZ', 'DE LA TORRE',
  '2026CPS999 $36.081.000 $8.018.000 $44.099.000',
  'NUEVE (09)', 'MESES , sin', 'exceder el 30', 'de septiembre', 'de 2026.',
  'DOS (02)', 'MESES',
  'ONCE (11)', 'MESES , sin', 'exceder el 30 de', 'noviembre de', '2026.',
  'Se modifica la CLAUSULA CUARTA. DURACIÓN: Se prorroga DOS (02) MESES, por lo tanto, e l plazo del presente',
  'contrato será de ONCE (11) MESES contados a partir de la suscripción del acta de inicio, sin superar el 30 de noviembre',
  'de 2026 .',
  'Previsualización',
  '',
  'Cláusula SEGUNDA. VALOR DEL CONTRATO (ACTUAL). $36.081.000 ( TREINTA Y SEIS MILLONES OCHENTA Y UN MIL PESOS ) Teniendo',
  'Valor inicial del contrato $36.081.000',
  'Porcentaje de ejecución financiera del contrato: 88,8889%',
  'Valor adición No. 1: $8.018.000',
  'Valor total del contrato con adiciones $44.099.000',
  'LAS PARTES CONCEPTUAN FAVORABLE SOBRE EL OTORGAMIENTO DE UNA ADICION N°1 POR',
  'VALOR DE: OCHO MILLONES DIECIOCHO MIL PESOS MCTE M/L ( $8.018.000 ) POR LO QUE EL VALOR',
  'TOTAL DEL CONTRATO QUEDA ESTIPULADO EN LA SUMA DE CUARENTA Y CUATRO MILLONES',
  'NOVENTA Y NUEVE MIL PESOS MCTE ( $44.099.000 ) Y UNA PRORROGA DE DOS (02) MESES, PARA',
  'UN PLAZO TOTAL DE ONCE (11) MESES , FINALIZANDO EL 30 DE NOVIEMBRE DE 2026.',
  'Previsualización',
].join('\n');

const POLIZA = [
  'OBJETO DEL SEGURO',
  'FIRMA TOMADOR',
  'DATOS DEL TOMADOR / GARANTIZADO',
  'DATOS DEL ASEGURADO / BENEFICIARIO',
  'CIUDAD DE EXPEDICIÓN SUCURSAL COD.SUC NO.PÓLIZA ANEXO',
  'TIPO MOVIMIENTO',
  'VIGENCIA HASTA',
  'DÍA MES AÑO',
  'VIGENCIA DESDE',
  'DÍA MES AÑO',
  'FECHA EXPEDICIÓN',
  'DÍA MES AÑO',
  'NOMBRE O RAZON',
  'SOCIAL',
  'DIRECCIÓN: CIUDAD:',
  'IDENTIFICACIÓN',
  'TELÉFONO:',
  'OFICINA PRINCIPAL: AUTOPISTA NORTE # 103 - 60, PISO 5 TELEFONO: 601-2186977, 601-6019330',
  'USTED PUEDE CONSULTAR ESTA PÓLIZA EN WWW.SEGUROSDELESTADO.COM',
  'POLIZA DE SEGURO DE CUMPLIMIENTO ENTIDAD ESTATAL',
  'DECRETO 1082 DE 2015',
  'AGENCIA RIONEGRO 48 RIONEGRO',
  '01  10  2026  01  01  2026  00:00  30  03  2027  23:59  ANEXO DE PRORROGA',
  'PÉREZ DE LA TORRE, PRUEBA  CC: 1000.001.234',
  'CL 36 AA SUR 26 A 30  ENVIGADO, ANTIOQUIA  3001234567',
  'EMPRESA SOCIAL DEL ESTADO HOSPITAL MENTAL DE ANTIOQUIA',
  'CALLE 38 55 - 310 BELLO, ANTIOQUIA',
  'NIT: 890.905.166-8',
  '4548200',
  'Previsualización',
  '',
  'DATOS DEL TOMADOR / GARANTIZADO',
  'POLIZA DE SEGURO DE CUMPLIMIENTO ENTIDAD ESTATAL',
  '01 10 2026 01 01 2026 00:00 30 03 2027 23:59 ANEXO DE PRORROGA',
  'PÉREZ DE LA TORRE, PRUEBA',
  'CC: 1000.001.234',
  'CL 36 AA SUR 26 A 30 ENVIGADO, ANTIOQUIA 3001234567',
].join('\n');

// ---------------------------------------------------------------------------

describe('leerDocumento: contrato (GJ-CO-FR-23)', () => {
  const r = leerDocumento(CONTRATO);

  it('lo reconoce como contrato', () => {
    expect(r.tipo).toBe('contrato');
  });

  it('numero de contrato normalizado, sin espacios', () => {
    expect(r.campos.numeroContrato).toBe('2026CPS999');
  });

  it('nombre y cedula del contratista (no los del gerente ni el NIT del HOMO)', () => {
    expect(r.campos.nombre).toBe('PRUEBA PÉREZ DE LA TORRE');
    expect(r.campos.cedula).toBe('1000001234');
  });

  it('objeto: bloque del encabezado, en una sola linea, cerrando en la comilla', () => {
    const o = r.campos.objeto!;
    expect(o.startsWith('Prestación de servicios como Apoyo técnico/administrativo, en el marco de la ejecución')).toBe(true);
    expect(o.endsWith('HUMANOS.”')).toBe(true);
    expect(o).not.toMatch(/\s{2,}/);
    expect(o).not.toMatch(/\n/);
    expect(o).not.toMatch(/Código|Parágrafo|SEGUNDO/);
  });

  it('honorario de la forma de pago y valor total inicial', () => {
    expect(r.campos.honorario).toBe(4009000);
    expect(r.campos.valorTotal).toBe(36081000);
  });

  it('fin = TERMINACION (no la del contrato interadministrativo) y NO trae inicio', () => {
    expect(r.campos.fin).toBe('2026-09-30');
    expect(r.campos.inicio).toBeUndefined();
    expect(r.notas.join(' ')).toMatch(/no trae la fecha exacta de inicio/i);
  });
});

describe('leerDocumento: contrato con espacios raros y encabezado repetido', () => {
  it('tolera "2026CPS 0 4 3", "202 6" y fechas partidas', () => {
    const txt = [
      'CONTRATO N°  2026 CPS 0 4 3',
      'OBJETO:',
      'Prestación de servicios de apoyo a la gestión “ TEXTO DEL OBJETO DE PRUEBA PARA EL CONTRATO. ”',
      'Código: GJ - CO - FR - 2 3 Versión: 0 5',
      'NUMERO:  2026CPS 0 4 3',
      'CONTRATANTE: EMPRESA SOCIAL DEL ESTADO',
      'CONTRATISTA :  MARIA DE PRUEBA',
      'TERMINACION :  Sin exceder el 3 0 de  Sept iembre de 202 6 .',
      'VALOR:  $ 36 .081.000',
      'TERCERA. FORMA DE PAGO : pagará durante los meses de enero a septiembre de 2026 la suma de CUATRO MILLONES ($ 4 .009.000) , respectivamente',
    ].join('\n');
    const r = leerDocumento(txt);
    expect(r.tipo).toBe('contrato');
    expect(r.campos.numeroContrato).toBe('2026CPS043');
    expect(r.campos.nombre).toBe('MARIA DE PRUEBA');
    expect(r.campos.fin).toBe('2026-09-30');
    expect(r.campos.valorTotal).toBe(36081000);
    expect(r.campos.honorario).toBe(4009000);
    expect(r.campos.objeto).toBe('Prestación de servicios de apoyo a la gestión “TEXTO DEL OBJETO DE PRUEBA PARA EL CONTRATO.”');
  });

  it('numero con la P del contrato de planta (CPSP) y fin sin cabecera de valor', () => {
    const r = leerDocumento(CONTRATO.replace(/2026CPS 9 9 9/g, '2026 CPSP 18 7'));
    expect(r.campos.numeroContrato).toBe('2026CPSP187');
  });
});

describe('leerDocumento: contrato con meses de pago distintos', () => {
  // Contrato corto que empieza a mitad de mes: un pago partido y uno completo, con tilde/apóstrofo de millones.
  const CORTO = CONTRATO
    .replace('TERMINACION :  Sin exceder el 30 de  Septiembre de 202 6 .', 'TERMINACION: 30 de noviembre de 2026')
    .replace('VALOR:  $ 36.081.000', 'VALOR: $15.473.333')
    .replace(/pagará por los servicios recibidos durante los meses de enero a septiembre de 2026 la\nsuma de CUATRO MILLONES NUEVE MIL PESOS M\/L \(\$ 4\.009\.000\) , respectivamente,/,
      'pagará la suma de ($7´033.333) SIETE MILLONES TREINTA Y TRES MIL PESOS MCTE en el mes de octubre de 2026 y la\nsuma de ( $8’440.000) OCHO MILLONES CUATROCIENTOS CUARENTA MIL PESOS MCTE , en el mes de noviembre de 2026 respectivamente,');

  it('lee montos con tilde o apóstrofo de millones', () => {
    expect(leerDocumento(CORTO).campos.valorTotal).toBe(15473333);
  });
  it('honorario = el del mes completo, no el del mes partido', () => {
    const r = leerDocumento(CORTO);
    expect(r.campos.honorario).toBe(8440000);
    expect(r.notas.join(' ')).toMatch(/mes completo/);
  });
  it('deduce el inicio del pago partido (25 días de octubre -> 06/10) y avisa que hay que confirmarlo', () => {
    const r = leerDocumento(CORTO);
    expect(r.campos.inicio).toBe('2026-10-06');
    expect(r.campos.fin).toBe('2026-11-30');
    expect(r.notas.join(' ')).toMatch(/confírmala/);
    expect(r.notas.join(' ')).not.toMatch(/no trae la fecha exacta de inicio/);
  });
});

describe('leerDocumento: acta de prorroga o adicion (GJ-CO-FR-12)', () => {
  const r = leerDocumento(ACTA);

  it('lo reconoce como acta (aunque menciona el contrato y su forma de pago)', () => {
    expect(r.tipo).toBe('acta_prorroga');
  });

  it('numero, nombre y cedula', () => {
    expect(r.campos.numeroContrato).toBe('2026CPS999');
    expect(r.campos.nombre).toBe('PRUEBA PÉREZ DE LA TORRE');
    expect(r.campos.cedula).toBe('1000001234');
  });

  it('objeto hasta la comilla de cierre, sin "Fecha de Suscripción"', () => {
    const o = r.campos.objeto!;
    expect(o.startsWith('Prestación de servicios como Apoyo técnico/administrativo, en el marco de la ejecución')).toBe(true);
    expect(o.endsWith('SICOSOCIAL.”')).toBe(true);
    expect(o).not.toMatch(/Fecha/);
  });

  it('inicio = "Fecha Inicio del contrato"', () => {
    expect(r.campos.inicio).toBe('2026-01-01');
  });

  it('fin = la NUEVA terminacion (no la inicial ni la del interadministrativo)', () => {
    expect(r.campos.fin).toBe('2026-11-30');
  });

  it('valorTotal = valor con adiciones (no los montos del interadministrativo)', () => {
    expect(r.campos.valorTotal).toBe(44099000);
  });

  it('honorario deducido de la adicion / meses de prorroga, con nota', () => {
    expect(r.campos.honorario).toBe(4009000);
    expect(r.notas.join(' ')).toMatch(/dedujo/i);
  });

  it('sin "FINALIZANDO", toma el ultimo "sin exceder el" de la tabla', () => {
    const sin = ACTA.replace('FINALIZANDO EL 30 DE NOVIEMBRE DE 2026', 'TERMINANDO');
    const r2 = leerDocumento(sin);
    expect(r2.campos.fin).toBe('2026-11-30');
  });

  it('con espacios raros en fechas y montos', () => {
    const raro = ACTA
      .replace('Fecha Inicio del contrato  01 de enero de 2026', 'Fecha Inicio del contrato  0 1 de enero de 202 6')
      .replace('FINALIZANDO EL 30 DE NOVIEMBRE DE 2026', 'FINALIZANDO EL 3 0 DE NOVIEM BRE DE 202 6')
      .replace('Valor total del contrato con adiciones $44.099.000', 'Valor total del contrato con adiciones $ 44 .099.000');
    const r2 = leerDocumento(raro);
    expect(r2.campos.inicio).toBe('2026-01-01');
    expect(r2.campos.fin).toBe('2026-11-30');
    expect(r2.campos.valorTotal).toBe(44099000);
  });

  it('solo adicion (sin prorroga): usa la terminacion inicial y avisa', () => {
    const soloAd = [
      'ACTA DE PRORROGA O ADICIÓN PARA EL', 'CONTRATO', 'Código: GJ-CO-FR-12 Versión: 03 Fecha: 22/01/2025',
      'Nombre o Razón Social  PRUEBA PÉREZ DE LA TORRE', 'Representante legal L N/A',
      'Nit o cédula representante legal y/o persona', 'natural', '1.000.001.234',
      'Número:  2026CPS999', 'Fecha Inicio del contrato  01 de enero de 2026',
      'Terminación inicial:  Sin exceder el 30 de  septiembre de 2026.',
      'Valor inicial del contrato  $36.081.000', 'Adición N°1  $8.018.000',
      'Valor del contrato inicial más adición  $44.099.000',
    ].join('\n');
    const r2 = leerDocumento(soloAd);
    expect(r2.tipo).toBe('acta_prorroga');
    expect(r2.campos.fin).toBe('2026-09-30');
    expect(r2.campos.valorTotal).toBe(44099000);
    expect(r2.campos.honorario).toBeUndefined();
    expect(r2.notas.join(' ')).toMatch(/terminaci[oó]n inicial/i);
  });
});

describe('leerDocumento: poliza de cumplimiento', () => {
  const r = leerDocumento(POLIZA);

  it('lo reconoce como poliza', () => {
    expect(r.tipo).toBe('poliza');
  });

  it('inicio = vigencia DESDE (no la expedicion ni la vigencia hasta)', () => {
    expect(r.campos.inicio).toBe('2026-01-01');
  });

  it('NUNCA pone fin (la vigencia hasta cubre meses mas alla) y lo dice en las notas', () => {
    expect(r.campos.fin).toBeUndefined();
    const n = r.notas.join(' ');
    expect(n).toMatch(/no indica la fecha de fin del contrato/i);
    expect(n).toMatch(/vigencia hasta/i);
  });

  it('nombre reordenado de "APELLIDOS, NOMBRES" a "NOMBRES APELLIDOS"', () => {
    expect(r.campos.nombre).toBe('PRUEBA PÉREZ DE LA TORRE');
  });

  it('cedula sin puntos (formato raro "1000.001.234")', () => {
    expect(r.campos.cedula).toBe('1000001234');
  });

  it('direccion, ciudad y telefono del tomador (no los del HOMO)', () => {
    expect(r.campos.direccion).toBe('CL 36 AA SUR 26 A 30');
    expect(r.campos.ciudad).toBe('Envigado');
    expect(r.campos.telefono).toBe('3001234567');
  });

  it('no inventa campos que la poliza no trae', () => {
    expect(r.campos.honorario).toBeUndefined();
    expect(r.campos.valorTotal).toBeUndefined();
    expect(r.campos.objeto).toBeUndefined();
  });

  it('con espacios raros en las fechas', () => {
    const raro = POLIZA.replace(/01 {1,2}10 {1,2}2026 {1,2}01 {1,2}01 {1,2}2026/g, '0 1  1 0  202 6  0 1  0 1  202 6');
    const r2 = leerDocumento(raro);
    expect(r2.tipo).toBe('poliza');
    expect(r2.campos.inicio).toBe('2026-01-01');
  });

  it('ciudad de dos palabras y letra suelta al final de la direccion', () => {
    const txt = POLIZA.replace('CL 36 AA SUR 26 A 30  ENVIGADO, ANTIOQUIA', 'CRA 10 # 20-30 B  LA ESTRELLA, ANTIOQUIA')
      .replace('CL 36 AA SUR 26 A 30 ENVIGADO, ANTIOQUIA', 'CRA 10 # 20-30 B LA ESTRELLA, ANTIOQUIA');
    const r2 = leerDocumento(txt);
    expect(r2.campos.direccion).toBe('CRA 10 # 20-30 B');
    expect(r2.campos.ciudad).toBe('La Estrella');
  });

  it('nombre y movimiento en lineas partidas', () => {
    const txt = POLIZA.replace('01  10  2026  01  01  2026  00:00  30  03  2027  23:59  ANEXO DE PRORROGA\nPÉREZ DE LA TORRE, PRUEBA  CC: 1000.001.234',
      '01  10  2026  01  01  2026  00:00  30  03  2027  23:59\nANEXO DE PRORROGA\nPÉREZ DE LA TORRE,\nPRUEBA  CC:\n1000.001.234');
    const r2 = leerDocumento(txt);
    expect(r2.campos.nombre).toBe('PRUEBA PÉREZ DE LA TORRE');
    expect(r2.campos.cedula).toBe('1000001234');
  });
});

describe('leerDocumento: documentos desconocidos y robustez', () => {
  it('texto cualquiera -> desconocido con nota', () => {
    const r = leerDocumento('Receta de arepas: harina, agua y sal. Amasar bien y dejar reposar la masa quince minutos antes de asar.');
    expect(r.tipo).toBe('desconocido');
    expect(r.campos).toEqual({});
    expect(r.notas.length).toBeGreaterThan(0);
  });

  it('una planilla PILA no se confunde con un contrato', () => {
    const r = leerDocumento('Resumen General de Pago Planilla Resumen Aportes en Linea clave planilla 1234567890 periodo 2026-09 AFP EPS ARL CCF total a pagar $ 887.900');
    expect(r.tipo).toBe('desconocido');
  });

  it('texto vacio / sin texto -> desconocido y avisa que puede estar escaneado', () => {
    const r = leerDocumento('');
    expect(r.tipo).toBe('desconocido');
    expect(r.notas.join(' ')).toMatch(/no trae texto/i);
  });

  it('nunca lanza error con entradas raras', () => {
    expect(() => leerDocumento(undefined as unknown as string)).not.toThrow();
    expect(() => leerDocumento(null as unknown as string)).not.toThrow();
    expect(() => leerDocumento(12345 as unknown as string)).not.toThrow();
    expect(() => leerDocumento('\u0000￿'.repeat(50))).not.toThrow();
    expect(leerDocumento(undefined as unknown as string).tipo).toBe('desconocido');
  });

  it('solo llena los campos que encuentra (contrato recortado)', () => {
    const r = leerDocumento('CONTRATO N° 2026 CPS 99 9 NUMERO: 2026CPS999 CONTRATANTE: EMPRESA SOCIAL DEL ESTADO Código: GJ - CO - FR - 2 3 CONTRATISTA : PRUEBA PEREZ PLAZO : nueve meses');
    expect(r.tipo).toBe('contrato');
    expect(r.campos.numeroContrato).toBe('2026CPS999');
    expect(r.campos.nombre).toBe('PRUEBA PEREZ');
    expect('honorario' in r.campos).toBe(false);
    expect('fin' in r.campos).toBe(false);
    expect('valorTotal' in r.campos).toBe(false);
  });

  it('el tipo "contrato" no se confunde con una poliza aunque mencione la poliza de cumplimiento en las garantias', () => {
    const r = leerDocumento(CONTRATO + '\nGARANTÍAS: el contratista constituirá una póliza de seguro de cumplimiento a favor de la entidad.');
    expect(r.tipo).toBe('contrato');
  });
});
