import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actualizarContrato, borrarContrato } from '../admin';
import { exigirTokenAdmin } from '../adminAuth';
import { crearToken } from '../auth';
import { CAMPOS_CONTRATISTA, listarCambios } from '../cambios';
import type { Db } from '../db';
import { cambiosContrato, cargas, contratos } from '../db/schema';
import { ErrorAmable, ErrorValidacion } from '../errores';
import { contratoIdDeSesion, exigirAdmin } from '../http';
import { guardarMiContrato, leerMiContrato } from '../miContrato';
import { login, resumenDeSesion, snapshotDeContrato, type Deps } from '../servicios';
import { AHORA, BlobFalso, crearBase, crearCarga, crearContratista, crearDeps, vaciar } from './helpers';

let db: Db;
let deps: Deps;

beforeAll(async () => {
  db = await crearBase();
  process.env.SESSION_SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres-xx';
});

beforeEach(async () => {
  await vaciar(db);
  deps = crearDeps(db, new BlobFalso());
});

async function contrato(id: number) {
  const [c] = await db.select().from(contratos).where(eq(contratos.id, id));
  return c;
}

async function filasCambios() {
  return db.select().from(cambiosContrato).orderBy(cambiosContrato.id);
}

async function validacion(p: Promise<unknown>): Promise<ErrorValidacion> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorValidacion);
    return e as ErrorValidacion;
  }
  throw new Error('debía fallar');
}

async function amable(p: Promise<unknown>): Promise<ErrorAmable> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorAmable);
    return e as ErrorAmable;
  }
  throw new Error('debía fallar');
}

// =================================================================== GET
describe('leerMiContrato', () => {
  it('devuelve los campos editables y el valor total esperado', async () => {
    const id = await crearContratista(db, { correo: 'prueba@correo.test' });
    expect(await leerMiContrato(deps, id)).toEqual({
      direccion: 'Calle 1 # 2-3',
      telefono: '3000000000',
      ciudad: 'Medellín',
      correo: 'prueba@correo.test',
      cargo: 'Profesional de prueba',
      objeto: 'Objeto ficticio de prueba.',
      inicio: '2026-01-01',
      fin: '2026-09-30',
      valorTotal: 36081000,
      revisoNombre: 'Revisora de Prueba',
      revisoCargo: 'Apoyo Técnico',
      valorTotalEsperado: 36081000, // 9 meses completos x 4.009.000
    });
  });

  it('no devuelve nada que no pueda editar (cédula, honorario, riesgo, n.º de contrato...)', async () => {
    const id = await crearContratista(db);
    const d = await leerMiContrato(deps, id);
    for (const k of ['nombre', 'cedula', 'numeroContrato', 'honorario', 'riesgo', 'riesgoNuevo', 'riesgoDesde', 'activo', 'linea', 'id']) {
      expect(d).not.toHaveProperty(k);
    }
  });

  it('fechas vacías y sin valor esperado si el contrato aún no las tiene', async () => {
    const id = await crearContratista(db, { inicio: null, fin: null, valorTotal: null });
    const d = await leerMiContrato(deps, id);
    expect(d.inicio).toBe('');
    expect(d.fin).toBe('');
    expect(d.valorTotal).toBeNull();
    expect(d.valorTotalEsperado).toBeNull();
  });

  it('valor total esperado: contrato de mes completo, de inicio a mitad de mes y de fin a mitad de mes', async () => {
    const completo = await crearContratista(db, { nombre: 'COMPLETA PRUEBA', cedula: '1000000111', inicio: '2026-01-01', fin: '2026-12-31' });
    expect((await leerMiContrato(deps, completo)).valorTotalEsperado).toBe(12 * 4009000);

    // inicia el 16/01: enero = 15 días = 2.004.500, más 8 meses completos
    const tarde = await crearContratista(db, { nombre: 'TARDE PRUEBA', cedula: '1000000222', inicio: '2026-01-16', fin: '2026-09-30' });
    expect((await leerMiContrato(deps, tarde)).valorTotalEsperado).toBe(Math.round((4009000 * 15) / 30) + 8 * 4009000);

    // termina el 15/03: marzo = 15 días
    const corto = await crearContratista(db, { nombre: 'CORTO PRUEBA', cedula: '1000000333', inicio: '2026-01-01', fin: '2026-03-15' });
    expect((await leerMiContrato(deps, corto)).valorTotalEsperado).toBe(2 * 4009000 + Math.round((4009000 * 15) / 30));

    // el último día de febrero y el 31 cuentan como 30
    const feb = await crearContratista(db, { nombre: 'FEB PRUEBA', cedula: '1000000444', inicio: '2026-02-01', fin: '2026-03-31' });
    expect((await leerMiContrato(deps, feb)).valorTotalEsperado).toBe(2 * 4009000);
  });
});

// =================================================================== editar cada campo
describe('la contratista edita su contrato', () => {
  it('fecha de inicio: guarda, anota DD/MM/AAAA y el resumen cambia de meses', async () => {
    const id = await crearContratista(db);
    const r = await guardarMiContrato(deps, id, { inicio: '2026-03-16' });
    expect(r.datos.inicio).toBe('2026-03-16');
    expect((await contrato(id)).inicio).toBe('2026-03-16');
    expect(r.contrato.inicio).toBe('2026-03-16');
    expect(r.contrato.meses[0].key).toBe('2026-03');
    expect(r.contrato.meses[0].inicio).toBe('2026-03-16');
    expect(r.contrato.meses[0].dias).toBe(15);
    expect(r.contrato.meses).toHaveLength(7);
    const f = await filasCambios();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ contratoId: id, autor: 'contratista', campo: 'inicio', antes: '01/01/2026', despues: '16/03/2026' });
  });

  it('fecha de fin: alarga el contrato y salen meses nuevos (con el día 30)', async () => {
    const id = await crearContratista(db);
    const r = await guardarMiContrato(deps, id, { fin: '2026-12-31' });
    expect((await contrato(id)).fin).toBe('2026-12-31');
    expect(r.contrato.meses).toHaveLength(12);
    const ultimo = r.contrato.meses[11];
    expect(ultimo.key).toBe('2026-12');
    expect(ultimo.corte).toBe('2026-12-30');
    const f = await filasCambios();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ autor: 'contratista', campo: 'fin', antes: '30/09/2026', despues: '31/12/2026' });
  });

  it('Revisó (nombre) y Revisó (cargo): se recortan y se anotan', async () => {
    const id = await crearContratista(db);
    const r = await guardarMiContrato(deps, id, { revisoNombre: '  Carlos Inventado  ', revisoCargo: ' Coordinador ' });
    expect(r.datos).toMatchObject({ revisoNombre: 'Carlos Inventado', revisoCargo: 'Coordinador' });
    const c = await contrato(id);
    expect(c.revisoNombre).toBe('Carlos Inventado');
    expect(c.revisoCargo).toBe('Coordinador');
    const f = await filasCambios();
    expect(f.map((x) => [x.campo, x.antes, x.despues])).toEqual([
      ['revisoNombre', 'Revisora de Prueba', 'Carlos Inventado'],
      ['revisoCargo', 'Apoyo Técnico', 'Coordinador'],
    ]);
  });

  it('ciudad, cargo y objeto: se guardan y se anotan con su valor', async () => {
    const id = await crearContratista(db);
    const r = await guardarMiContrato(deps, id, { ciudad: ' Bello ', cargo: 'Profesional universitaria', objeto: 'Nuevo objeto ficticio.' });
    expect(r.datos).toMatchObject({ ciudad: 'Bello', cargo: 'Profesional universitaria', objeto: 'Nuevo objeto ficticio.' });
    const f = await filasCambios();
    expect(f.map((x) => [x.campo, x.antes, x.despues, x.alerta])).toEqual([
      ['ciudad', 'Medellín', 'Bello', false],
      ['cargo', 'Profesional de prueba', 'Profesional universitaria', false],
      ['objeto', 'Objeto ficticio de prueba.', 'Nuevo objeto ficticio.', false],
    ]);
  });

  it('dirección, teléfono y correo: se guardan, pero la bitácora NUNCA guarda su valor', async () => {
    const id = await crearContratista(db);
    const r = await guardarMiContrato(deps, id, { direccion: 'Carrera 9 # 8-7 apto 601', telefono: '+57 311 222 3344', correo: 'otra@correo.test' });
    expect(r.datos).toMatchObject({ direccion: 'Carrera 9 # 8-7 apto 601', telefono: '+57 311 222 3344', correo: 'otra@correo.test' });
    const c = await contrato(id);
    expect([c.direccion, c.telefono, c.correo]).toEqual(['Carrera 9 # 8-7 apto 601', '+57 311 222 3344', 'otra@correo.test']);
    const f = await filasCambios();
    expect(f.map((x) => [x.campo, x.antes, x.despues])).toEqual([
      ['direccion', '(dato personal)', '(dato personal)'],
      ['telefono', '(dato personal)', '(dato personal)'],
      ['correo', '(dato personal)', '(dato personal)'],
    ]);
    // ni el valor nuevo ni el anterior aparecen en ninguna fila
    const todo = JSON.stringify(f);
    for (const secreto of ['Carrera 9', 'Calle 1 # 2-3', '3000000000', '311 222', 'otra@correo.test']) expect(todo).not.toContain(secreto);
    // y el supervisor las lee con su etiqueta
    expect((await listarCambios(db)).map((x) => x.etiqueta).sort()).toEqual(['Correo', 'Dirección', 'Teléfono']);
  });

  it('el correo se puede borrar (es opcional)', async () => {
    const id = await crearContratista(db, { correo: 'prueba@correo.test' });
    await guardarMiContrato(deps, id, { correo: '  ' });
    expect((await contrato(id)).correo).toBe('');
    expect((await filasCambios())[0]).toMatchObject({ campo: 'correo', antes: '(dato personal)', despues: '(dato personal)' });
  });

  it('valor total: acepta "$ 44.099.000", "44099000" y números', async () => {
    const id = await crearContratista(db);
    await guardarMiContrato(deps, id, { valorTotal: '$ 44.099.000' });
    expect((await contrato(id)).valorTotal).toBe(44099000);
    await guardarMiContrato(deps, id, { valorTotal: '40090000' });
    expect((await contrato(id)).valorTotal).toBe(40090000);
    await guardarMiContrato(deps, id, { valorTotal: 36081000 });
    expect((await contrato(id)).valorTotal).toBe(36081000);
    expect((await filasCambios()).map((x) => [x.antes, x.despues])).toEqual([
      ['$36.081.000', '$44.099.000'],
      ['$44.099.000', '$40.090.000'],
      ['$40.090.000', '$36.081.000'],
    ]);
  });

  it('quién revisó no puede quedar vacío: es parte del perfil', async () => {
    const id = await crearContratista(db);
    const e = await validacion(guardarMiContrato(deps, id, { revisoCargo: '   ' }));
    expect(e.campos.revisoCargo).toMatch(/Escribe el cargo/);
    expect((await contrato(id)).revisoCargo).toBe('Apoyo Técnico');
  });

  it('todos los campos juntos: una fila de bitácora por cada uno', async () => {
    const id = await crearContratista(db);
    await guardarMiContrato(deps, id, {
      direccion: 'Otra dirección',
      telefono: '3111111111',
      ciudad: 'Envigado',
      correo: 'x@y.co',
      cargo: 'Otro cargo',
      objeto: 'Otro objeto',
      inicio: '2026-02-01',
      fin: '2026-10-31',
      valorTotal: '40.090.000',
      revisoNombre: 'Otra Persona',
      revisoCargo: 'Líder',
    });
    expect((await filasCambios()).map((x) => x.campo).sort()).toEqual(
      ['cargo', 'ciudad', 'correo', 'direccion', 'fin', 'inicio', 'objeto', 'revisoCargo', 'revisoNombre', 'telefono', 'valorTotal'],
    );
  });
});

// =================================================================== validaciones
describe('validaciones', () => {
  it('fechas inválidas: errores por campo y no se guarda nada', async () => {
    const id = await crearContratista(db);
    for (const malo of ['2026-02-30', '2026-13-01', '01/02/2026', 'mañana', '2026-1-1']) {
      const e = await validacion(guardarMiContrato(deps, id, { inicio: malo, fin: malo }));
      expect(e.estado).toBe(400);
      expect(e.campos.inicio).toMatch(/no es válida/);
      expect(e.campos.fin).toMatch(/no es válida/);
      expect(e.message).toBe(e.campos.inicio);
    }
    const antes = await contrato(id);
    expect(antes.inicio).toBe('2026-01-01');
    expect(antes.fin).toBe('2026-09-30');
    expect(await filasCambios()).toHaveLength(0);
  });

  it('inicio y fin no pueden ir vacíos, nulos ni que no sean texto', async () => {
    const id = await crearContratista(db);
    for (const malo of ['', '   ', null, 20260101, true, {}]) {
      const e = await validacion(guardarMiContrato(deps, id, { inicio: malo }));
      expect(Object.keys(e.campos)).toEqual(['inicio']);
      const e2 = await validacion(guardarMiContrato(deps, id, { fin: malo }));
      expect(Object.keys(e2.campos)).toEqual(['fin']);
    }
    expect((await contrato(id)).inicio).toBe('2026-01-01');
  });

  it('fin antes de inicio: error en fin (ambos en el cuerpo)', async () => {
    const id = await crearContratista(db);
    const e = await validacion(guardarMiContrato(deps, id, { inicio: '2026-06-01', fin: '2026-05-31' }));
    expect(e.campos.fin).toMatch(/no puede ser antes/);
    expect(await filasCambios()).toHaveLength(0);
    expect((await contrato(id)).fin).toBe('2026-09-30');
  });

  it('fin antes de inicio también cuando solo viene uno (se compara con el guardado)', async () => {
    const id = await crearContratista(db);
    const e1 = await validacion(guardarMiContrato(deps, id, { fin: '2025-12-31' }));
    expect(e1.campos.fin).toMatch(/no puede ser antes/);
    const e2 = await validacion(guardarMiContrato(deps, id, { inicio: '2026-10-01' }));
    expect(e2.campos.fin).toMatch(/no puede ser antes/);
    // inicio = fin sí vale
    await guardarMiContrato(deps, id, { inicio: '2026-09-30' });
    expect((await contrato(id)).inicio).toBe('2026-09-30');
  });

  it('Revisó: máximo 120 caracteres y tiene que ser texto', async () => {
    const id = await crearContratista(db);
    const e = await validacion(guardarMiContrato(deps, id, { revisoNombre: 'x'.repeat(121), revisoCargo: 'y'.repeat(121) }));
    expect(e.campos.revisoNombre).toMatch(/120/);
    expect(e.campos.revisoCargo).toMatch(/120/);
    await guardarMiContrato(deps, id, { revisoNombre: 'x'.repeat(120) });
    expect((await contrato(id)).revisoNombre).toHaveLength(120);
    const e2 = await validacion(guardarMiContrato(deps, id, { revisoCargo: 42 }));
    expect(e2.campos.revisoCargo).toMatch(/texto/);
  });

  it('junta todos los errores a la vez', async () => {
    const id = await crearContratista(db);
    const e = await validacion(guardarMiContrato(deps, id, { inicio: 'x', fin: '', revisoNombre: 'z'.repeat(200) }));
    expect(Object.keys(e.campos).sort()).toEqual(['fin', 'inicio', 'revisoNombre']);
  });

  it('largos máximos: dirección 150, ciudad 80, cargo 120, objeto 1500 (justo en el límite sí pasa)', async () => {
    const id = await crearContratista(db);
    const e = await validacion(
      guardarMiContrato(deps, id, { direccion: 'd'.repeat(151), ciudad: 'c'.repeat(81), cargo: 'k'.repeat(121), objeto: 'o'.repeat(1501) }),
    );
    expect(e.campos.direccion).toMatch(/150/);
    expect(e.campos.ciudad).toMatch(/80/);
    expect(e.campos.cargo).toMatch(/120/);
    expect(e.campos.objeto).toMatch(/1500/);
    await guardarMiContrato(deps, id, { direccion: 'd'.repeat(150), ciudad: 'c'.repeat(80), cargo: 'k'.repeat(120), objeto: 'o'.repeat(1500) });
    expect((await contrato(id)).objeto).toHaveLength(1500);
  });

  it('los campos obligatorios no se pueden vaciar ni mandar como otra cosa que texto', async () => {
    const id = await crearContratista(db);
    for (const k of ['direccion', 'telefono', 'ciudad', 'cargo', 'objeto', 'revisoNombre', 'revisoCargo']) {
      for (const malo of ['', '   ', null]) {
        expect(Object.keys((await validacion(guardarMiContrato(deps, id, { [k]: malo }))).campos)).toEqual([k]);
      }
      expect((await validacion(guardarMiContrato(deps, id, { [k]: 123 }))).campos[k]).toMatch(/texto/);
    }
    for (const malo of ['', '  ', null]) {
      expect((await validacion(guardarMiContrato(deps, id, { valorTotal: malo }))).campos.valorTotal).toMatch(/Escribe el valor total/);
    }
    expect(await filasCambios()).toHaveLength(0);
  });

  it('teléfono: solo números, espacios y +, entre 7 y 15 dígitos', async () => {
    const id = await crearContratista(db);
    for (const malo of ['123456', '1234567890123456', 'abc1234567', '300-123-4567', '(604) 1234567', '300.123.4567']) {
      expect((await validacion(guardarMiContrato(deps, id, { telefono: malo }))).campos.telefono).toMatch(/entre 7 y 15 dígitos/);
    }
    for (const bueno of ['1234567', '123456789012345', '300 123 4567', '+57 300 123 4567', ' 3001234567 ']) {
      await guardarMiContrato(deps, id, { telefono: bueno });
      expect((await contrato(id)).telefono).toBe(bueno.trim());
    }
  });

  it('correo: formato válido (o vacío); máximo 200 caracteres', async () => {
    const id = await crearContratista(db);
    for (const malo of ['sin-arroba', 'a@b', 'a b@c.co', '@c.co', `${'x'.repeat(200)}@c.co`]) {
      expect((await validacion(guardarMiContrato(deps, id, { correo: malo }))).campos.correo).toMatch(/formato válido/);
    }
    await guardarMiContrato(deps, id, { correo: 'nombre@correo.com' });
    expect((await contrato(id)).correo).toBe('nombre@correo.com');
  });

  it('valor total: entero en pesos, mayor que cero y no menor que el honorario', async () => {
    const id = await crearContratista(db);
    for (const malo of ['abc', '0', -5, '1.5.5', true, {}, 2_000_000_001]) {
      expect(Object.keys((await validacion(guardarMiContrato(deps, id, { valorTotal: malo }))).campos)).toEqual(['valorTotal']);
    }
    const menor = await validacion(guardarMiContrato(deps, id, { valorTotal: '4.008.999' }));
    expect(menor.campos.valorTotal).toMatch(/no puede ser menor que el honorario/);
    await guardarMiContrato(deps, id, { valorTotal: '4.009.000' }); // igual al honorario: sí vale
    expect((await contrato(id)).valorTotal).toBe(4009000);
  });

  it('un cuerpo sin ninguno de los campos editables no es una solicitud válida', async () => {
    const id = await crearContratista(db);
    expect((await amable(guardarMiContrato(deps, id, {}))).message).toMatch(/nada que guardar/);
    expect((await amable(guardarMiContrato(deps, id, { honorario: 1 }))).message).toMatch(/nada que guardar/);
  });
});

// =================================================================== solo 4 campos
describe('cualquier otra clave se ignora', () => {
  it('nombre, cédula, n.º de contrato, honorario, riesgo, activo y línea NO cambian', async () => {
    const id = await crearContratista(db, { linea: 'Línea de prueba' });
    const antes = await contrato(id);
    const r = await guardarMiContrato(deps, id, {
      revisoCargo: 'Nuevo cargo',
      honorario: 1,
      valor_total: 999, // en snake_case tampoco vale
      riesgo: 'V',
      riesgoNuevo: 'V',
      riesgoDesde: '2026-02-01',
      numeroContrato: 'HACKEADO',
      nombre: 'OTRO NOMBRE',
      cedula: '9999999999',
      activo: false,
      linea: 'otra línea',
      id: 999,
      contratoId: 999,
    });
    const despues = await contrato(id);
    expect(despues).toEqual({ ...antes, revisoCargo: 'Nuevo cargo' });
    expect(r.contrato.honorario).toBe(4009000);
    expect(r.contrato.riesgo).toBe('III');
    expect(r.contrato.numeroContrato).toBe('2026CPS999');
    expect(r.contrato.nombre).toBe('PRUEBA PÉREZ');
    const f = await filasCambios();
    expect(f).toHaveLength(1);
    expect(f[0].campo).toBe('revisoCargo');
  });

  it('lo no editable se ignora aunque venga junto con campos editables inválidos o sin ninguno', async () => {
    const id = await crearContratista(db);
    const antes = await contrato(id);
    // solo claves no editables: no hay nada que guardar
    await amable(guardarMiContrato(deps, id, { nombre: 'X', cedula: '1', honorario: 5, riesgo: 'V', activo: false, linea: 'x', numeroContrato: 'Y' }));
    // las no editables no producen errores de validación ni cambios aunque traigan basura
    const e = await validacion(guardarMiContrato(deps, id, { honorario: 'basura', riesgo: 'ZZ', cedula: 'abc', ciudad: '' }));
    expect(Object.keys(e.campos)).toEqual(['ciudad']);
    expect(await contrato(id)).toEqual(antes);
    expect(await filasCambios()).toHaveLength(0);
  });

  it('valorTotal sí es editable (con su validación), pero el honorario con el que se compara es el del supervisor', async () => {
    const id = await crearContratista(db);
    await guardarMiContrato(deps, id, { valorTotal: '50.000.000', honorario: 1 });
    const c = await contrato(id);
    expect(c.valorTotal).toBe(50000000);
    expect(c.honorario).toBe(4009000);
  });
});

// =================================================================== perfil completo
describe('perfilCompleto y faltan', () => {
  const VACIOS = { direccion: '', telefono: '', ciudad: '', cargo: '', objeto: '', revisoNombre: '', revisoCargo: '', inicio: null, fin: null, valorTotal: null };
  const TODAS = [
    'Dirección', 'Teléfono', 'Ciudad', 'Cargo', 'Objeto del contrato', 'Fecha de inicio', 'Fecha de fin',
    'Valor total del contrato', 'Nombre de quien revisa tu cuenta', 'Cargo de quien revisa tu cuenta',
  ];

  it('un contrato lleno está completo (el correo vacío no cuenta)', async () => {
    const id = await crearContratista(db, { correo: '' });
    const r = await resumenDeSesion(deps, id);
    expect(r.perfilCompleto).toBe(true);
    expect(r.faltan).toEqual([]);
  });

  it('un contrato vacío puede entrar (solo exige honorario) y lista todo lo que falta', async () => {
    const id = await crearContratista(db, VACIOS);
    const r = (await login(deps, 'prueba perez', '0879')).resumen;
    expect(r.perfilCompleto).toBe(false);
    expect(r.faltan).toEqual(TODAS);
    expect(r.meses).toEqual([]);
    expect(r.mesDefault).toBe('');
    expect(r.inicio).toBe('');
    expect(r.honorario).toBe(4009000);
    expect(r.riesgo).toBe('III');
    expect(id).toBeGreaterThan(0);
  });

  it('con cada campo que llena, falta uno menos, hasta quedar completo (PUT y sesión coinciden)', async () => {
    const id = await crearContratista(db, VACIOS);
    const pasos: Array<[Record<string, unknown>, string]> = [
      [{ direccion: 'Calle 9 # 8-7' }, 'Dirección'],
      [{ telefono: '3001112233' }, 'Teléfono'],
      [{ ciudad: 'Medellín' }, 'Ciudad'],
      [{ cargo: 'Profesional' }, 'Cargo'],
      [{ objeto: 'Objeto ficticio.' }, 'Objeto del contrato'],
      [{ inicio: '2026-01-01' }, 'Fecha de inicio'],
      [{ fin: '2026-09-30' }, 'Fecha de fin'],
      [{ valorTotal: '36.081.000' }, 'Valor total del contrato'],
      [{ revisoNombre: 'Revisora de Prueba' }, 'Nombre de quien revisa tu cuenta'],
    ];
    let esperadas = [...TODAS];
    for (const [cuerpo, etiqueta] of pasos) {
      const r = await guardarMiContrato(deps, id, cuerpo);
      esperadas = esperadas.filter((x) => x !== etiqueta);
      expect(r.contrato.faltan).toEqual(esperadas);
      expect(r.contrato.perfilCompleto).toBe(false);
      expect((await resumenDeSesion(deps, id)).faltan).toEqual(esperadas);
    }
    const ultimo = await guardarMiContrato(deps, id, { revisoCargo: 'Apoyo Técnico' });
    expect(ultimo.contrato.perfilCompleto).toBe(true);
    expect(ultimo.contrato.faltan).toEqual([]);
    expect(ultimo.contrato.meses).toHaveLength(9);
    expect(ultimo.contrato.mesDefault).toBe('2026-09');
    expect((await login(deps, 'prueba perez', '0879')).resumen.perfilCompleto).toBe(true);
  });

  it('el perfil se puede llenar todo de una vez, con el correo opcional', async () => {
    const id = await crearContratista(db, VACIOS);
    const r = await guardarMiContrato(deps, id, {
      direccion: 'Calle 9 # 8-7', telefono: '300 111 2233', ciudad: 'Medellín', cargo: 'Profesional', objeto: 'Objeto ficticio.',
      inicio: '2026-01-16', fin: '2026-09-30', valorTotal: '34.076.500', revisoNombre: 'Revisora de Prueba', revisoCargo: 'Apoyo Técnico',
    });
    expect(r.contrato.perfilCompleto).toBe(true);
    expect(r.aviso).toBeUndefined(); // 34.076.500 es justo lo que da el honorario con inicio el 16/01
    expect(r.datos.correo).toBe('');
  });

  it('vaciar un campo con el supervisor (admin) hace que vuelva a faltar', async () => {
    const id = await crearContratista(db);
    expect((await resumenDeSesion(deps, id)).perfilCompleto).toBe(true);
    await actualizarContrato(deps, id, { ciudad: '' });
    const r = await resumenDeSesion(deps, id);
    expect(r.perfilCompleto).toBe(false);
    expect(r.faltan).toEqual(['Ciudad']);
  });

  it('sin honorario no entra (solo lo pone el supervisor)', async () => {
    await crearContratista(db, { honorario: null });
    await expect(login(deps, 'prueba perez', '0879')).rejects.toThrowError(/honorario/);
  });
});

// =================================================================== aviso y alerta del valor total
describe('valor total distinto al esperado', () => {
  it('distinto: devuelve el aviso con las dos cifras, guarda igual y marca la alerta en la bitácora', async () => {
    const id = await crearContratista(db);
    const r = await guardarMiContrato(deps, id, { valorTotal: '$ 44.099.000' });
    expect(r.aviso).toBe(
      'El valor total que escribiste ($44.099.000) no coincide con el que da tu honorario por la vigencia ($36.081.000). ' +
        'Revísalo con tu acta; si tu acta dice otra cifra, déjalo así.',
    );
    expect((await contrato(id)).valorTotal).toBe(44099000); // no bloquea
    expect(r.datos.valorTotal).toBe(44099000);
    expect(r.datos.valorTotalEsperado).toBe(36081000);
    const f = await filasCambios();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ campo: 'valorTotal', antes: '$36.081.000', despues: '$44.099.000', alerta: true });
  });

  it('igual al esperado: sin aviso y sin alerta', async () => {
    const id = await crearContratista(db, { valorTotal: 50000000 });
    const r = await guardarMiContrato(deps, id, { valorTotal: '36.081.000' });
    expect(r.aviso).toBeUndefined();
    const f = await filasCambios();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ campo: 'valorTotal', alerta: false });
  });

  it('el esperado se calcula con las fechas que se guardan en la misma petición (inicio el 16/01)', async () => {
    const id = await crearContratista(db);
    const bien = await guardarMiContrato(deps, id, { inicio: '2026-01-16', valorTotal: '34.076.500' });
    expect(bien.aviso).toBeUndefined();
    expect((await filasCambios()).every((x) => !x.alerta)).toBe(true);
    const mal = await guardarMiContrato(deps, id, { valorTotal: '36.081.000' });
    expect(mal.aviso).toMatch(/\(\$36\.081\.000\).*\(\$34\.076\.500\)/);
  });

  it('si no manda el valor total no hay aviso, aunque el guardado no coincida', async () => {
    const id = await crearContratista(db, { valorTotal: 99000000 });
    const r = await guardarMiContrato(deps, id, { revisoCargo: 'Otro cargo' });
    expect(r.aviso).toBeUndefined();
    expect((await filasCambios()).map((x) => x.alerta)).toEqual([false]);
  });

  it('mandar el mismo valor distinto al esperado repite el aviso pero no escribe otra fila', async () => {
    const id = await crearContratista(db, { valorTotal: 44099000 });
    const r = await guardarMiContrato(deps, id, { valorTotal: '44.099.000' });
    expect(r.aviso).toMatch(/no coincide/);
    expect(await filasCambios()).toHaveLength(0);
  });

  it('el valor total no cambia lo que se cobra: solo el % de ejecución', async () => {
    const id = await crearContratista(db);
    const cargaId = await crearCarga(db, id, '2026-03', { acumulado: 0, pct: 0 });
    await guardarMiContrato(deps, id, { valorTotal: '72.162.000' });
    const [g] = await db.select().from(cargas).where(eq(cargas.id, cargaId));
    expect(g.valor).toBe(4009000);
    expect(g.pct).toBeCloseTo((3 * 4009000) / 72162000, 10);
  });
});

// =================================================================== bitácora
describe('bitácora: solo cambios reales', () => {
  it('mandar lo mismo no escribe nada (ni con espacios sobrantes)', async () => {
    const id = await crearContratista(db);
    const r = await guardarMiContrato(deps, id, {
      inicio: '2026-01-01',
      fin: '2026-09-30',
      revisoNombre: 'Revisora de Prueba',
      revisoCargo: '  Apoyo Técnico  ',
    });
    expect(r.datos.revisoCargo).toBe('Apoyo Técnico');
    expect(await filasCambios()).toHaveLength(0);
  });

  it('si cambia solo uno de los cuatro, hay una sola fila', async () => {
    const id = await crearContratista(db);
    await guardarMiContrato(deps, id, { inicio: '2026-01-01', fin: '2026-10-30', revisoNombre: 'Revisora de Prueba', revisoCargo: 'Apoyo Técnico' });
    const f = await filasCambios();
    expect(f).toHaveLength(1);
    expect(f[0].campo).toBe('fin');
  });

  it('un error de validación no deja filas ni cambios a medias', async () => {
    const id = await crearContratista(db);
    await validacion(guardarMiContrato(deps, id, { revisoNombre: 'Alguien', fin: 'mal' }));
    expect(await filasCambios()).toHaveLength(0);
    expect((await contrato(id)).revisoNombre).toBe('Revisora de Prueba');
  });

  it('dos cambios seguidos suman filas con antes/después encadenados', async () => {
    const id = await crearContratista(db);
    await guardarMiContrato(deps, id, { fin: '2026-10-31' });
    await guardarMiContrato(deps, id, { fin: '2026-11-30' });
    const f = await filasCambios();
    expect(f.map((x) => [x.antes, x.despues])).toEqual([
      ['30/09/2026', '31/10/2026'],
      ['31/10/2026', '30/11/2026'],
    ]);
  });
});

// =================================================================== cuentas ya enviadas
describe('cuentas ya enviadas', () => {
  it('la foto del contrato (snapshot) de las cargas pasadas no se toca, pero el acumulado se recalcula', async () => {
    const id = await crearContratista(db);
    const c0 = await contrato(id);
    const snapshot = snapshotDeContrato(c0, '2026-03');
    const cargaId = await crearCarga(db, id, '2026-03', { contratoSnapshot: snapshot, acumulado: 0, pct: 0 });

    const r = await guardarMiContrato(deps, id, { inicio: '2026-03-01', fin: '2026-12-31', revisoNombre: 'Persona Nueva' });
    expect(r.contrato.meses[0].key).toBe('2026-03');
    expect(r.contrato.meses[0].enviado).toBe('✅ OK');

    const [g] = await db.select().from(cargas).where(eq(cargas.id, cargaId));
    expect(g.contratoSnapshot).toEqual(snapshot);
    expect(g.contratoSnapshot?.inicio).toBe('2026-01-01');
    expect(g.contratoSnapshot?.revisoNombre).toBe('Revisora de Prueba');
    // con inicio en marzo, lo acumulado hasta marzo es solo marzo
    expect(g.acumulado).toBe(4009000);
    expect(g.pct).toBeCloseTo(4009000 / 36081000, 10);
    // lo demás de la carga queda igual
    expect(g.valor).toBe(4009000);
    expect(g.docNum).toBe(202603);
    expect(g.estado).toBe('OK');
  });

  it('una carga que queda fuera del nuevo periodo no se toca (conserva su historia)', async () => {
    const id = await crearContratista(db);
    const cargaId = await crearCarga(db, id, '2026-01', { acumulado: 4009000, pct: 0.1111 });
    await guardarMiContrato(deps, id, { inicio: '2026-03-01' });
    const [g] = await db.select().from(cargas).where(eq(cargas.id, cargaId));
    expect(g.acumulado).toBe(4009000);
    expect(g.pct).toBe(0.1111);
  });

  it('el resumen de la sesión (/api/sesion) refleja las fechas nuevas', async () => {
    const id = await crearContratista(db);
    await guardarMiContrato(deps, id, { fin: '2026-11-30' });
    const s = await resumenDeSesion(deps, id);
    expect(s.fin).toBe('2026-11-30');
    expect(s.meses).toHaveLength(11);
  });
});

// =================================================================== 401
describe('sin sesión -> 401', () => {
  it('contrato inexistente o desactivado: leer y guardar dan 401', async () => {
    const id = await crearContratista(db, { activo: false });
    for (const quien of [id, 9999]) {
      expect((await amable(leerMiContrato(deps, quien))).estado).toBe(401);
      expect((await amable(guardarMiContrato(deps, quien, { revisoCargo: 'x' }))).estado).toBe(401);
    }
    expect(await filasCambios()).toHaveLength(0);
  });

  it('la ruta exige la cookie de sesión de contratista', () => {
    const req = (valor?: string) => ({ cookies: { get: (n: string) => (n === 'sesion' && valor ? { value: valor } : undefined) } }) as unknown as NextRequest;
    expect(() => contratoIdDeSesion(req())).toThrowError(/sesión venció/);
    expect(() => contratoIdDeSesion(req('basura'))).toThrowError(/sesión venció/);
    try {
      contratoIdDeSesion(req());
    } catch (e) {
      expect((e as ErrorAmable).estado).toBe(401);
    }
    expect(contratoIdDeSesion(req(crearToken(5)))).toBe(5);
  });
});

// =================================================================== admin: cambios
describe('GET /api/admin/cambios', () => {
  /** Reloj que avanza un minuto en cada lectura: así el orden "más nuevo primero" se puede comprobar. */
  function depsConReloj(): Deps {
    let t = AHORA.getTime();
    return crearDeps(db, new BlobFalso(), () => new Date((t += 60_000)));
  }

  it('lista todos, más nuevos primero, con etiqueta y nombre', async () => {
    const d = depsConReloj();
    const ana = await crearContratista(db, { nombre: 'ANA PRUEBA', cedula: '1000000111' });
    const bea = await crearContratista(db, { nombre: 'BEA PRUEBA', cedula: '1000000222' });
    await guardarMiContrato(d, ana, { fin: '2026-10-31' });
    await guardarMiContrato(d, bea, { revisoNombre: 'Persona Nueva' });
    await actualizarContrato(d, ana, { inicio: '2026-01-15' });

    const todos = await listarCambios(db);
    expect(todos.map((c) => [c.nombre, c.autor, c.etiqueta])).toEqual([
      ['ANA PRUEBA', 'admin', 'Fecha de inicio'],
      ['BEA PRUEBA', 'contratista', 'Revisó (nombre)'],
      ['ANA PRUEBA', 'contratista', 'Fecha de fin'],
    ]);
    expect(todos[0]).toMatchObject({ contratoId: ana, campo: 'inicio', antes: '01/01/2026', despues: '15/01/2026' });
    expect(todos[0].creado).toBeInstanceOf(Date);
    expect(typeof todos[0].id).toBe('number');
  });

  it('filtra por contrato (acepta el id como texto de la URL)', async () => {
    const d = depsConReloj();
    const ana = await crearContratista(db, { nombre: 'ANA PRUEBA', cedula: '1000000111' });
    const bea = await crearContratista(db, { nombre: 'BEA PRUEBA', cedula: '1000000222' });
    await guardarMiContrato(d, ana, { fin: '2026-10-31' });
    await guardarMiContrato(d, bea, { revisoNombre: 'Persona Nueva' });
    const deBea = await listarCambios(db, String(bea));
    expect(deBea).toHaveLength(1);
    expect(deBea[0]).toMatchObject({ contratoId: bea, nombre: 'BEA PRUEBA', campo: 'revisoNombre' });
    expect(await listarCambios(db, '')).toHaveLength(2);
    expect(await listarCambios(db, null)).toHaveLength(2);
    expect(await listarCambios(db, '12345')).toEqual([]);
  });

  it('contratoId mal escrito: 400', async () => {
    for (const malo of ['abc', '-1', '1.5', '12345678901']) {
      expect((await amable(listarCambios(db, malo))).estado).toBe(400);
    }
  });

  it('devuelve como máximo 100', async () => {
    const id = await crearContratista(db);
    await db.insert(cambiosContrato).values(
      Array.from({ length: 130 }, (_, i) => ({ contratoId: id, autor: 'admin', campo: 'fin', antes: `a${i}`, despues: `d${i}` })),
    );
    const l = await listarCambios(db);
    expect(l).toHaveLength(100);
    expect(l[0].antes).toBe('a129'); // mismo instante: desempata por id, el último primero
  });

  it('etiqueta de cada campo editable y campo desconocido se muestra tal cual', async () => {
    const id = await crearContratista(db);
    await db.insert(cambiosContrato).values(
      [...CAMPOS_CONTRATISTA, 'otroCampo'].map((campo) => ({ contratoId: id, autor: 'contratista', campo, antes: 'a', despues: 'b' })),
    );
    const et = (await listarCambios(db)).map((c) => c.etiqueta).sort();
    expect(et).toEqual(
      [
        'Dirección', 'Teléfono', 'Ciudad', 'Correo', 'Cargo', 'Objeto del contrato', 'Fecha de inicio', 'Fecha de fin',
        'Valor total del contrato', 'Revisó (nombre)', 'Revisó (cargo)', 'otroCampo',
      ].sort(),
    );
  });

  it('devuelve `alerta`: true solo en el cambio de valor total distinto al esperado', async () => {
    const d = depsConReloj();
    const id = await crearContratista(db, { nombre: 'ANA PRUEBA', cedula: '1000000111' });
    await guardarMiContrato(d, id, { revisoCargo: 'Otro cargo' });
    await guardarMiContrato(d, id, { valorTotal: '44.099.000' }); // distinto al esperado: alerta
    await guardarMiContrato(d, id, { valorTotal: '36.081.000' }); // vuelve al esperado: sin alerta
    await actualizarContrato(d, id, { valorTotal: 50000000 }); // el admin no genera alertas

    const todos = await listarCambios(db);
    expect(todos.map((c) => [c.autor, c.campo, c.alerta])).toEqual([
      ['admin', 'valorTotal', false],
      ['contratista', 'valorTotal', false],
      ['contratista', 'valorTotal', true],
      ['contratista', 'revisoCargo', false],
    ]);
    expect((await listarCambios(db, String(id))).filter((c) => c.alerta)).toHaveLength(1);
  });

  it('la ruta exige la cookie de admin: sin ella, 401', () => {
    const req = { cookies: { get: () => undefined } } as unknown as NextRequest;
    expect(() => exigirAdmin(req)).toThrowError(/administración/);
    try {
      exigirTokenAdmin('basura');
    } catch (e) {
      expect((e as ErrorAmable).estado).toBe(401);
    }
    // la cookie de contratista tampoco abre la bitácora del admin
    const deContratista = { cookies: { get: (n: string) => (n === 'sesion' ? { value: crearToken(1) } : undefined) } } as unknown as NextRequest;
    expect(() => exigirAdmin(deContratista)).toThrowError(/administración/);
  });
});

// =================================================================== admin: edición queda anotada
describe('la edición del admin también se anota', () => {
  it('anota solo lo que cambió, con autor admin', async () => {
    const id = await crearContratista(db);
    await actualizarContrato(deps, id, { fin: '2026-12-31', honorario: '5.000.000', valorTotal: 50000000, riesgo: 'IV', objeto: 'Otro objeto ficticio.' });
    const f = await filasCambios();
    expect(f.every((x) => x.autor === 'admin' && x.contratoId === id)).toBe(true);
    const por = Object.fromEntries(f.map((x) => [x.campo, [x.antes, x.despues]]));
    expect(por).toEqual({
      fin: ['30/09/2026', '31/12/2026'],
      honorario: ['$4.009.000', '$5.000.000'],
      valorTotal: ['$36.081.000', '$50.000.000'],
      riesgo: ['III', 'IV'],
      objeto: ['Objeto ficticio de prueba.', 'Otro objeto ficticio.'],
    });
  });

  it('guardar sin cambiar nada no escribe filas', async () => {
    const id = await crearContratista(db);
    await actualizarContrato(deps, id, { fin: '2026-09-30', revisoNombre: 'Revisora de Prueba' });
    expect(await filasCambios()).toHaveLength(0);
  });

  it('un error de validación no anota nada', async () => {
    const id = await crearContratista(db);
    await expect(actualizarContrato(deps, id, { fin: '2025-01-01' })).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await filasCambios()).toHaveLength(0);
  });

  it('nunca anota datos personales (cédula, dirección, teléfono, correo)', async () => {
    const id = await crearContratista(db);
    await actualizarContrato(deps, id, { cedula: '1000002222', direccion: 'Otra calle', telefono: '3111111111', correo: 'x@y.co', ciudad: 'Bello' });
    expect(await filasCambios()).toHaveLength(0);
  });

  it('el borrado del contrato borra su bitácora', async () => {
    const id = await crearContratista(db);
    await guardarMiContrato(deps, id, { revisoCargo: 'Otro' });
    expect(await filasCambios()).toHaveLength(1);
    await borrarContrato(deps, id, '');
    expect(await filasCambios()).toHaveLength(0);
  });
});
