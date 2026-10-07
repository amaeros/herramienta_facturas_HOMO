import { afterEach, describe, expect, it, vi } from "vitest";
import { alVencerSesion, AdminError, apiAdmin, MSG_SESION_ADMIN_VENCIDA, urlFactura, urlPlanilla } from "../apiAdmin";

function responder(status: number, cuerpo: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("cliente de la API de admin", () => {
  it("un 401 normal avisa a la pantalla (sesión vencida)", async () => {
    responder(401, { ok: false, error: "no" });
    const aviso = vi.fn();
    const baja = alVencerSesion(aviso);
    await expect(apiAdmin.contratos()).rejects.toMatchObject({ status: 401, message: MSG_SESION_ADMIN_VENCIDA });
    expect(aviso).toHaveBeenCalledTimes(1);
    baja();
  });

  it("el 401 del login es 'contraseña incorrecta', no sesión vencida", async () => {
    responder(401, { ok: false, error: "Contraseña incorrecta." });
    const aviso = vi.fn();
    const baja = alVencerSesion(aviso);
    await expect(apiAdmin.entrar("x")).rejects.toMatchObject({ message: "Contraseña incorrecta." });
    expect(aviso).not.toHaveBeenCalled();
    baja();
  });

  it("hayEntrada: false sin sesión, true con sesión", async () => {
    responder(401, { ok: false });
    expect(await apiAdmin.hayEntrada()).toBe(false);
    responder(200, { ok: true, admin: true });
    expect(await apiAdmin.hayEntrada()).toBe(true);
  });

  it("errores del servidor llegan con su mensaje y campo", async () => {
    responder(400, { ok: false, error: "La cédula ya existe.", campos: { cedula: "La cédula ya existe." } });
    const e = await apiAdmin.crearContrato({ nombre: "x" } as never).catch((x) => x);
    expect(e).toBeInstanceOf(AdminError);
    expect(e.message).toBe("La cédula ya existe.");
    expect(e.campos).toEqual({ cedula: "La cédula ya existe." });
  });

  it("sin conexión: mensaje amable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fail"); }));
    await expect(apiAdmin.parametros()).rejects.toMatchObject({ status: 0 });
  });

  it("cargas: pide el mes y normaliza", async () => {
    const f = responder(200, {
      ok: true,
      cargas: [{ id: 1, contratoId: 2, nombre: "Ana", mes: "2026-09", estado: "REVISAR", emoji: "🟡", valor: 100, aprobado: true, tienePlanilla: true, adicionales: [{ numero: "9", mes: "2026-09", valor: 5, tieneArchivo: true }] }],
      faltan: [{ contratoId: 3, nombre: "Luz" }],
    });
    const r = await apiAdmin.cargas("2026-09");
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("/api/admin/cargas?mes=2026-09");
    expect(r.cargas[0].estado).toBe("REVISAR");
    expect(r.cargas[0].aprobado).toBe(true);
    expect(r.cargas[0].adicionales[0].tieneArchivo).toBe(true);
    expect(r.cargas[0].tienePlanilla).toBe(true);
    expect(r.faltan).toEqual([{ contratoId: 3, nombre: "Luz" }]);
  });

  it("PATCH y DELETE llevan el cuerpo de la spec", async () => {
    const f = responder(200, { ok: true, carga: { id: 5, estado: "OK" } });
    await apiAdmin.actualizarCarga(5, { aprobado: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/cargas/5");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ aprobado: true });

    const g = responder(200, { ok: true });
    await apiAdmin.borrarContrato(9, "Ana Prueba");
    const [u2, i2] = g.mock.calls[0] as unknown as [string, RequestInit];
    expect(u2).toBe("/api/admin/contratos/9");
    expect(i2.method).toBe("DELETE");
    expect(JSON.parse(i2.body as string)).toEqual({ confirmar: "Ana Prueba" });
  });

  it("importar manda multipart con archivo y aplicar", async () => {
    const f = responder(200, { ok: true, crear: [{ nombre: "N", cedulaFinal4: "…1234" }], actualizar: [], sinCambios: 2, errores: [] });
    const archivo = new File([new Uint8Array([1, 2, 3])], "control.xlsx");
    const r = await apiAdmin.importar(archivo, false);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    const fd = init.body as FormData;
    expect(fd.get("aplicar")).toBe("0");
    expect((fd.get("archivo") as File).name).toBe("control.xlsx");
    expect(r.crear[0].cedulaFinal4).toBe("…1234");
    expect(r.sinCambios).toBe(2);
  });

  it("enlaces de descarga", () => {
    expect(urlFactura(12)).toBe("/api/factura/12");
    expect(urlPlanilla(12, 2)).toBe("/api/admin/planilla/12?n=2");
  });
});
