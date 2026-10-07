/**
 * Calc.gs - Reglas de negocio de la cuenta de cobro (funciones PURAS, sin APIs de Google).
 *
 * Todo el archivo cuelga de un unico objeto global: Calc.
 * Convenciones:
 *   - Fechas: texto 'AAAA-MM-DD'.   - Meses: texto 'AAAA-MM'.
 *   - Dinero: numeros enteros en pesos.
 * Se puede probar en node con vm (ver test_calc.js). Compatible con V8 de Apps Script.
 */
var Calc = (function () {
  'use strict';

  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
    'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var ESTADO_TEXTO = { OK: '✅ OK', REVISAR: '🟡 REVISAR', ERROR: '🔴 ERROR' };
  var ESTADO_EMOJI = { OK: '✅', REVISAR: '🟡', ERROR: '🔴' };

  // ------------------------------------------------------------------ fechas
  function pad2(n) { n = Number(n); return (n < 10 ? '0' : '') + n; }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  function parseYMD(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s === null || s === undefined ? '' : s).trim());
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }

  function fmtYMD(o) { return o.y + '-' + pad2(o.m) + '-' + pad2(o.d); }

  function fmtFecha(s) {           // 'AAAA-MM-DD' -> 'dd/mm/aaaa'
    var o = parseYMD(s);
    return o ? pad2(o.d) + '/' + pad2(o.m) + '/' + o.y : '';
  }

  function parseMonth(k) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(k === null || k === undefined ? '' : k).trim());
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    return { y: y, m: mo };
  }

  function monthKey(y, m) { return y + '-' + pad2(m); }
  function monthOf(ymd) { return String(ymd).slice(0, 7); }
  function monthIndex(k) { var o = parseMonth(k); return o.y * 12 + o.m - 1; }
  function addMonths(k, n) {
    var idx = monthIndex(k) + n;
    return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
  }
  function monthLabel(k) {
    var o = parseMonth(k);
    return o ? MESES[o.m - 1] + ' ' + o.y : String(k);
  }
  function monthFirstDay(k) { return k + '-01'; }
  function monthLastDay(k) { var o = parseMonth(k); return k + '-' + pad2(daysInMonth(o.y, o.m)); }

  /** Meses del contrato: del mes de la fecha de inicio al mes de terminacion. */
  function monthsBetween(inicio, fin) {
    var a = parseYMD(inicio), b = parseYMD(fin);
    if (!a || !b) return [];
    var res = [], k = monthKey(a.y, a.m), last = monthKey(b.y, b.m);
    while (monthIndex(k) <= monthIndex(last) && res.length < 240) { res.push(k); k = addMonths(k, 1); }
    return res;
  }

  // ------------------------------------------------------ periodo, dias, valor
  /** Dia 30 del mes (febrero: ultimo dia). */
  function corteBase(k) {
    var o = parseMonth(k), last = daysInMonth(o.y, o.m);
    return monthFirstDay(k).slice(0, 8) + pad2(Math.min(30, last));
  }

  /** El mes es "completo" (para calcular seguridad social) si el contrato no empieza tarde ni termina antes de fin de mes. */
  function monthPartial(k, inicio, fin) {
    var a = parseYMD(inicio), b = parseYMD(fin), o = parseMonth(k);
    if (!a || !b || !o) return false;
    if (a.y === o.y && a.m === o.m && a.d > 1) return true;
    if (b.y === o.y && b.m === o.m) {
      var last = daysInMonth(o.y, o.m);
      var diaCom = (b.d === 31 || b.d === last) ? 30 : b.d;
      if (diaCom < 30) return true;
    }
    return false;
  }

  /**
   * Fechas esperadas del periodo de un mes.
   * inicio = MAX(dia 1, inicio contrato); corte = dia 30 (febrero: ultimo dia);
   * si el contrato termina ese mes, MIN(terminacion, corte); terminacion dia 31 -> 30.
   * Devuelve null si el mes esta fuera de la vigencia.
   */
  function expectedPeriod(k, inicio, fin) {
    if (monthsBetween(inicio, fin).indexOf(k) < 0) return null;
    var a = parseYMD(inicio), b = parseYMD(fin), o = parseMonth(k);
    var ini = monthFirstDay(k);
    if (a.y === o.y && a.m === o.m) ini = inicio;
    var corte = corteBase(k);
    if (b.y === o.y && b.m === o.m) {
      var t = fin;
      if (b.d === 31) t = k + '-30';
      if (t < corte) corte = t;
    }
    if (corte < ini) corte = ini;           // caso raro: inicio el dia 31
    return { inicio: ini, corte: corte };
  }

  /** Dias con mes comercial de 30 (ultimo dia del mes y dia 31 cuentan como 30). */
  function commercialDays(inicio, corte) {
    var a = parseYMD(inicio), c = parseYMD(corte);
    if (!a || !c) return null;
    var dC = (c.d === 31 || c.d === daysInMonth(c.y, c.m)) ? 30 : c.d;
    var dI = Math.min(a.d, 30);
    return (c.y * 360 + c.m * 30 + dC) - (a.y * 360 + a.m * 30 + dI) + 1;
  }

  function periodValue(honorario, dias) {
    honorario = Number(honorario);
    if (dias === 30) return honorario;
    return Math.round(honorario * dias / 30);
  }

  function docNumber(k) { var o = parseMonth(k); return o.y * 100 + o.m; }

  /**
   * Acumulado de una contratista hasta un mes (inclusive): suma, mes a mes de la vigencia,
   * del valor guardado en CARGA (si ya hay fila) o, si no hay fila, del valor que dicta la regla.
   * valoresPorMes: { 'AAAA-MM': valor }
   */
  function cumulative(contrato, mes, valoresPorMes) {
    var meses = monthsBetween(contrato.inicio, contrato.fin), sum = 0, i;
    valoresPorMes = valoresPorMes || {};
    for (i = 0; i < meses.length; i++) {
      if (monthIndex(meses[i]) > monthIndex(mes)) break;
      var v = valoresPorMes[meses[i]];
      if (v === undefined || v === null || v === '' || isNaN(Number(v))) {
        var p = expectedPeriod(meses[i], contrato.inicio, contrato.fin);
        v = periodValue(contrato.honorario, commercialDays(p.inicio, p.corte));
      }
      sum += Number(v);
    }
    var total = Number(contrato.total);
    return { acumulado: sum, pct: total > 0 ? sum / total : 0 };
  }

  // -------------------------------------------------------- seguridad social
  /** Riesgo ARL vigente en un mes: el nuevo si el mes >= "Desde". */
  function riskFor(contrato, k) {
    var nuevo = String(contrato.riesgoNuevo || '').trim().toUpperCase();
    var desde = contrato.desde ? parseYMD(contrato.desde) : null;
    if (nuevo && desde && monthIndex(k) >= monthIndex(monthKey(desde.y, desde.m))) return nuevo;
    return String(contrato.riesgo || '').trim().toUpperCase();
  }

  /** ROUNDUP a la centena, protegido contra el ruido de los decimales binarios. */
  function ceil100(x) { return Math.ceil(Math.round(x * 1e6) / 1e6 / 100) * 100; }

  /**
   * SS esperada de un mes COTIZADO completo.
   * params: { pctIbc, pctSalud, pctPension, smmlv, piso, techo, arl: {I:0.00522,...} }
   */
  function expectedSS(honorario, riesgo, params) {
    var tarifa = params.arl ? params.arl[riesgo] : undefined;
    if (tarifa === undefined || tarifa === null || isNaN(Number(tarifa))) return null;
    var ibc = Math.round(params.pctIbc * Number(honorario));
    ibc = Math.min(Math.max(ibc, params.smmlv * params.piso), params.smmlv * params.techo);
    var salud = ceil100(ibc * params.pctSalud);
    var pension = ceil100(ibc * params.pctPension);
    var arl = ceil100(ibc * Number(tarifa));
    return {
      ibc: ibc, salud: salud, pension: pension, arl: arl, total: salud + pension + arl, riesgo: riesgo,
      desglose: 'salud ' + fmtNum(salud) + ' + pensión ' + fmtNum(pension) + ' + ARL ' + fmtNum(arl) +
        ' (riesgo ' + riesgo + ')'
    };
  }

  // ------------------------------------------------------------------ formato
  function fmtNum(n) {
    var s = String(Math.round(Math.abs(Number(n)))), out = '';
    while (s.length > 3) { out = '.' + s.slice(-3) + out; s = s.slice(0, -3); }
    return (Number(n) < 0 ? '-' : '') + s + out;
  }
  function fmtMoney(n) { return '$' + fmtNum(n); }

  // ---------------------------------------------------------------- evaluacion
  function isNum(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }

  var MAX_ADICIONALES = 3;

  /**
   * Evalua un envio. LAS ALERTAS NUNCA BLOQUEAN: la cuenta de cobro se genera siempre que no haya "bloqueos"
   * (falta un dato obligatorio o el formato es imposible). Todo lo demas son alertas (🟡 / 🔴) que quedan en CARGA.
   * Entrada:
   * {
   *   contrato: { inicio, fin, honorario, total, riesgo, riesgoNuevo, desde },
   *   params:   { pctIbc, pctSalud, pctPension, smmlv, piso, techo, arl, tolerancia },
   *   mes: 'AAAA-MM',
   *   periodo: { inicio, corte }            (si viene vacio se usan las fechas esperadas)
   *   planilla: { numero, mesCotizado, salud, pension, arl, total }   PRINCIPAL (total solo si no hay desglose)
   *   otras: [ { numero, mismaContratista: bool, mes: 'AAAA-MM' } ]   (planillas de OTRAS filas de CARGA)
   *   adicionales: [ { numero, mesCotizado, valor } ]   hasta 3 (correcciones / adicionales): solo se valida el formato
   *   diasManual: { dias: 1..30, motivo }    (opcional) dias cobrados a mano por una novedad
   * }
   * Salida: { estado:'OK'|'REVISAR'|'ERROR', estadoTexto, emoji, mensaje, bloquea:bool, bloqueos[], errores[], avisos[],
   *           dias, valor, docNum, periodo, esperadoPeriodo, novedad, diasManual, parcial, ss, declarado, adicionales[] }
   *   estado 'ERROR' (🔴) y 'REVISAR' (🟡) NO impiden generar la cuenta de cobro; solo `bloquea` la impide.
   *   errores = alertas rojas; avisos = alertas amarillas; bloqueos = lo que impide generar.
   */
  function evaluate(inp) {
    var c = inp.contrato, P = inp.params, mes = inp.mes, pl = inp.planilla || {};
    var tol = isNum(P.tolerancia) ? Number(P.tolerancia) : 100;
    var bloqueos = [], rojos = [], amarillos = [];
    function bloq(texto) { bloqueos.push(texto); }

    var res = {
      estado: 'OK', bloquea: false, bloqueos: [], errores: [], avisos: [], dias: null, valor: null, docNum: null,
      periodo: null, esperadoPeriodo: null, novedad: false, diasManual: false, parcial: false, ss: null, declarado: null,
      adicionales: []
    };
    var mo = parseMonth(mes);
    if (!mo) {
      bloq('No entendí el mes a cobrar. Escoge otra vez el mes de la lista.');
      return cerrar(res, bloqueos, rojos, amarillos, mes);
    }
    res.docNum = docNumber(mes);

    // --- vigencia y periodo (fechas fuera del contrato = formato imposible = bloquea) ----------------
    var meses = monthsBetween(c.inicio, c.fin);
    var enVig = meses.indexOf(mes) >= 0;
    if (!enVig) {
      bloq('El mes ' + monthLabel(mes) + ' está fuera de la vigencia de tu contrato (' +
        fmtFecha(c.inicio) + ' al ' + fmtFecha(c.fin) + ').');
    }
    var esp = enVig ? expectedPeriod(mes, c.inicio, c.fin) : null;
    res.esperadoPeriodo = esp;
    var pIni = (inp.periodo && inp.periodo.inicio) || (esp && esp.inicio) || '';
    var pCor = (inp.periodo && inp.periodo.corte) || (esp && esp.corte) || '';
    var fIni = parseYMD(pIni), fCor = parseYMD(pCor);
    if (enVig) {
      if (!fIni || !fCor) {
        bloq('Falta la fecha de inicio o la fecha de corte del periodo.');
      } else {
        res.periodo = { inicio: pIni, corte: pCor };
        var fechasOk = true;
        if (monthOf(pIni) !== mes || monthOf(pCor) !== mes) {
          bloq('Las fechas del periodo (' + fmtFecha(pIni) + ' al ' + fmtFecha(pCor) +
            ') deben estar dentro de ' + monthLabel(mes) + '.');
          fechasOk = false;
        }
        if (pIni < c.inicio || pCor > c.fin) {
          bloq('Las fechas del periodo deben estar dentro de tu contrato (' + fmtFecha(c.inicio) +
            ' al ' + fmtFecha(c.fin) + ').');
          fechasOk = false;
        }
        if (pIni > pCor) {
          bloq('La fecha de inicio (' + fmtFecha(pIni) + ') no puede ser posterior a la de corte (' +
            fmtFecha(pCor) + ').');
          fechasOk = false;
        }
        if (pIni <= pCor) {
          res.dias = commercialDays(pIni, pCor);
          res.valor = periodValue(c.honorario, res.dias);
        }
        if (fechasOk && esp && (pIni !== esp.inicio || pCor !== esp.corte)) {
          res.novedad = true;
          amarillos.push('Cambiaste las fechas del periodo (' + fmtFecha(pIni) + ' al ' + fmtFecha(pCor) +
            ' en lugar de ' + fmtFecha(esp.inicio) + ' al ' + fmtFecha(esp.corte) + '). Tu supervisor las revisará.');
        }
      }
    }

    // --- dias cobrados a mano (suspension, licencia, novedad) -----------------------------------------
    var dm = inp.diasManual;
    var motivo = dm && dm.motivo !== null && dm.motivo !== undefined ? String(dm.motivo).replace(/\s+/g, ' ').trim() : '';
    var diasTxt = dm && dm.dias !== null && dm.dias !== undefined ? String(dm.dias).trim() : '';
    if (dm && (diasTxt !== '' || motivo !== '')) {
      var nd = Number(diasTxt);
      if (diasTxt === '' || !isFinite(nd) || Math.floor(nd) !== nd || nd < 1 || nd > 30) {
        bloq('Los días a cobrar deben ser un número entero entre 1 y 30.');
      } else if (!motivo) {
        bloq('Escribe el motivo de los días distintos (suspensión, licencia, novedad…).');
      } else {
        res.dias = nd;
        res.diasManual = true;
        res.valor = periodValue(c.honorario, nd);
        amarillos.push('Días cobrados a mano: ' + nd + ' (' + motivo + '). Revisar.');
      }
    }

    // --- planilla principal: datos obligatorios (n.º y valor) ---------------------------------------
    var numero = pl.numero === null || pl.numero === undefined ? '' : String(pl.numero).trim();
    var cot = pl.mesCotizado === null || pl.mesCotizado === undefined ? '' : String(pl.mesCotizado).trim();
    var hayDesglose = isNum(pl.salud) && isNum(pl.pension) && isNum(pl.arl);
    var soloTotal = !hayDesglose && !isNum(pl.salud) && !isNum(pl.pension) && !isNum(pl.arl) && isNum(pl.total);
    var faltan = [];
    if (!numero) faltan.push('el n.º de la planilla');
    if (!hayDesglose && !soloTotal) {
      if (!isNum(pl.salud)) faltan.push('el valor de salud');
      if (!isNum(pl.pension)) faltan.push('el valor de pensión');
      if (!isNum(pl.arl)) faltan.push('el valor de ARL');
    }
    if (faltan.length) bloq('Falta ' + faltan.join(', ') + '. Escríbelo(s) para poder continuar.');

    // --- planilla principal: n.º ----------------------------------------------------------------------
    var otras = inp.otras || [], i;
    function repetida(num) {
      for (var k = 0; k < otras.length; k++) if (String(otras[k].numero).trim() === num) return otras[k];
      return null;
    }
    function textoRepetida(num, dup) {
      return 'La planilla n.º ' + num + ' ya se usó ' +
        (dup.mismaContratista ? 'en tu cuenta de cobro de ' + monthLabel(dup.mes) : 'para otra cuenta de cobro') +
        '. Puede ser una corrección o una planilla adicional; tu supervisor lo revisará.';
    }
    if (numero) {
      if (!/^\d+$/.test(numero)) {
        bloq('El n.º de planilla debe tener solo números (escribiste «' + numero +
          '»). Revisa que no sea el n.º de la cuenta ni de la cédula.');
      } else {
        if (numero.length < 8 || numero.length > 12) {
          amarillos.push('El n.º de planilla tiene ' + numero.length + ' dígitos (normalmente son entre 8 y 12). Verifica que sea el n.º de la planilla y no de la cuenta ni de la cédula.');
        }
        var dup = repetida(numero);
        if (dup) amarillos.push(textoRepetida(numero, dup));
      }
    }

    // --- planilla principal: mes cotizado (alertas, no bloquea) -------------------------------------------
    var cotValido = !!(cot && parseMonth(cot));
    var cotEnVig = false;
    if (!cotValido) {
      amarillos.push('No indicaste el mes cotizado de la planilla, así que no pudimos revisar los valores. Tu supervisor lo revisará.');
    } else {
      var prev = addMonths(mes, -1);
      cotEnVig = monthIndex(cot) >= monthIndex(monthOf(c.inicio)) && monthIndex(cot) <= monthIndex(monthOf(c.fin));
      if (cot !== mes && cot !== prev) {
        amarillos.push('La planilla que subiste es de ' + monthLabel(cot) + ', pero para cobrar ' + monthLabel(mes) +
          ' lo normal es la planilla de ' + monthLabel(mes) + ' o la de ' + monthLabel(prev) + '. Tu supervisor lo revisará.');
      } else if (!cotEnVig) {
        amarillos.push('El mes cotizado (' + monthLabel(cot) + ') está fuera de la vigencia de tu contrato. Tu supervisor lo revisará.');
      }
    }

    // --- planilla principal: valores (mayor = 🟡, menor = 🔴) ---------------------------------------------
    var decl = null;
    if (hayDesglose) decl = Number(pl.salud) + Number(pl.pension) + Number(pl.arl);
    else if (soloTotal) decl = Number(pl.total);
    res.declarado = decl;

    if (cotValido && cotEnVig && (hayDesglose || soloTotal)) {
      if (monthPartial(cot, c.inicio, c.fin)) {
        res.parcial = true;
        amarillos.push('La planilla es de ' + monthLabel(cot) + ', un mes parcial de tu contrato. No revisamos los valores; ' +
          'tu supervisor revisará la planilla.');
      } else {
        var riesgo = riskFor(c, cot);
        var ss = expectedSS(c.honorario, riesgo, P);
        if (!ss) {
          amarillos.push('No encuentro la tarifa de ARL para el riesgo «' + riesgo + '», así que no pudimos revisar los valores. Avisa a tu supervisor.');
        } else {
          res.ss = ss;
          if (hayDesglose) compararDesglose(pl, ss, riesgo, tol, decl, rojos, amarillos);
          else if (decl > ss.total + tol * 3) {
            amarillos.push(textoMayor(decl, ss.total));
          } else if (decl < ss.total - tol * 3) {
            rojos.push(textoMenor(decl, ss.total, ss.desglose, ''));
          }
        }
      }
    }

    // --- planillas adicionales: solo formato (n.º numérico, no repetida, valor positivo) --------------------
    var ad = inp.adicionales || [], vistos = {};
    if (numero) vistos[numero] = 'principal';
    if (ad.length > MAX_ADICIONALES) bloq('Máximo ' + MAX_ADICIONALES + ' planillas adicionales por cuenta de cobro.');
    for (i = 0; i < ad.length && i < MAX_ADICIONALES; i++) {
      var a = ad[i] || {}, n = i + 2;
      var an = a.numero === null || a.numero === undefined ? '' : String(a.numero).replace(/\s/g, '');
      var am = a.mesCotizado === null || a.mesCotizado === undefined ? '' : String(a.mesCotizado).trim();
      var av = isNum(a.valor) ? Number(a.valor) : null;
      if (!an) { bloq('A la planilla ' + n + ' le falta el n.º de planilla.'); continue; }
      if (!/^\d+$/.test(an)) { bloq('El n.º de la planilla ' + n + ' debe tener solo números (escribiste «' + an + '»).'); continue; }
      if (av === null || av <= 0) { bloq('A la planilla ' + n + ' (n.º ' + an + ') le falta el valor pagado (un número mayor que cero, sin intereses de mora).'); continue; }
      if (am && !parseMonth(am)) am = '';
      res.adicionales.push({ numero: an, mesCotizado: am, valor: Math.round(av) });
      if (an.length < 8 || an.length > 12) amarillos.push('El n.º de la planilla ' + n + ' tiene ' + an.length + ' dígitos (normalmente son entre 8 y 12). Verifícalo.');
      if (vistos[an]) {
        amarillos.push('La planilla n.º ' + an + ' está repetida en esta cuenta de cobro (' + (vistos[an] === 'principal' ? 'es igual a la principal' : 'ya la agregaste como planilla ' + vistos[an]) + '). Tu supervisor lo revisará.');
      } else {
        vistos[an] = n;
        var dup2 = repetida(an);
        if (dup2) amarillos.push(textoRepetida(an, dup2));
      }
    }

    return cerrar(res, bloqueos, rojos, amarillos, mes, cot, res.adicionales.length);
  }

  function textoMayor(decl, esperado) {
    return 'Cotizaste ' + fmtMoney(decl) + ', más de los ' + fmtMoney(esperado) +
      ' que corresponden a este contrato (puede ser por otros ingresos o contratos). Tu supervisor lo revisará.';
  }

  function textoMenor(decl, esperado, desglose, detalle) {
    return 'Cotizaste ' + fmtMoney(decl) + ' y para este contrato debe ser al menos ' + fmtMoney(esperado) +
      ' (' + desglose + ').' + (detalle ? ' ' + detalle : '') + ' Tu supervisor lo revisará; recuerda que la cuenta de cobro lleva solo salud, pensión y ARL, sin caja de compensación ni intereses de mora.';
  }

  /** Compara salud, pensión y ARL por separado: mayor al esperado = 🟡, menor = 🔴 (la peor gana). */
  function compararDesglose(pl, ss, riesgo, tol, decl, rojos, amarillos) {
    var cs = [
      { k: 'salud', d: Number(pl.salud), e: ss.salud },
      { k: 'pensión', d: Number(pl.pension), e: ss.pension },
      { k: 'ARL', d: Number(pl.arl), e: ss.arl }
    ];
    var menores = cs.filter(function (x) { return x.d < x.e - tol; });
    var mayores = cs.filter(function (x) { return x.d > x.e + tol; });
    if (menores.length) {
      rojos.push(textoMenor(decl, ss.total, ss.desglose, 'Te falta en: ' + menores.map(function (x) {
        return x.k + ' (cotizaste ' + fmtMoney(x.d) + ', debe ser ' + fmtMoney(x.e) + ')';
      }).join('; ') + '.'));
      if (mayores.length) {
        amarillos.push('En ' + mayores.map(function (x) {
          return x.k + ' cotizaste ' + fmtMoney(x.d) + ', más de los ' + fmtMoney(x.e) + ' esperados';
        }).join('; ') + ' (puede ser por otros ingresos o contratos).');
      }
    } else if (mayores.length) {
      var soloArl = mayores.length === 1 && mayores[0].k === 'ARL';
      if (soloArl) {
        amarillos.push('La ARL de tu planilla es ' + fmtMoney(mayores[0].d) + ' pero para tu riesgo ' + riesgo + ' es ' + fmtMoney(mayores[0].e) +
          '. Puede que la planilla tenga otro riesgo o tarifa. Tu supervisor lo revisará.');
      } else {
        amarillos.push(textoMayor(decl, ss.total));
      }
    }
  }

  function cerrar(res, bloqueos, rojos, amarillos, mes, cot, nAdic) {
    res.bloqueos = bloqueos.slice();
    res.errores = rojos.slice();
    res.avisos = amarillos.slice();
    res.bloquea = bloqueos.length > 0;
    if (res.bloquea) {
      res.estado = 'ERROR';
      res.mensaje = bloqueos.join(' ') + ' Corrige y vuelve a revisar.';
    } else if (rojos.length) {
      res.estado = 'ERROR';
      res.mensaje = rojos.concat(amarillos).join(' ');
    } else if (amarillos.length) {
      res.estado = 'REVISAR';
      res.mensaje = amarillos.join(' ');
    } else {
      res.estado = 'OK';
      res.mensaje = 'Todo en orden: la planilla de ' + monthLabel(cot || mes) + ' coincide con lo esperado' +
        (nAdic ? ' (y ' + nAdic + (nAdic === 1 ? ' planilla adicional registrada' : ' planillas adicionales registradas') + ')' : '');
    }
    res.estadoTexto = ESTADO_TEXTO[res.estado];
    res.emoji = ESTADO_EMOJI[res.estado];
    return res;
  }

  return {
    MESES: MESES, ESTADO_TEXTO: ESTADO_TEXTO, ESTADO_EMOJI: ESTADO_EMOJI,
    daysInMonth: daysInMonth, parseYMD: parseYMD, fmtYMD: fmtYMD, fmtFecha: fmtFecha, parseMonth: parseMonth,
    monthKey: monthKey, monthOf: monthOf, monthIndex: monthIndex, addMonths: addMonths, monthLabel: monthLabel,
    monthFirstDay: monthFirstDay, monthLastDay: monthLastDay, monthsBetween: monthsBetween,
    monthPartial: monthPartial, expectedPeriod: expectedPeriod, commercialDays: commercialDays,
    periodValue: periodValue, docNumber: docNumber, cumulative: cumulative, riskFor: riskFor, ceil100: ceil100,
    expectedSS: expectedSS, fmtNum: fmtNum, fmtMoney: fmtMoney, evaluate: evaluate, MAX_ADICIONALES: MAX_ADICIONALES
  };
})();
