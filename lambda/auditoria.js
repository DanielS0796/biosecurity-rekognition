// Initialize Sentry FIRST
require("./instrument.js");
const Sentry = require("@sentry/aws-serverless");

const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");

const dynamo = new DynamoDBClient({ region: "us-east-1" });

// Los accesos se guardan en UTC, pero una jornada laboral se vive en hora
// local. En Colombia (UTC-5) un turno de 14:00 a 20:00 cruza la medianoche
// UTC, así que agrupar por la fecha del ISO parte el registro en dos días y
// la salida nunca encuentra su entrada. Todo el agrupamiento y el filtrado
// de este módulo usa la fecha local.
const ZONA = process.env.ZONA_HORARIA || "America/Bogota";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,OPTIONS"
};

function log(level, message, data = {}) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        module: process.env.MODULE_NAME || "auditoria",
        message,
        ...data
    }));
}

// "2026-10-07T01:30:00Z" -> "2026-10-06" en Bogotá
const fmtFecha = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit",
});
const fmtHora = new Intl.DateTimeFormat("es-CO", {
    timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false,
});

function fechaLocal(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : fmtFecha.format(d);
}

function horaLocal(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : fmtHora.format(d);
}

// Desplaza una fecha YYYY-MM-DD en días, para dar margen al filtro de UTC.
function correrDias(fecha, dias) {
    const d = new Date(`${fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().split("T")[0];
}

const esFecha = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function leerAccesos({ desde, hasta }) {
    // El rango se amplía un día por lado: el filtro del Scan trabaja sobre
    // fecha_hora en UTC y lo que buscamos son días locales, que caen a
    // caballo de dos días UTC. El recorte exacto se hace después, en local.
    let filtro, valores;
    if (desde && hasta) {
        filtro = "fecha_hora BETWEEN :ini AND :fin";
        valores = {
            ":ini": { S: `${correrDias(desde, -1)}T00:00:00` },
            ":fin": { S: `${correrDias(hasta, 1)}T23:59:59Z` },
        };
    }

    let items = [];
    let lastKey;
    do {
        const params = { TableName: "biosecurity-accesos" };
        if (filtro) {
            params.FilterExpression = filtro;
            params.ExpressionAttributeValues = valores;
        }
        if (lastKey) params.ExclusiveStartKey = lastKey;
        const r = await dynamo.send(new ScanCommand(params));
        items = items.concat(r.Items || []);
        lastKey = r.LastEvaluatedKey;
    } while (lastKey);

    return items;
}

function agrupar(items) {
    const registros = {};

    for (const item of items) {
        const id = item.identificacion?.S || "DESCONOCIDO";
        const fechaHora = item.fecha_hora?.S || "";
        const tipo = item.tipo_acceso?.S || item.resultado?.S || "";
        const resultado = item.resultado?.S || "";
        const nombreReg = item.nombre?.S || "";

        if (id === "DESCONOCIDO") continue;
        if (resultado === "FALLIDO" || resultado === "RECHAZADO") continue;

        const fecha = fechaLocal(fechaHora);
        if (!fecha) continue;

        const key = `${id}_${fecha}`;

        if (!registros[key]) {
            registros[key] = {
                identificacion: id,
                fecha,
                nombre: nombreReg || id,
                hora_entrada: "",
                hora_salida: "",
                metodo: item.metodo_validacion?.S || "",
            };
        }

        if (nombreReg && nombreReg !== id) registros[key].nombre = nombreReg;
        if (item.metodo_validacion?.S) registros[key].metodo = item.metodo_validacion.S;

        if (tipo === "ENTRADA") {
            // Con varias entradas en el día vale la primera.
            if (!registros[key].hora_entrada || fechaHora < registros[key].hora_entrada) {
                registros[key].hora_entrada = fechaHora;
            }
        } else if (tipo === "SALIDA") {
            // Y de las salidas, la última.
            if (!registros[key].hora_salida || fechaHora > registros[key].hora_salida) {
                registros[key].hora_salida = fechaHora;
            }
        } else if (tipo === "EXITOSO" && !registros[key].hora_entrada) {
            registros[key].hora_entrada = fechaHora;
        }
    }

    return Object.values(registros);
}

/**
 * Completa nombre y vínculo institucional desde el padrón de personas.
 *
 * Antes se hacía un GetItem por cada registro sin nombre, y solo contra
 * empleados. Ahora se recorren las dos tablas una vez: hacen falta todos
 * los vínculos, no solo los de quienes llegaron sin nombre, y de paso
 * quien ya se retiró deja de aparecer en el reporte con la cédula en vez
 * del nombre. Son dos tablas pequeñas, un Scan cada una.
 */
async function completarDatosPersonales(registros) {
    const padron = {};

    for (const tabla of ["biosecurity-empleados", "biosecurity-retirados"]) {
        try {
            const r = await dynamo.send(new ScanCommand({
                TableName: tabla,
                ProjectionExpression: "identificacion, nombre, tipo_persona",
            }));
            for (const i of r.Items || []) {
                const id = i.identificacion?.S;
                if (!id) continue;
                // Los activos mandan sobre los retirados si por alguna
                // razón alguien estuviera en las dos.
                if (padron[id] && tabla.endsWith("retirados")) continue;
                padron[id] = {
                    nombre: i.nombre?.S || "",
                    tipo: i.tipo_persona?.S || "",
                };
            }
        } catch (e) {
            log("WARN", "No se pudo leer el padrón", { tabla, error: e.message });
        }
    }

    for (const r of registros) {
        const p = padron[r.identificacion];
        if (!p) continue;
        if (p.nombre && (!r.nombre || r.nombre === r.identificacion)) r.nombre = p.nombre;
        r.tipo_persona = p.tipo;
    }
}

function aFilas(registros) {
    return registros.map(r => ({
        identificacion: r.identificacion,
        nombre: r.nombre,
        // Vacío en quienes se registraron antes de que existiera la
        // categoría; no se les supone una.
        tipo_persona: r.tipo_persona || "",
        fecha: r.fecha,
        hora_entrada: horaLocal(r.hora_entrada),
        hora_salida: horaLocal(r.hora_salida),
        metodo: r.metodo || "",
    }));
}

exports.handler = Sentry.wrapHandler(async (event) => {
    const startTime = Date.now();
    const q = event.queryStringParameters || {};
    log("INFO", "Lambda invoked", { method: event.httpMethod, desde: q.desde, hasta: q.hasta });

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: CORS, body: "" };
    }

    try {
        const desde = esFecha(q.desde) ? q.desde : null;
        const hasta = esFecha(q.hasta) ? q.hasta : null;

        const items = await leerAccesos({ desde, hasta });
        let registros = agrupar(items);

        // Recorte exacto por día local, ya sin el margen del Scan.
        if (desde) registros = registros.filter(r => r.fecha >= desde);
        if (hasta) registros = registros.filter(r => r.fecha <= hasta);

        await completarDatosPersonales(registros);

        registros.sort((a, b) => {
            const fa = a.hora_entrada || `${a.fecha}T00:00:00`;
            const fb = b.hora_entrada || `${b.fecha}T00:00:00`;
            return fb.localeCompare(fa);
        });

        log("INFO", "Auditoria completada", {
            escaneados: items.length,
            registros: registros.length,
            desde, hasta,
            duration_ms: Date.now() - startTime,
        });

        const filas = aFilas(registros);

        if (q.format === "json") {
            return {
                statusCode: 200,
                headers: { ...CORS, "Content-Type": "application/json" },
                body: JSON.stringify({ items: filas, total: filas.length, desde, hasta }),
            };
        }

        // CSV con punto y coma: es el separador que espera Excel en
        // configuración regional de español, y con coma mete la fila
        // completa en una sola columna.
        const encabezados = ["Identificacion", "Nombre", "Vinculo", "Fecha", "Hora Entrada", "Hora Salida", "Metodo"];
        const lineas = [
            encabezados,
            ...filas.map(f => [
                f.identificacion, f.nombre, f.tipo_persona, f.fecha,
                f.hora_entrada, f.hora_salida || "Sin salida", f.metodo,
            ]),
        ].map(fila => fila.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";"));

        return {
            statusCode: 200,
            headers: {
                ...CORS,
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename=accesos_${new Date().toISOString().split("T")[0]}.csv`,
            },
            body: "﻿" + lineas.join("\r\n"),
        };

    } catch (error) {
        log("ERROR", "Error en auditoria", { error: error.message });
        Sentry.captureException(error);
        return {
            statusCode: 500,
            headers: CORS,
            body: JSON.stringify({ codigo: 1, descripcion: "Error en auditoría" }),
        };
    }
});
