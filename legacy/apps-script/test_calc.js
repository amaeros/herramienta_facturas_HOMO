#!/usr/bin/env node
/**
 * test_calc.js - Pruebas de Calc.gs (reglas de negocio) con node.
 * Uso: node test_calc.js
 * Carga Calc.gs con vm (sin require/import dentro del archivo).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'Calc.gs'), 'utf8'), ctx, { filename: 'Calc.gs' });
const Calc = vm.runInContext('Calc', ctx);

let pasan = 0, fallan = 0;
function eq(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) pasan++; else fallan++;
  console.log((ok ? 'OK    ' : 'FALLA ') + nombre + (ok ? '' : '\n        real:     ' + JSON.stringify(real) + '\n        esperado: ' + JSON.stringify(esperado)));
}
function cierto(nombre, cond, extra) {
  if (cond) pasan++; else fallan++;
  console.log((cond ? 'OK    ' : 'FALLA ') + nombre + (cond ? '' : '  ' + (extra || '')));
}

// ----------------------------------------------------------------- datos de la hoja
const PARAMS = {
  pctIbc: 0.40, pctSalud: 0.125, pctPension: 0.16, smmlv: 1750905, piso: 1, techo: 25,
  arl: { I: 0.00522, II: 0.01044, III: 0.02436, IV: 0.0435, V: 0.0696 }, tolerancia: 100
};
const ANA = { inicio: '2026-01-01', fin: '2026-09-30', honorario: 7174000, total: 64566000, riesgo: 'III', riesgoNuevo: '', desde: '' };
const LAURA = { inicio: '2026-01-16', fin: '2026-09-30', honorario: 7174000, total: 60979000, riesgo: 'I', riesgoNuevo: 'III', desde: '2026-05-01' };
const ERIKA = { inicio: '2026-01-28', fin: '2026-09-30', honorario: 5064000, total: 41356000, riesgo: 'I', riesgoNuevo: 'III', desde: '2026-06-01' };
const ANA_I = Object.assign({}, ANA, { riesgo: 'I' });          // caso "honorario 7.174.000 riesgo I"
const ERIKA_I = Object.assign({}, ERIKA, { riesgoNuevo: '', desde: '' });
const ERIKA_III = Object.assign({}, ERIKA, { riesgo: 'III', riesgoNuevo: '', desde: '' });

console.log('\n== Periodo, dias y valor ==');
let p = Calc.expectedPeriod('2026-01', LAURA.inicio, LAURA.fin);
eq('Laura enero: inicio 16/01 y corte 30/01', p, { inicio: '2026-01-16', corte: '2026-01-30' });
eq('Laura enero: 15 dias', Calc.commercialDays(p.inicio, p.corte), 15);
eq('Laura enero: valor 3.587.000', Calc.periodValue(LAURA.honorario, 15), 3587000);
p = Calc.expectedPeriod('2026-01', ERIKA.inicio, ERIKA.fin);
eq('Erika enero: inicio 28/01 y corte 30/01', p, { inicio: '2026-01-28', corte: '2026-01-30' });
eq('Erika enero: 3 dias', Calc.commercialDays(p.inicio, p.corte), 3);
eq('Erika enero: valor 506.400', Calc.periodValue(ERIKA.honorario, 3), 506400);
eq('Marzo 01 al 31 -> 30 dias', Calc.commercialDays('2026-03-01', '2026-03-31'), 30);
eq('Marzo esperado: corte dia 30', Calc.expectedPeriod('2026-03', ANA.inicio, ANA.fin), { inicio: '2026-03-01', corte: '2026-03-30' });
eq('Febrero 01 al 28 -> 30 dias', Calc.commercialDays('2026-02-01', '2026-02-28'), 30);
eq('Febrero 2026 esperado: 01 al 28', Calc.expectedPeriod('2026-02', ANA.inicio, ANA.fin), { inicio: '2026-02-01', corte: '2026-02-28' });
eq('Febrero bisiesto 2028: 01 al 29 -> 30 dias', Calc.commercialDays('2028-02-01', '2028-02-29'), 30);
eq('Febrero 01 al 28: valor completo', Calc.periodValue(ANA.honorario, 30), 7174000);
eq('Febrero 01 al 27 -> 27 dias', Calc.commercialDays('2026-02-01', '2026-02-27'), 27);
eq('Mes de 31 dias, corte 30 -> 30 dias', Calc.commercialDays('2026-01-01', '2026-01-30'), 30);
eq('Termina 31/12: corte 30/12', Calc.expectedPeriod('2026-12', '2026-01-01', '2026-12-31'), { inicio: '2026-12-01', corte: '2026-12-30' });
eq('Termina 15/09: corte 15/09 (15 dias)', Calc.expectedPeriod('2026-09', '2026-01-01', '2026-09-15'), { inicio: '2026-09-01', corte: '2026-09-15' });
eq('Termina 28/02: corte 28/02 (30 dias)', Calc.commercialDays('2026-02-01', '2026-02-28'), 30);
eq('Mes fuera de vigencia -> null', Calc.expectedPeriod('2025-12', ANA.inicio, ANA.fin), null);
eq('Meses del contrato Ana: 9', Calc.monthsBetween(ANA.inicio, ANA.fin).length, 9);
eq('N.º documento sep 2026', Calc.docNumber('2026-09'), 202609);

console.log('\n== Seguridad social esperada ==');
let s = Calc.expectedSS(7174000, 'III', PARAMS);
eq('7.174.000 riesgo III: 358.700 + 459.200 + 70.000 = 887.900', [s.salud, s.pension, s.arl, s.total], [358700, 459200, 70000, 887900]);
s = Calc.expectedSS(7174000, 'I', PARAMS);
eq('7.174.000 riesgo I: 832.900', [s.salud, s.pension, s.arl, s.total], [358700, 459200, 15000, 832900]);
s = Calc.expectedSS(5064000, 'I', PARAMS);
eq('5.064.000 riesgo I: 253.200 + 324.100 + 10.600 = 587.900', [s.salud, s.pension, s.arl, s.total], [253200, 324100, 10600, 587900]);
s = Calc.expectedSS(5064000, 'III', PARAMS);
eq('5.064.000 riesgo III: 626.700', [s.salud, s.pension, s.arl, s.total], [253200, 324100, 49400, 626700]);
eq('Desglose en texto', Calc.expectedSS(7174000, 'III', PARAMS).desglose, 'salud 358.700 + pensión 459.200 + ARL 70.000 (riesgo III)');
s = Calc.expectedSS(4009000, 'I', PARAMS);
eq('Honorario bajo: aplica piso 1 SMMLV (IBC 1.750.905)', s.ibc, 1750905);
s = Calc.expectedSS(200000000, 'I', PARAMS);
eq('Honorario muy alto: aplica techo 25 SMMLV', s.ibc, 1750905 * 25);
eq('ROUNDUP centena sin ruido decimal (100.000 exacto)', Calc.ceil100(100000.00000000001), 100000);
eq('ROUNDUP centena (100.001 -> 100.100)', Calc.ceil100(100001), 100100);

console.log('\n== ARL con cambio de riesgo por mes ==');
eq('Laura abril (riesgo I)', Calc.riskFor(LAURA, '2026-04'), 'I');
eq('Laura mayo (riesgo III, desde 01/05)', Calc.riskFor(LAURA, '2026-05'), 'III');
eq('Erika mayo (I) y junio (III)', [Calc.riskFor(ERIKA, '2026-05'), Calc.riskFor(ERIKA, '2026-06')], ['I', 'III']);
eq('Ana siempre III', [Calc.riskFor(ANA, '2026-01'), Calc.riskFor(ANA, '2026-09')], ['III', 'III']);
eq('Laura SS abril = 832.900, mayo = 887.900',
  [Calc.expectedSS(LAURA.honorario, Calc.riskFor(LAURA, '2026-04'), PARAMS).total, Calc.expectedSS(LAURA.honorario, Calc.riskFor(LAURA, '2026-05'), PARAMS).total],
  [832900, 887900]);
eq('Erika SS mayo = 587.900, junio = 626.700',
  [Calc.expectedSS(ERIKA.honorario, Calc.riskFor(ERIKA, '2026-05'), PARAMS).total, Calc.expectedSS(ERIKA.honorario, Calc.riskFor(ERIKA, '2026-06'), PARAMS).total],
  [587900, 626700]);

console.log('\n== Acumulados ==');
function acumuladoAlMes(c, mes) { return Calc.cumulative(c, mes, {}); }
let a = acumuladoAlMes(ANA, '2026-09');
eq('Ana a septiembre: 64.566.000 = 100 %', [a.acumulado, a.pct], [64566000, 1]);
a = acumuladoAlMes(LAURA, '2026-09');
eq('Laura a septiembre: 60.979.000', a.acumulado, 60979000);
cierto('Laura a septiembre: 100 %', Math.abs(a.pct - 1) < 1e-12);
a = acumuladoAlMes(ERIKA, '2026-09');
eq('Erika a septiembre: 41.018.400', a.acumulado, 41018400);
cierto('Erika a septiembre: 99,18 %', Math.abs(a.pct * 100 - 99.18) < 0.005, String(a.pct * 100));
eq('Erika a enero: 506.400', acumuladoAlMes(ERIKA, '2026-01').acumulado, 506400);
eq('Laura a febrero: 3.587.000 + 7.174.000', acumuladoAlMes(LAURA, '2026-02').acumulado, 10761000);
eq('Acumulado usa el valor guardado si hay fila (novedad en febrero)', Calc.cumulative(ANA, '2026-02', { '2026-01': 7174000, '2026-02': 6000000 }).acumulado, 13174000);

console.log('\n== Evaluacion (semaforo y mensajes) ==');
function ev(contrato, mes, planilla, extra) {
  return Calc.evaluate(Object.assign({ contrato: contrato, params: PARAMS, mes: mes, periodo: null, planilla: planilla, otras: [] }, extra || {}));
}
let r = ev(ANA, '2026-09', { numero: '9509633245', mesCotizado: '2026-09', salud: 358700, pension: 459200, arl: 70000 });
eq('Ana sep con planilla correcta: OK', [r.estado, r.estadoTexto, r.dias, r.valor, r.docNum], ['OK', '✅ OK', 30, 7174000, 202609]);
eq('Mensaje OK', r.mensaje, 'Todo en orden: la planilla de Septiembre 2026 coincide con lo esperado');
r = ev(ANA, '2026-09', { numero: '9509633245', mesCotizado: '2026-09', salud: 358700, pension: 459200, arl: 15000 });
eq('ARL de $15.000 con riesgo III (menor a lo esperado): 🔴 ERROR pero NO bloquea', [r.estado, r.bloquea], ['ERROR', false]);
cierto('Mensaje de ARL menor: dice cuanto cotizo, cuanto debe ser y que concepto falta',
  r.mensaje.indexOf('Cotizaste $832.900 y para este contrato debe ser al menos $887.900') >= 0 && r.mensaje.indexOf('ARL (cotizaste $15.000, debe ser $70.000)') >= 0, r.mensaje);
r = ev(ANA, '2026-09', { numero: '9509633245', mesCotizado: '2026-09', salud: 358750, pension: 459250, arl: 70050 });
eq('Diferencias dentro de la tolerancia ($100): OK', r.estado, 'OK');
r = ev(ANA, '2026-09', { numero: '9509633245', mesCotizado: '2026-09', salud: 358701, pension: 459200, arl: 70101 });
eq('ARL $101 por encima (tarifa distinta): 🟡 REVISAR, no bloquea', [r.estado, r.bloquea], ['REVISAR', false]);
cierto('Mensaje de ARL mayor habla del riesgo', /La ARL de tu planilla es \$70\.101 pero para tu riesgo III es \$70\.000/.test(r.mensaje), r.mensaje);
r = ev(ANA, '2026-07', { numero: '9507123456', mesCotizado: '2026-07', total: 905200 });
eq('Solo total (caja incluida, 905.200 vs 887.900): 🟡 REVISAR (mayor)', [r.estado, r.bloquea], ['REVISAR', false]);
r = ev(ANA, '2026-07', { numero: '9507123456', mesCotizado: '2026-07', total: 887900 });
eq('Solo total correcto: OK', r.estado, 'OK');
// Laura septiembre cobrando con planilla de agosto (riesgo III desde mayo)
r = ev(LAURA, '2026-09', { numero: '87959084', mesCotizado: '2026-08', salud: 358700, pension: 459200, arl: 70000 });
eq('Laura sep con planilla de agosto (mes anterior): OK', r.estado, 'OK');
r = ev(LAURA, '2026-05', { numero: '85401370', mesCotizado: '2026-04', salud: 358700, pension: 459200, arl: 15000 });
eq('Laura mayo con planilla de abril (riesgo I, ARL 15.000): OK', r.estado, 'OK');
r = ev(LAURA, '2026-05', { numero: '85401370', mesCotizado: '2026-05', salud: 358700, pension: 459200, arl: 15000 });
eq('Laura mayo con planilla de mayo y ARL de riesgo I: 🔴 (cotizo menos; ya es riesgo III) sin bloquear', [r.estado, r.bloquea], ['ERROR', false]);
r = ev(ERIKA_I, '2026-03', { numero: '84193613', mesCotizado: '2026-03', salud: 253200, pension: 324100, arl: 10600 });
eq('Erika riesgo I: 587.900 OK', r.estado, 'OK');
// planilla repetida
r = ev(ANA, '2026-09', { numero: '87959084', mesCotizado: '2026-09', salud: 358700, pension: 459200, arl: 70000 },
  { otras: [{ numero: '87959084', mismaContratista: false, mes: '2026-09' }] });
eq('Planilla usada por otra contratista: 🟡 REVISAR (no bloquea)', [r.estado, r.bloquea], ['REVISAR', false]);
cierto('Mensaje de planilla repetida', /ya se usó para otra cuenta de cobro/.test(r.mensaje), r.mensaje);
r = ev(ANA, '2026-09', { numero: '9507123456', mesCotizado: '2026-09', salud: 358700, pension: 459200, arl: 70000 },
  { otras: [{ numero: '9507123456', mismaContratista: true, mes: '2026-07' }] });
eq('Planilla usada por ella en otro mes: 🟡 REVISAR', [r.estado, r.bloquea], ['REVISAR', false]);
cierto('Mensaje dice el mes', /tu cuenta de cobro de Julio 2026/.test(r.mensaje), r.mensaje);
// mes cotizado
r = ev(ANA, '2026-09', { numero: '9507123456', mesCotizado: '2026-07', salud: 358700, pension: 459200, arl: 70000 });
eq('Mes cotizado 2 meses antes: 🟡 REVISAR (no bloquea)', [r.estado, r.bloquea], ['REVISAR', false]);
cierto('Mensaje de mes cotizado', /es de Julio 2026, pero para cobrar Septiembre 2026 lo normal es la planilla de Septiembre 2026 o la de Agosto 2026/.test(r.mensaje), r.mensaje);
r = ev(ANA, '2026-09', { numero: '9507123456', mesCotizado: '2026-10', salud: 358700, pension: 459200, arl: 70000 });
eq('Mes cotizado posterior: 🟡 REVISAR', [r.estado, r.bloquea], ['REVISAR', false]);
r = ev(ANA, '2026-01', { numero: '9507123456', mesCotizado: '2025-12', salud: 358700, pension: 459200, arl: 70000 });
eq('Mes cotizado anterior al contrato: 🟡 REVISAR', [r.estado, r.bloquea], ['REVISAR', false]);
r = ev(ANA, '2026-10', { numero: '9507123456', mesCotizado: '2026-10', salud: 358700, pension: 459200, arl: 70000 });
eq('Mes a cobrar fuera de vigencia: ERROR y BLOQUEA', [r.estado, r.bloquea], ['ERROR', true]);
// datos que faltan / numero
r = ev(ANA, '2026-09', { numero: '', mesCotizado: '2026-09', salud: 358700, pension: null, arl: 70000 });
eq('Falta n.º de planilla y pension: ERROR y BLOQUEA', [r.estado, r.bloquea], ['ERROR', true]);
cierto('Mensaje de faltantes', /Falta el n\.º de la planilla, el valor de pensión\./.test(r.mensaje), r.mensaje);
r = ev(ANA, '2026-09', { numero: '1234567', mesCotizado: '2026-09', salud: 358700, pension: 459200, arl: 70000 });
eq('Planilla de 7 digitos: 🟡 REVISAR (no bloquea)', [r.estado, r.bloquea], ['REVISAR', false]);
r = ev(ANA, '2026-09', { numero: '1234567890123', mesCotizado: '2026-09', salud: 358700, pension: 459200, arl: 70000 });
eq('Planilla de 13 digitos: 🟡 REVISAR (no bloquea)', [r.estado, r.bloquea], ['REVISAR', false]);
r = ev(ANA, '2026-09', { numero: '95096A3245', mesCotizado: '2026-09', salud: 358700, pension: 459200, arl: 70000 });
eq('Planilla con letras: ERROR y BLOQUEA', [r.estado, r.bloquea], ['ERROR', true]);
r = ev(ANA, '2026-09', { numero: '12345678', mesCotizado: '2026-09', salud: 358700, pension: 459200, arl: 70000 });
eq('Planilla de 8 digitos: OK', r.estado, 'OK');
r = ev(ANA, '2026-09', { numero: '123456789012', mesCotizado: '2026-09', salud: 358700, pension: 459200, arl: 70000 });
eq('Planilla de 12 digitos: OK', r.estado, 'OK');
// fechas
const okPl = { numero: '9509633245', mesCotizado: '2026-09', salud: 358700, pension: 459200, arl: 70000 };
r = ev(ANA, '2026-09', okPl, { periodo: { inicio: '2026-09-10', corte: '2026-09-30' } });
eq('Novedad en fechas (inicio 10/09): REVISAR, 21 dias', [r.estado, r.dias, r.valor], ['REVISAR', 21, Math.round(7174000 * 21 / 30)]);
r = ev(ANA, '2026-09', okPl, { periodo: { inicio: '2026-09-01', corte: '2026-10-05' } });
eq('Corte fuera del mes: ERROR y BLOQUEA', [r.estado, r.bloquea], ['ERROR', true]);
r = ev(ANA, '2026-09', okPl, { periodo: { inicio: '2026-09-20', corte: '2026-09-10' } });
eq('Inicio posterior al corte: ERROR y BLOQUEA', [r.estado, r.bloquea], ['ERROR', true]);
r = ev(ERIKA_I, '2026-01', okPl, { periodo: { inicio: '2026-01-10', corte: '2026-01-30' } });
eq('Inicio antes del contrato: ERROR y BLOQUEA', [r.estado, r.bloquea], ['ERROR', true]);
r = ev(ANA, '2026-03', Object.assign({}, okPl, { mesCotizado: '2026-03' }), { periodo: { inicio: '2026-03-01', corte: '2026-03-31' } });
eq('Marzo con corte 31: 30 dias y valor completo; queda REVISAR (fecha distinta a la esperada)', [r.estado, r.dias, r.valor], ['REVISAR', 30, 7174000]);
// mes parcial
r = ev(LAURA, '2026-01', { numero: '83358879', mesCotizado: '2026-01', salud: 218900, pension: 280200, arl: 9200 });
eq('Laura enero (mes parcial): REVISAR, 15 dias, 3.587.000', [r.estado, r.dias, r.valor], ['REVISAR', 15, 3587000]);
cierto('Mensaje de mes parcial', /tu supervisor revisará la planilla/.test(r.mensaje), r.mensaje);
r = ev(LAURA, '2026-02', { numero: '83365278', mesCotizado: '2026-01', salud: 218900, pension: 280200, arl: 9200 });
eq('Laura febrero con planilla de enero (parcial): REVISAR, sin validar montos', r.estado, 'REVISAR');
r = ev(ERIKA, '2026-01', { numero: '83358880', mesCotizado: '2026-01', salud: 1, pension: 1, arl: 1 });
eq('Mes parcial: montos absurdos NO se validan (REVISAR)', r.estado, 'REVISAR');


console.log('\n== v3: las alertas nunca bloquean; cotizacion mayor / menor ==');
const SIN_ALERTA = { numero: '9509633245', mesCotizado: '2026-09' };
// MAYOR (freelance con otros ingresos: IBC mayor): salud, pension y ARL suben
r = ev(ANA, '2026-09', Object.assign({}, SIN_ALERTA, { salud: 500000, pension: 640000, arl: 97500 }));
eq('Cotiza MAS (IBC mayor por otros ingresos): 🟡 REVISAR y no bloquea', [r.estado, r.emoji, r.bloquea], ['REVISAR', '🟡', false]);
eq('Mensaje de cotizacion mayor (textual del supervisor)', r.mensaje, 'Cotizaste $1.237.500, más de los $887.900 que corresponden a este contrato (puede ser por otros ingresos o contratos). Tu supervisor lo revisará.');
r = ev(ANA, '2026-09', Object.assign({}, SIN_ALERTA, { salud: 358700, pension: 459200, arl: 70000 }), { otras: [] });
eq('Exacto: ✅ OK', [r.estado, r.bloquea], ['OK', false]);
// MENOR
r = ev(ANA, '2026-09', Object.assign({}, SIN_ALERTA, { salud: 200000, pension: 300000, arl: 40000 }));
eq('Cotiza MENOS: 🔴 ERROR pero no bloquea (la cuenta se genera igual)', [r.estado, r.emoji, r.bloquea, r.bloqueos.length], ['ERROR', '🔴', false, 0]);
cierto('Mensaje de cotizacion menor', /^Cotizaste \$540\.000 y para este contrato debe ser al menos \$887\.900/.test(r.mensaje), r.mensaje);
eq('Cotizacion menor conserva dias y valor para generar la cuenta', [r.dias, r.valor], [30, 7174000]);
// mezcla: salud/pension mayores y ARL menor -> gana 🔴
r = ev(ANA, '2026-09', Object.assign({}, SIN_ALERTA, { salud: 500000, pension: 640000, arl: 15000 }));
eq('Mezcla (salud y pension mayores, ARL menor): 🔴', r.estado, 'ERROR');
cierto('La mezcla tambien avisa lo que va de mas', /En salud cotizaste \$500\.000, más de los \$358\.700 esperados; pensión cotizaste \$640\.000/.test(r.mensaje) && /ARL \(cotizaste \$15\.000, debe ser \$70\.000\)/.test(r.mensaje), r.mensaje);
// ARL con otra tarifa (riesgo distinto) con salud y pension correctas -> 🟡 con mensaje de riesgo
r = ev(ANA, '2026-09', Object.assign({}, SIN_ALERTA, { salud: 358700, pension: 459200, arl: 312300 }));
eq('ARL con otra tarifa (riesgo V): 🟡 con mensaje de riesgo', [r.estado, /para tu riesgo III es \$70\.000/.test(r.mensaje)], ['REVISAR', true]);
// repetida + mes cotizado raro juntos: siguen siendo alertas, no bloqueos
r = ev(ANA, '2026-09', Object.assign({}, SIN_ALERTA, { mesCotizado: '2026-06', salud: 358700, pension: 459200, arl: 70000 }), { otras: [{ numero: '9509633245', mismaContratista: true, mes: '2026-06' }] });
eq('Planilla repetida + mes cotizado raro: 🟡 con dos avisos, no bloquea', [r.estado, r.bloquea, r.avisos.length], ['REVISAR', false, 2]);
// minimo para generar: mes, fechas validas, n.º y valor (sin mes cotizado)
r = ev(ANA, '2026-09', { numero: '9509633245', salud: 358700, pension: 459200, arl: 70000 });
eq('Sin mes cotizado: 🟡 (no bloquea)', [r.estado, r.bloquea], ['REVISAR', false]);

console.log('\n== v3: planillas adicionales (hasta 3) ==');
const PRINC = Object.assign({}, SIN_ALERTA, { salud: 358700, pension: 459200, arl: 70000 });
r = ev(ANA, '2026-09', PRINC, { adicionales: [{ numero: '9509700001', mesCotizado: '2026-08', valor: 21400 }, { numero: '9509700002', mesCotizado: '2026-07', valor: 3200 }] });
eq('Principal + 2 correcciones bien escritas: ✅ y no bloquea', [r.estado, r.bloquea, r.adicionales.length], ['OK', false, 2]);
eq('Las adicionales se normalizan (n.º, mes, valor)', r.adicionales[1], { numero: '9509700002', mesCotizado: '2026-07', valor: 3200 });
cierto('El mensaje OK menciona las adicionales', /y 2 planillas adicionales registradas/.test(r.mensaje), r.mensaje);
r = ev(ANA, '2026-09', PRINC, { adicionales: [{ numero: '9509700001', mesCotizado: '2026-08', valor: 21400 }, { numero: '9509700001', mesCotizado: '2026-08', valor: 100 }] });
eq('Adicional repetida entre si: 🟡 no bloquea', [r.estado, r.bloquea], ['REVISAR', false]);
r = ev(ANA, '2026-09', PRINC, { adicionales: [{ numero: '9509633245', mesCotizado: '2026-08', valor: 100 }] });
eq('Adicional igual a la principal: 🟡', [r.estado, r.bloquea], ['REVISAR', false]);
r = ev(ANA, '2026-09', PRINC, { adicionales: [{ numero: '9509700001', mesCotizado: '2026-08', valor: 100 }], otras: [{ numero: '9509700001', mismaContratista: true, mes: '2026-07' }] });
eq('Adicional ya usada en otro mes: 🟡', [r.estado, r.bloquea], ['REVISAR', false]);
r = ev(ANA, '2026-09', PRINC, { adicionales: [{ numero: '95097A0001', mesCotizado: '2026-08', valor: 100 }] });
eq('Adicional con letras en el n.º: bloquea', [r.estado, r.bloquea], ['ERROR', true]);
r = ev(ANA, '2026-09', PRINC, { adicionales: [{ numero: '9509700001', mesCotizado: '2026-08', valor: 0 }] });
eq('Adicional sin valor (0): bloquea', r.bloquea, true);
r = ev(ANA, '2026-09', PRINC, { adicionales: [{ numero: '9509700001', mesCotizado: '2026-08', valor: -500 }] });
eq('Adicional con valor negativo: bloquea (siempre positivo)', r.bloquea, true);
r = ev(ANA, '2026-09', PRINC, { adicionales: [{ numero: '9509700001', mesCotizado: '2026-08', valor: 1 }, { numero: '9509700002', valor: 1 }, { numero: '9509700003', valor: 1 }, { numero: '9509700004', valor: 1 }] });
eq('Mas de 3 adicionales: bloquea', r.bloquea, true);
r = ev(ANA, '2026-09', PRINC, { adicionales: [{ numero: '9509700001', mesCotizado: '2026-08', valor: 5000 }, { numero: '9509700002', valor: 7000 }, { numero: '9509700003', mesCotizado: 'x', valor: 9000 }] });
eq('3 adicionales (limite): bien', [r.bloquea, r.adicionales.length], [false, 3]);
eq('Mes cotizado de adicional invalido o vacio queda en blanco (no bloquea)', [r.adicionales[1].mesCotizado, r.adicionales[2].mesCotizado], ['', '']);
// las adicionales NO se validan contra lo esperado de seguridad social
r = ev(ANA, '2026-09', PRINC, { adicionales: [{ numero: '9509700001', mesCotizado: '2026-01', valor: 99999999 }] });
eq('Valor de adicional enorme no genera alerta de monto', [r.estado, r.bloquea], ['OK', false]);

console.log('\n== v3: dias distintos (novedad, suspension, licencia) ==');
r = ev(ANA, '2026-09', PRINC, { diasManual: { dias: 20, motivo: 'Licencia no remunerada' } });
eq('20 dias con motivo: valor = 2/3 del honorario, 🟡', [r.dias, r.valor, r.estado, r.diasManual, r.bloquea], [20, 4782667, 'REVISAR', true, false]);
cierto('Mensaje de dias a mano', /Días cobrados a mano: 20 \(Licencia no remunerada\)\. Revisar\./.test(r.mensaje), r.mensaje);
r = ev(ANA, '2026-09', PRINC, { diasManual: { dias: 20, motivo: '' } });
eq('Dias a mano sin motivo: bloquea', r.bloquea, true);
r = ev(ANA, '2026-09', PRINC, { diasManual: { dias: 0, motivo: 'x' } });
eq('0 dias: bloquea', r.bloquea, true);
r = ev(ANA, '2026-09', PRINC, { diasManual: { dias: 31, motivo: 'x' } });
eq('31 dias: bloquea', r.bloquea, true);
r = ev(ANA, '2026-09', PRINC, { diasManual: { dias: 12.5, motivo: 'x' } });
eq('Dias con decimales: bloquea', r.bloquea, true);
r = ev(ANA, '2026-09', PRINC, { diasManual: { dias: '', motivo: '' } });
eq('Campos de dias vacios = no se uso: ✅', [r.estado, r.diasManual, r.dias], ['OK', false, 30]);
r = ev(ANA, '2026-09', PRINC, { diasManual: { dias: 30, motivo: 'Se cobra completo por acuerdo' } });
eq('30 dias a mano (igual a la regla) tambien queda 🟡 para revision', [r.estado, r.valor], ['REVISAR', 7174000]);
r = ev(ANA, '2026-09', PRINC, { periodo: { inicio: '2026-09-10', corte: '2026-09-30' }, diasManual: { dias: 15, motivo: 'Suspensión' } });
eq('Fechas cambiadas + dias a mano: los dos avisos, el valor sale de los dias a mano', [r.avisos.length, r.dias, r.valor], [2, 15, 3587000]);
eq('Acumulado usa el valor real cobrado (dias a mano)', Calc.cumulative(ANA, '2026-09', { '2026-09': 4782667 }).acumulado, 64566000 - 7174000 + 4782667);

console.log('\n== Otros ==');
eq('fmtMoney', Calc.fmtMoney(64566000), '$64.566.000');
eq('monthLabel', Calc.monthLabel('2026-09'), 'Septiembre 2026');
eq('addMonths cruza el año', Calc.addMonths('2026-01', -1), '2025-12');
eq('parseYMD invalida (31 de abril)', Calc.parseYMD('2026-04-31'), null);
eq('Contrato que termina el 15/02: mes parcial', Calc.monthPartial('2026-02', '2026-01-01', '2026-02-15'), true);
eq('Contrato que termina el 28/02: mes completo', Calc.monthPartial('2026-02', '2026-01-01', '2026-02-28'), false);
eq('Contrato que termina el 31/03: mes completo', Calc.monthPartial('2026-03', '2026-01-01', '2026-03-31'), false);

console.log('\nResultado: ' + pasan + ' correctas, ' + fallan + ' fallidas.');
process.exit(fallan ? 1 : 0);
