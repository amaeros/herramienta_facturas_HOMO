import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actualizarContrato, borrarContrato } from '../admin';
import { exigirTokenAdmin } from '../adminAuth';
import { crearToken } from '../auth';
import { listarCambios } from '../cambios';
import type { Db } from '../db';
import { cambiosContrato, cargas, contratos } from '../db/schema';
import { ErrorAmable, ErrorValidacion } from '../errores';
import { contratoIdDeSesion, exigirAdmin } from '../http';
import { guardarMiContrato, leerMiContrato } from '../miContrato';
import { resumenDeSesion, snapshotDeContrato, type Deps } from '../servicios';
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
  it('devuelve los 4 campos editables', async () => {
    const id = await crearContratista(db);
    expect(await leerMiContrato(deps, id)).toEqual({
      inicio: '2026-01-01',
      fin: '2026-09-30',
      revisoNombre: 'Revisora de Prueba',
      revisoCargo: 'Apoyo Técnico',
    });
  });

  it('fechas vacías si el contrato aún no las tiene', async () => {
    const id = await crearContratista(db, { inicio: null, fin: null });
    const d = await leerMiContrato(deps, id);
    expect(d.inicio).toBe('');
    expect(d.fin).toBe('');
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

  it('se puede dejar vacío quién revisó (queda anotado como vacío)', async () => {
    const id = await crearContratista(db);
    await guardarMiContrato(deps, id, { revisoCargo: '   ' });
    expect((await contrato(id)).revisoCargo).toBe('');
    expect((await filasCambios())[0]).toMatchObject({ campo: 'revisoCargo', antes: 'Apoyo Técnico', despues: '(vacío)' });
  });

  it('los 4 campos juntos: 4 filas de bitácora', async () => {
    const id = await crearContratista(db);
    await guardarMiContrato(deps, id, { inicio: '2026-02-01', fin: '2026-10-31', revisoNombre: 'Otra Persona', revisoCargo: 'Líder' });
    expect((await filasCambios()).map((x) => x.campo).sort()).toEqual(['fin', 'inicio', 'revisoCargo', 'revisoNombre']);
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

  it('un cuerpo sin ninguno de los 4 campos no es una solicitud válida', async () => {
    const id = await crearContratista(db);
    expect((await amable(guardarMiContrato(deps, id, {}))).message).toMatch(/nada que guardar/);
    expect((await amable(guardarMiContrato(deps, id, { honorario: 1 }))).message).toMatch(/nada que guardar/);
  });
});

// =================================================================== solo 4 campos
describe('cualquier otra clave se ignora', () => {
  it('honorario, valorTotal, riesgo, numeroContrato... NO cambian', async () => {
    const id = await crearContratista(db);
    const antes = await contrato(id);
    const r = await guardarMiContrato(deps, id, {
      revisoCargo: 'Nuevo cargo',
      honorario: 1,
      valorTotal: 999,
      valor_total: 999,
      riesgo: 'V',
      riesgoNuevo: 'V',
      riesgoDesde: '2026-02-01',
      numeroContrato: 'HACKEADO',
      nombre: 'OTRO NOMBRE',
      cedula: '9999999999',
      objeto: 'otro objeto',
      activo: false,
      id: 999,
      contratoId: 999,
    });
    const despues = await contrato(id);
    expect(despues).toEqual({ ...antes, revisoCargo: 'Nuevo cargo' });
    expect(r.contrato.honorario).toBe(4009000);
    expect(r.contrato.riesgo).toBe('III');
    expect(r.contrato.numeroContrato).toBe('2026CPS999');
    const f = await filasCambios();
    expect(f).toHaveLength(1);
    expect(f[0].campo).toBe('revisoCargo');
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

  it('etiqueta de los 4 campos y campo desconocido se muestra tal cual', async () => {
    const id = await crearContratista(db);
    await db.insert(cambiosContrato).values(
      ['inicio', 'fin', 'revisoNombre', 'revisoCargo', 'otroCampo'].map((campo) => ({ contratoId: id, autor: 'admin', campo, antes: 'a', despues: 'b' })),
    );
    const et = (await listarCambios(db)).map((c) => c.etiqueta).sort();
    expect(et).toEqual(['Fecha de fin', 'Fecha de inicio', 'Revisó (cargo)', 'Revisó (nombre)', 'otroCampo']);
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
