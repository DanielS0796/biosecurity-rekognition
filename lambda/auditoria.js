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
        // Scan completo con paginación
        let items = [];
        let lastKey = undefined;
        do {
            const params = { TableName: "biosecurity-accesos" };
            if (lastKey) params.ExclusiveStartKey = lastKey;
            const response = await dynamo.send(new ScanCommand(params));
            items = items.concat(response.Items || []);
            lastKey = response.LastEvaluatedKey;
        } while (lastKey);

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
                    nombre: nombreReg || id,
                    hora_entrada: "",
                    hora_salida: ""
                };
            }

            if (nombreReg && nombreReg !== id) {
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

        // Buscar nombres faltantes en empleados
        for (const reg of listaRegistros) {
            if (!reg.nombre || reg.nombre === reg.identificacion) {
                try {
                    const emp = await dynamo.send(new GetItemCommand({
                        TableName: "biosecurity-empleados",
                        Key: { identificacion: { S: reg.identificacion } }
                    }));
                    if (emp.Item?.nombre?.S) reg.nombre = emp.Item.nombre.S;
                } catch(e) {}
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
            // En pantalla mostrar los 50 más recientes
            return {
                statusCode: 200,
                headers: { ...CORS, "Content-Type": "application/json" },
                body: JSON.stringify({ items: listaRegistros.slice(0, 50), total: listaRegistros.length })
            };
        }

        // CSV completo sin límite
        const headers = ["Identificacion", "Nombre", "Fecha", "Hora Entrada", "Hora Salida"];
        const rows = listaRegistros.map(r => [
            r.identificacion,
            r.nombre,
            r.fecha,
            r.hora_entrada ? new Date(r.hora_entrada).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "",
            r.hora_salida  ? new Date(r.hora_salida).toLocaleTimeString("es-CO",  { hour: "2-digit", minute: "2-digit" }) : "Sin salida"
        ]);
        const csv = [headers, ...rows].map(row => row.map(v => `"${v}"`).join(",")).join("\n");

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
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error en auditoría", error: error.message }) };
    }
};
