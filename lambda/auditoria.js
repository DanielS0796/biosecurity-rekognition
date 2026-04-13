const { DynamoDBClient, ScanCommand, GetItemCommand } = require("@aws-sdk/client-dynamodb");

const dynamo = new DynamoDBClient({ region: "us-east-1" });

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,OPTIONS"
};

exports.handler = async (event) => {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: CORS, body: "" };
    }

    try {
        const response = await dynamo.send(new ScanCommand({
            TableName: "biosecurity-accesos"
        }));

        const items = response.Items || [];

        // Agrupar por identificacion y fecha
        const registros = {};

        for (const item of items) {
            const id        = item.identificacion?.S || "DESCONOCIDO";
            const fechaHora = item.fecha_hora?.S || "";
            const fecha     = fechaHora.split("T")[0];
            const tipo      = item.tipo_acceso?.S || item.resultado?.S || "";
            const resultado = item.resultado?.S || "";
            const nombreReg = item.nombre?.S || "";
            const key       = `${id}_${fecha}`;

            if (id === "DESCONOCIDO") continue;
            if (resultado === "FALLIDO") continue;

            if (!registros[key]) {
                registros[key] = {
                    identificacion: id,
                    fecha,
                    nombre:       nombreReg || id,
                    hora_entrada: "",
                    hora_salida:  ""
                };
            }

            // Actualizar nombre si el registro lo tiene
            if (nombreReg && nombreReg !== id && nombreReg !== "DESCONOCIDO") {
                registros[key].nombre = nombreReg;
            }

            if (tipo === "ENTRADA") {
                registros[key].hora_entrada = fechaHora;
            } else if (tipo === "SALIDA") {
                registros[key].hora_salida = fechaHora;
            } else if (tipo === "EXITOSO" && !registros[key].hora_entrada) {
                registros[key].hora_entrada = fechaHora;
            }
        }

        const listaRegistros = Object.values(registros);

        // Si el nombre aún es igual a la identificacion, buscar en empleados
        for (const reg of listaRegistros) {
            if (!reg.nombre || reg.nombre === reg.identificacion) {
                try {
                    const emp = await dynamo.send(new GetItemCommand({
                        TableName: "biosecurity-empleados",
                        Key: { identificacion: { S: reg.identificacion } }
                    }));
                    if (emp.Item?.nombre?.S) {
                        reg.nombre = emp.Item.nombre.S;
                    }
                } catch(e) {
                    // empleado eliminado, usar identificacion
                }
            }
        }

        // Ordenar por fecha descendente
        listaRegistros.sort((a, b) => {
            const fa = a.hora_entrada || a.fecha;
            const fb = b.hora_entrada || b.fecha;
            return fb.localeCompare(fa);
        });

        const format = event.queryStringParameters?.format;

        if (format === "json") {
            return {
                statusCode: 200,
                headers: { ...CORS, "Content-Type": "application/json" },
                body: JSON.stringify({ items: listaRegistros })
            };
        }

        // CSV
        const headers = ["Identificacion", "Nombre", "Fecha", "Hora Entrada", "Hora Salida"];
        const rows = listaRegistros.map(r => [
            r.identificacion,
            r.nombre,
            r.fecha,
            r.hora_entrada ? new Date(r.hora_entrada).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "",
            r.hora_salida  ? new Date(r.hora_salida).toLocaleTimeString("es-CO",  { hour: "2-digit", minute: "2-digit" }) : "Sin salida"
        ]);

        const csv = [headers, ...rows]
            .map(row => row.map(v => `"${v}"`).join(","))
            .join("\n");

        return {
            statusCode: 200,
            headers: {
                ...CORS,
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename=accesos_${new Date().toISOString().split("T")[0]}.csv`
            },
            body: "\uFEFF" + csv
        };

    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            headers: CORS,
            body: JSON.stringify({ codigo: 1, descripcion: "Error generando reporte", error: error.message })
        };
    }
};
