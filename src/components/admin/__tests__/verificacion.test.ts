// "Verificar con documento" en el panel: lo que se muestra (helpers puros) y el cliente de la API. Datos inventados.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiAdmin, normalizarContrato, normalizarDocumento, normalizarVerificacion, urlDocumento, type Contrato, type Solicitud,
} from "../apiAdmin";
import {
  ayudaUsarDato, contarDistintos, lineaCambio, payloadDeContrato, resumenVerificacion, solicitudActualizada,
  textoEstadoVerificacion, textoFuenteVerificacion, textoTipoDocumento, textoValorVerificacion, textoVerificada,
} from "../helpers";

function responder(status: number, cuerpo: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const contrato: Contrato = normalizarContrato({
  id: 7, nombre: "Ana Prueba Ejemplo", cedula: "1000000123", direccion: "Calle 1", telefono: "3000000000", ciudad: "Medellín",
  correo: "", numeroContrato: "2026CPSP000", objeto: "Apoyar", cargo: "Profesional", linea: "", inicio: "2026-01-01", fin: "2026-09-30",
  honorario: 7174000, valorTotal: 64566000, riesgo: "III", activo: true, verificadaEn: "2026-10-07T15:00:00.000Z", cargas: 2,
});

describe("textos de la verificación", () => {
  it("tipos de documento en palabras sencillas", () => {
    expect(textoTipoDocumento("contrato")).toBe("Contrato");
    expect(textoTipoDocumento("acta_prorroga")).toBe("Acta de prórroga o adición");
    expect(textoTipoDocumento("poliza")).toBe("Póliza");
    expect(textoTipoDocumento("desconocido")).toBe("Documento sin reconocer");
  });

  it("estados: Coincide, Distinto, Sin dato", () => {
    expect(textoEstadoVerificacion("coincide")).toBe("Coincide");
    expect(textoEstadoVerificacion("distinto")).toBe("Distinto");
    expect(textoEstadoVerificacion("sin_dato")).toBe("Sin dato");
  });

  it("valores: dinero con puntos, fechas DD/MM/AAAA, raya si no hay", () => {
    expect(textoValorVerificacion("honorario", 4009000)).toBe("$ 4.009.000");
    expect(textoValorVerificacion("valorTotal", 44099000)).toBe("$ 44.099.000");
    expect(textoValorVerificacion("fin", "2026-11-30")).toBe("30/11/2026");
    expect(textoValorVerificacion("inicio", "2026-01-01")).toBe("01/01/2026");
    expect(textoValorVerificacion("cedula", "1000001234")).toBe("1000001234");
    expect(textoValorVerificacion("nombre", null)).toBe("—");
    expect(textoValorVerificacion("nombre", "")).toBe("—");
  });

  it("de qué documento sale, y 'Verificada el DD/MM/AAAA'", () => {
    expect(textoFuenteVerificacion({ documentoId: 1, tipo: "acta_prorroga", fecha: "2026-10-07T15:00:00.000Z" })).toBe(
      "Acta de prórroga o adición, subido el 07/10/2026",
    );
    expect(textoFuenteVerificacion(null)).toBe("");
    expect(textoVerificada("2026-10-07T15:00:00.000Z")).toBe("Verificada el 07/10/2026");
    // las 11 de la noche en Bogotá ya es el día siguiente en UTC: se muestra el día de Bogotá
    expect(textoVerificada("2026-10-08T03:30:00.000Z")).toBe("Verificada el 07/10/2026");
  });

  it("resumen sobre la tabla", () => {
    const f = (estado: "coincide" | "distinto" | "sin_dato") => ({ estado });
    expect(resumenVerificacion([f("coincide"), f("sin_dato")])).toBe("Todo lo que traen los documentos coincide con la app.");
    expect(resumenVerificacion([f("sin_dato")])).toBe("Los documentos no traen datos para comparar.");
    expect(resumenVerificacion([f("distinto"), f("coincide")])).toBe("Hay 1 dato distinto.");
    expect(resumenVerificacion([f("distinto"), f("distinto")])).toBe("Hay 2 datos distintos.");
    expect(contarDistintos([f("distinto"), f("coincide"), f("distinto")])).toBe(2);
  });

  it("copiar la cédula avisa que cambia el PIN", () => {
    expect(ayudaUsarDato("cedula")).toMatch(/PIN/);
    expect(ayudaUsarDato("fin")).toBe("");
  });

  it("la bitácora cuenta la verificación como un hecho, no como un cambio de valor", () => {
    expect(lineaCambio({ campo: "verificada", etiqueta: "Verificación con documento", antes: "", despues: "Verificada" })).toBe(
      "Marcó la cuenta como verificada con los documentos",
    );
  });
});

describe("contrato y solicitud con la marca de verificada", () => {
  it("el contrato trae verificadaEn (o null) y nunca se manda al guardar", () => {
    expect(contrato.verificadaEn).toBe("2026-10-07T15:00:00.000Z");
    expect(normalizarContrato({ id: 1, nombre: "X" }).verificadaEn).toBeNull();
    const p = payloadDeContrato(contrato, { activo: false });
    expect("verificadaEn" in p).toBe(false);
    expect("id" in p).toBe(false);
    expect(p.activo).toBe(false);
  });

  it("la fila de la solicitud se pone al día con el contrato", () => {
    const s: Solicitud = {
      id: 7, nombre: "Ana", cedulaFinal4: "…0000", linea: "", numeroContrato: "", cargo: "", inicio: null, fin: null,
      honorario: null, riesgo: "I", solicitada: "2026-10-01T10:00:00.000Z",
    };
    const nueva = solicitudActualizada(s, contrato);
    expect(nueva).toMatchObject({
      id: 7, nombre: "Ana Prueba Ejemplo", cedulaFinal4: "…0123", numeroContrato: "2026CPSP000", fin: "2026-09-30",
      honorario: 7174000, riesgo: "III", solicitada: "2026-10-01T10:00:00.000Z",
    });
  });
});

describe("normalizadores de documentos y comparación", () => {
  it("documento: nunca trae la ruta del archivo y el tipo raro es 'desconocido'", () => {
    const d = normalizarDocumento({ id: 3, contratoId: 7, tipo: "otra cosa", nombreArchivo: "a.pdf", notas: ["x", 5, "y"], subido: "2026-10-07T15:00:00Z", archivo: "documentos/7/x.pdf" });
    expect(d).toEqual({ id: 3, contratoId: 7, tipo: "desconocido", nombreArchivo: "a.pdf", notas: ["x", "y"], subido: "2026-10-07T15:00:00Z" });
  });

  it("comparación: estados, valores y fuente", () => {
    const v = normalizarVerificacion({
      verificadaEn: null,
      documentos: 2,
      filas: [
        { campo: "fin", etiqueta: "Fecha de fin", actual: "2026-09-30", documento: "2026-11-30", estado: "distinto", fuente: { documentoId: 5, tipo: "acta_prorroga", fecha: "2026-10-07T15:00:00Z" } },
        { campo: "honorario", etiqueta: "Honorario mensual", actual: 4009000, documento: null, estado: "raro", fuente: null },
      ],
    });
    expect(v.documentos).toBe(2);
    expect(v.verificadaEn).toBeNull();
    expect(v.filas[0]).toMatchObject({ campo: "fin", estado: "distinto", fuente: { documentoId: 5, tipo: "acta_prorroga" } });
    expect(v.filas[1]).toMatchObject({ actual: 4009000, documento: null, estado: "sin_dato", fuente: null });
  });
});

describe("cliente de la API: documentos y verificación", () => {
  it("lista los documentos de una trabajadora", async () => {
    const f = responder(200, { ok: true, documentos: [{ id: 1, contratoId: 7, tipo: "contrato", nombreArchivo: "c.pdf", notas: [], subido: "2026-10-07T15:00:00Z" }] });
    const r = await apiAdmin.documentos(7);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("/api/admin/documentos?contratoId=7");
    expect(r[0].tipo).toBe("contrato");
  });

  it("subir manda multipart con contratoId, archivo y el texto leído en el navegador", async () => {
    const f = responder(201, { ok: true, documento: { id: 9, contratoId: 7, tipo: "poliza", nombreArchivo: "p.pdf", notas: ["n"], subido: "2026-10-07T15:00:00Z" } });
    const archivo = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "p.pdf", { type: "application/pdf" });
    const d = await apiAdmin.subirDocumento(7, archivo, "texto de la póliza");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/documentos");
    expect(init.method).toBe("POST");
    const fd = init.body as FormData;
    expect(fd.get("contratoId")).toBe("7");
    expect(fd.get("texto")).toBe("texto de la póliza");
    expect((fd.get("archivo") as File).name).toBe("p.pdf");
    expect(d).toMatchObject({ id: 9, tipo: "poliza", notas: ["n"] });
  });

  it("un 413 de la plataforma dice que el PDF pesa más de 4 MB; si el servidor explica, se muestra su mensaje", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>too large</html>", { status: 413 })));
    const archivo = new File([new Uint8Array(8)], "p.pdf");
    await expect(apiAdmin.subirDocumento(7, archivo, "")).rejects.toMatchObject({ status: 413, message: expect.stringMatching(/4 MB/) });
    responder(413, { ok: false, error: "El archivo pesa más de 4 MB. Sube un PDF más liviano." });
    await expect(apiAdmin.subirDocumento(7, archivo, "")).rejects.toMatchObject({ message: "El archivo pesa más de 4 MB. Sube un PDF más liviano." });
  });

  it("quitar, comparar, usar y marcar llaman a sus rutas", async () => {
    let f = responder(200, { ok: true });
    await apiAdmin.quitarDocumento(4);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/admin/documentos/4");
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");

    f = responder(200, { ok: true, verificacion: { verificadaEn: null, documentos: 0, filas: [] } });
    expect((await apiAdmin.verificacion(7)).filas).toEqual([]);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("/api/admin/verificacion/7");

    f = responder(200, { ok: true, contrato: { id: 7, nombre: "Ana", fin: "2026-11-30" } });
    const c = await apiAdmin.usarDelDocumento(7, "fin");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/verificacion/7/usar");
    expect(JSON.parse(init.body as string)).toEqual({ campo: "fin" });
    expect(c.fin).toBe("2026-11-30");

    f = responder(200, { ok: true, contrato: { id: 7, nombre: "Ana", verificadaEn: "2026-10-07T15:00:00Z" } });
    const m = await apiAdmin.marcarVerificada(7);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/admin/verificacion/7/marcar");
    expect(m.verificadaEn).toBe("2026-10-07T15:00:00Z");
  });

  it("el enlace para ver el PDF", () => {
    expect(urlDocumento(12)).toBe("/api/admin/documentos/12/archivo");
  });
});
