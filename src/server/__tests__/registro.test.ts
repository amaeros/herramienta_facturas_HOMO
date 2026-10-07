// Registro propio de la contratista + aprobación del supervisor. TODOS los datos son inventados.
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actualizarContrato, crearContrato, listarContratos } from '../admin';
import { verificarLogin } from '../auth';
import { listarCambios } from '../cambios';
import type { Db } from '../db';
import { cambiosContrato, contratos, intentosPin } from '../db/schema';
import { ErrorAmable, ErrorValidacion } from '../errores';
import {
  CAMPOS_REGISTRO,
  MAX_REGISTROS_POR_HORA,
  MAX_SOLICITUDES_PENDIENTES,
  MENSAJE_LIMITE_REGISTRO,
  MENSAJE_TOPE_PENDIENTES,
  ipDeSolicitud,
  registrarSolicitud,
} from '../registro';
import { contratoActivo, listarContratistas, type Deps } from '../servicios';
import { aprobarSolicitud, detalleSolicitud, listarSolicitudes, rechazarSolicitud } from '../solicitudes';
import { AHORA, BlobFalso, crearBase, crearContratista, crearDeps, vaciar } from './helpers';

let db: Db;
let deps: Deps;
let ahora: Date;

beforeAll(async () => {
  db = await crearBase();
});

beforeEach(async () => {
  await vaciar(db);
  ahora = AHORA;
  deps = crearDeps(db, new BlobFalso(), () => ahora);
});

const IP = '203.0.113.7';

const SOLICITUD = {
  nombre: 'Nueva Prueba Uno',
  cedula: '1000005551',
  direccion: 'Carrera 5 # 6-7',
  telefono: '300 000 0000',
  ciudad: 'Medellín',
  correo: '',
  linea: 'Línea de prueba',
  numeroContrato: '2026CPS555',
  cargo: 'Profesional de prueba',
  objeto: 'Objeto ficticio de prueba.',
  inicio: '2026-01-01',
  fin: '2026-09-30',
  honorario: '4.009.000',
  valorTotal: '36.081.000',
  riesgo: 'III',
  revisoNombre: 'Revisora de Prueba',
  revisoCargo: 'Apoyo Técnico',
};

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

async function filas() {
  return db.select().from(contratos);
}

/** Registra con una IP distinta cada vez (para no chocar con el límite por hora). */
let n = 0;
function registrar(over: Record<string, unknown> = {}, ip?: string) {
  return registrarSolicitud(deps, { ...SOLICITUD, ...over }, ip ?? `198.51.100.${++n}`);
}

describe('registro: crea una solicitud pendiente', () => {
  it('guarda todo, queda pendiente e inactiva y anota el registro en la bitácora', async () => {
    expect(await registrar({ correo: ' nueva@ejemplo.com ', cedula: '1.000.005.551' })).toBe(true);
    const [c] = await filas();
    expect(c).toMatchObject({
      nombre: 'Nueva Prueba Uno',
      cedula: '1000005551',
      estado: 'pendiente',
      activo: false,
      honorario: 4009000,
      valorTotal: 36081000,
      riesgo: 'III',
      inicio: '2026-01-01',
      fin: '2026-09-30',
      linea: 'Línea de prueba',
      correo: 'nueva@ejemplo.com',
      riesgoNuevo: '',
    });
    const bit = await db.select().from(cambiosContrato).where(eq(cambiosContrato.contratoId, c.id));
    expect(bit).toHaveLength(1);
    expect(bit[0]).toMatchObject({ autor: 'contratista', campo: 'registro' });
  });

  it('el correo es opcional; cualquier otro campo vacío se señala junto al campo', async () => {
    await registrar({ correo: '' });
    await vaciar(db);
    const e = await validacion(registrarSolicitud(deps, {}, IP));
    expect(Object.keys(e.campos).sort()).toEqual(CAMPOS_REGISTRO.filter((c) => c !== 'correo').sort());
    expect(e.campos.nombre).toBe('Escribe tu nombre completo.');
    expect(e.campos.riesgo).toMatch(/riesgo ARL/);
    expect(await filas()).toHaveLength(0);
  });

  it('ignora lo que no es del registro: activo, estado, riesgo nuevo, id', async () => {
    await registrar({ activo: true, estado: 'activa', riesgoNuevo: 'V', riesgoDesde: '2026-06-01', id: 99 });
    const [c] = await filas();
    expect(c).toMatchObject({ estado: 'pendiente', activo: false, riesgoNuevo: '', riesgoDesde: null });
    expect(c.id).not.toBe(99);
  });

  it('revisa formatos con las reglas del panel y de "Mi contrato"', async () => {
    const e = await validacion(
      registrar({
        telefono: 'abc',
        riesgo: 'X',
        cedula: '12',
        correo: 'no-es-correo',
        inicio: '2026-09-30',
        fin: '2026-01-01',
        honorario: '5.000.000',
        valorTotal: '1.000.000',
        objeto: 'x'.repeat(1501),
      }),
    );
    expect(e.campos.telefono).toMatch(/entre 7 y 15 dígitos/);
    expect(e.campos.riesgo).toMatch(/I, II, III, IV o V/);
    expect(e.campos.cedula).toMatch(/entre 6 y 10/);
    expect(e.campos.correo).toMatch(/formato válido/);
    expect(e.campos.fin).toMatch(/antes de la fecha de inicio/);
    expect(e.campos.valorTotal).toMatch(/menor que el honorario/);
    expect(e.campos.objeto).toMatch(/máximo 1500/);
    expect(await filas()).toHaveLength(0);
  });

  it('acepta riesgo en número y honorario como número', async () => {
    await registrar({ riesgo: '3', honorario: 4009000, valorTotal: 36081000 });
    const [c] = await filas();
    expect(c.riesgo).toBe('III');
    expect(c.honorario).toBe(4009000);
  });
});

describe('registro: nombre y cédula únicos (también contra las pendientes)', () => {
  it('nombre repetido de una cuenta activa, sin tildes ni mayúsculas', async () => {
    await crearContratista(db, { nombre: 'Ana Pérez Prueba', cedula: '1000000001' });
    const e = await validacion(registrar({ nombre: '  ANA   PEREZ prueba ' }));
    expect(e.campos.nombre).toBe('Ya existe una cuenta con ese nombre. Si es tuya, habla con tu supervisor.');
  });

  it('cédula repetida de una cuenta activa', async () => {
    await crearContratista(db, { nombre: 'Ana Pérez Prueba', cedula: '1000005551' });
    const e = await validacion(registrar());
    expect(e.campos.cedula).toBe('Ya existe una cuenta con esa cédula. Si es tuya, habla con tu supervisor.');
    expect(Object.keys(e.campos)).toEqual(['cedula']);
  });

  it('contra otra solicitud pendiente: nombre y cédula', async () => {
    await registrar();
    const a = await validacion(registrar({ nombre: 'NUEVA PRUEBA UNO', cedula: '1000006662' }));
    expect(a.campos.nombre).toMatch(/Ya existe una cuenta con ese nombre/);
    const b = await validacion(registrar({ nombre: 'Otra Persona Prueba' }));
    expect(b.campos.cedula).toMatch(/Ya existe una cuenta con esa cédula/);
    expect(await filas()).toHaveLength(1);
  });

  it('el panel tampoco deja crear una trabajadora con el nombre de una solicitud pendiente', async () => {
    await registrar();
    const e = await validacion(crearContrato(deps, { nombre: 'nueva prueba uno', cedula: '1000009990' }));
    expect(e.campos.nombre).toMatch(/Ya hay otra trabajadora con ese nombre/);
  });
});

describe('registro: defensas contra abuso', () => {
  it('campo trampa lleno: no guarda nada, no cuenta contra el límite y no dice que falló', async () => {
    expect(await registrarSolicitud(deps, { ...SOLICITUD, sitio_web: 'https://spam.ejemplo' }, IP)).toBe(false);
    expect(await filas()).toHaveLength(0);
    expect(await db.select().from(intentosPin)).toHaveLength(0);
    // vacío o con solo espacios sí pasa
    expect(await registrarSolicitud(deps, { ...SOLICITUD, sitio_web: '  ' }, IP)).toBe(true);
    expect(await filas()).toHaveLength(1);
  });

  it(`tope de ${MAX_SOLICITUDES_PENDIENTES} solicitudes pendientes`, async () => {
    const base = Array.from({ length: MAX_SOLICITUDES_PENDIENTES }, (_, i) => ({
      nombre: `Pendiente Prueba ${i}`,
      cedula: String(2000000000 + i),
      estado: 'pendiente',
      activo: false,
    }));
    await db.insert(contratos).values(base);
    const e = await amable(registrar({ nombre: 'Una Más Prueba', cedula: '1000007777' }));
    expect(e.message).toBe(MENSAJE_TOPE_PENDIENTES);
    expect(e.message).toBe('No se pueden recibir más solicitudes por ahora.');
    expect(await filas()).toHaveLength(MAX_SOLICITUDES_PENDIENTES);
    // las cuentas activas no cuentan para el tope
    await db.delete(contratos).where(eq(contratos.nombre, 'Pendiente Prueba 0'));
    await crearContratista(db);
    await registrar({ nombre: 'Una Más Prueba', cedula: '1000007777' });
  });

  it(`límite por IP: ${MAX_REGISTROS_POR_HORA} intentos por hora (cuentan también los que traen errores)`, async () => {
    for (let i = 0; i < MAX_REGISTROS_POR_HORA; i++) await validacion(registrarSolicitud(deps, {}, IP));
    const e = await amable(registrarSolicitud(deps, SOLICITUD, IP));
    expect(e).not.toBeInstanceOf(ErrorValidacion);
    expect(e.message).toBe(MENSAJE_LIMITE_REGISTRO);
    expect(e.estado).toBe(429);
    expect(await filas()).toHaveLength(0);
    const [k] = await db.select().from(intentosPin);
    expect(k.clave).toBe('__registro__:' + IP);
    // otra IP no se afecta
    expect(await registrarSolicitud(deps, SOLICITUD, '203.0.113.99')).toBe(true);
  });

  it('el límite se vence a la hora', async () => {
    for (let i = 0; i < MAX_REGISTROS_POR_HORA + 1; i++) await registrarSolicitud(deps, {}, IP).catch(() => undefined);
    await amable(registrarSolicitud(deps, SOLICITUD, IP));
    ahora = new Date(AHORA.getTime() + 61 * 60 * 1000);
    expect(await registrarSolicitud(deps, SOLICITUD, IP)).toBe(true);
  });

  it('la IP sale del primer valor de x-forwarded-for', () => {
    expect(ipDeSolicitud('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
    expect(ipDeSolicitud(' 2001:db8::1 ')).toBe('2001:db8::1');
    expect(ipDeSolicitud(null)).toBe('desconocida');
    expect(ipDeSolicitud('')).toBe('desconocida');
    expect(ipDeSolicitud('<script>')).toBe('desconocida');
  });
});

describe('solicitud pendiente: no existe para el resto de la app', () => {
  it('no aparece en la lista del celular, no puede entrar ni tiene sesión', async () => {
    await crearContratista(db); // una cuenta activa de control
    await registrar();
    expect(await listarContratistas(deps)).toEqual(['PRUEBA PÉREZ']);
    // el PIN (últimos 4 de la cédula) es correcto, pero no entra, con el mismo mensaje que un PIN malo
    const e = await amable(verificarLogin(db, 'Nueva Prueba Uno', '5551', ahora));
    expect(e.estado).toBe(401);
    const [c] = await db.select().from(contratos).where(eq(contratos.estado, 'pendiente'));
    const s = await amable(contratoActivo(db, c.id));
    expect(s.estado).toBe(401);
  });

  it('GET /api/admin/contratos (listarContratos) no la incluye y editarla o borrarla desde ahí da "no existe"', async () => {
    await crearContratista(db);
    await registrar();
    const lista = await listarContratos(deps);
    expect(lista.map((c) => c.nombre)).toEqual(['PRUEBA PÉREZ']);
    const [p] = await db.select().from(contratos).where(eq(contratos.estado, 'pendiente'));
    expect((await amable(actualizarContrato(deps, p.id, { fin: '2026-10-30' }))).estado).toBe(404);
  });

  it('su bitácora no sale en "cambios recientes" hasta que se apruebe', async () => {
    await registrar();
    expect(await listarCambios(db)).toHaveLength(0);
  });
});

describe('supervisor: lista, detalle, aprobar y rechazar', () => {
  it('la lista enmascara la cédula (…1234) y el detalle la trae completa, con la fecha de la solicitud', async () => {
    await registrar();
    const [l] = await listarSolicitudes(deps);
    expect(l.cedulaFinal4).toBe('…5551');
    expect(l).not.toHaveProperty('cedula');
    expect(JSON.stringify(l)).not.toContain('1000005551');
    expect(l.nombre).toBe('Nueva Prueba Uno');
    expect(l.solicitada).toEqual(AHORA);
    const d = await detalleSolicitud(deps, l.id);
    expect(d.cedula).toBe('1000005551');
    expect(d.objeto).toBe('Objeto ficticio de prueba.');
  });

  it('solo lista pendientes y de la más antigua a la más nueva', async () => {
    await crearContratista(db);
    await registrar({ nombre: 'Segunda Prueba', cedula: '1000008882' });
    ahora = new Date(AHORA.getTime() + 60_000);
    await registrar({ nombre: 'Tercera Prueba', cedula: '1000008883' });
    expect((await listarSolicitudes(deps)).map((s) => s.nombre)).toEqual(['Segunda Prueba', 'Tercera Prueba']);
  });

  it('aprobar sin cambios: queda activa, puede entrar con su PIN y la bitácora lo anota', async () => {
    await registrar();
    const [s] = await listarSolicitudes(deps);
    const c = await aprobarSolicitud(deps, s.id, {});
    expect(c).toMatchObject({ estado: 'activa', activo: true, cargas: 0 });
    expect(await listarSolicitudes(deps)).toHaveLength(0);
    expect((await listarContratos(deps)).map((x) => x.nombre)).toEqual(['Nueva Prueba Uno']);
    expect(await listarContratistas(deps)).toEqual(['Nueva Prueba Uno']);
    const entro = await verificarLogin(db, 'nueva prueba uno', '5551', ahora);
    expect(entro.id).toBe(s.id);
    const cambios = await listarCambios(db, s.id);
    expect(cambios.map((x) => x.campo).sort()).toEqual(['aprobada', 'registro']);
    expect(cambios.find((x) => x.campo === 'aprobada')).toMatchObject({ autor: 'admin', etiqueta: 'Solicitud aprobada' });
  });

  it('aprobar con correcciones: se validan, se guardan y quedan en la bitácora; después entra', async () => {
    await registrar({ riesgo: 'I', honorario: '4.000.000', valorTotal: '36.000.000', nombre: 'Nueva  prueba UNO' });
    const [s] = await listarSolicitudes(deps);
    const c = await aprobarSolicitud(deps, s.id, { riesgo: 'III', honorario: '4.009.000', valorTotal: 36081000, correo: 'ok@ejemplo.com' });
    expect(c).toMatchObject({ riesgo: 'III', honorario: 4009000, valorTotal: 36081000, correo: 'ok@ejemplo.com', activo: true });
    const campos = (await listarCambios(db, s.id)).map((x) => x.campo);
    expect(campos).toEqual(expect.arrayContaining(['aprobada', 'riesgo', 'honorario', 'valorTotal', 'registro']));
    expect(campos).not.toContain('activo');
    expect((await verificarLogin(db, 'NUEVA PRUEBA UNO', '5551', ahora)).riesgo).toBe('III');
  });

  it('una corrección inválida no aprueba: sigue pendiente', async () => {
    await registrar();
    const [s] = await listarSolicitudes(deps);
    const e = await validacion(aprobarSolicitud(deps, s.id, { fin: '2025-01-01', riesgo: 'IX' }));
    expect(e.campos.fin).toMatch(/antes de la fecha de inicio/);
    expect(e.campos.riesgo).toBeTruthy();
    expect((await filas())[0]).toMatchObject({ estado: 'pendiente', activo: false });
    await amable(verificarLogin(db, 'Nueva Prueba Uno', '5551', ahora));
  });

  it('aprobar con un nombre o cédula que ya tiene otra cuenta falla', async () => {
    await crearContratista(db, { nombre: 'Ana Pérez Prueba', cedula: '1000000001' });
    await registrar();
    const [s] = await listarSolicitudes(deps);
    expect((await validacion(aprobarSolicitud(deps, s.id, { nombre: 'ana perez prueba' }))).campos.nombre).toBeTruthy();
    expect((await validacion(aprobarSolicitud(deps, s.id, { cedula: '1000000001' }))).campos.cedula).toBeTruthy();
  });

  it('rechazar borra la solicitud y su bitácora', async () => {
    await registrar();
    const [s] = await listarSolicitudes(deps);
    await rechazarSolicitud(deps, s.id);
    expect(await filas()).toHaveLength(0);
    expect(await db.select().from(cambiosContrato)).toHaveLength(0);
    expect((await amable(rechazarSolicitud(deps, s.id))).estado).toBe(404);
    // ya se puede registrar de nuevo con el mismo nombre y cédula
    await registrar();
  });

  it('no se puede aprobar ni rechazar una cuenta que ya está activa (rechazar nunca borra a una trabajadora)', async () => {
    const id = await crearContratista(db);
    expect((await amable(rechazarSolicitud(deps, id))).estado).toBe(404);
    expect((await amable(aprobarSolicitud(deps, id, {}))).estado).toBe(404);
    expect((await amable(detalleSolicitud(deps, id))).estado).toBe(404);
    expect(await filas()).toHaveLength(1);
    await registrar();
    const [s] = await listarSolicitudes(deps);
    await aprobarSolicitud(deps, s.id, {});
    expect((await amable(aprobarSolicitud(deps, s.id, {}))).estado).toBe(404);
  });

  it('una cuenta aprobada y luego desactivada no entra (activo sigue mandando)', async () => {
    await registrar();
    const [s] = await listarSolicitudes(deps);
    await aprobarSolicitud(deps, s.id, {});
    await actualizarContrato(deps, s.id, { activo: false });
    await amable(verificarLogin(db, 'Nueva Prueba Uno', '5551', ahora));
    expect(await listarContratistas(deps)).toEqual([]);
  });
});
