// Initialize Sentry FIRST
require("./instrument.js");
const Sentry = require("@sentry/aws-serverless");

const { RekognitionClient, IndexFacesCommand, DeleteFacesCommand, SearchFacesByImageCommand } = require("@aws-sdk/client-rekognition");
const { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb");
const crypto = require("crypto");

const rekognition = new RekognitionClient({ region: "us-east-1" });
const dynamo = new DynamoDBClient({ region: "us-east-1" });

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
};

function log(level, message, data = {}) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        module: process.env.MODULE_NAME || "registrar-empleado",
        message,
        ...data
    }));
}

exports.handler = Sentry.wrapHandler(async (event) => {
    const startTime = Date.now();
    log("INFO", "Lambda invoked", { method: event.httpMethod });

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: CORS, body: "" };
    }

    if (event.httpMethod === "GET") {
        const tipo = event.queryStringParameters?.tipo;
        const identificacion = event.queryStringParameters?.identificacion;

        if (identificacion) {
            try {
                const empleado = await dynamo.send(new GetItemCommand({
                    TableName: "biosecurity-empleados",
                    Key: { identificacion: { S: identificacion } }
                }));
                if (!empleado.Item) {
                    return { statusCode: 404, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Empleado no encontrado" }) };
                }
                return {
                    statusCode: 200, headers: CORS,
                    body: JSON.stringify({
                        codigo: 0,
                        nombre: empleado.Item.nombre?.S,
                        identificacion,
                        fecha_registro: empleado.Item.fecha_registro?.S
                    })
                };
            } catch (error) {
                log("ERROR", "Error buscando empleado", { error: error.message });
                Sentry.captureException(error);
                return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error buscando empleado" }) };
            }
        }

        if (tipo === "retirados") {
            try {
                const result = await dynamo.send(new ScanCommand({ TableName: "biosecurity-retirados" }));
                const items = (result.Items || []).map(i => ({
                    identificacion: i.identificacion?.S,
                    nombre: i.nombre?.S,
                    fecha_registro: i.fecha_registro?.S,
                    fecha_retiro: i.fecha_retiro?.S
                })).sort((a, b) => (b.fecha_retiro || "").localeCompare(a.fecha_retiro || ""));
                return { statusCode: 200, headers: CORS, body: JSON.stringify({ codigo: 0, items }) };
            } catch (error) {
                log("ERROR", "Error listando retirados", { error: error.message });
                Sentry.captureException(error);
                return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error listando retirados" }) };
            }
        }

        try {
            const result = await dynamo.send(new ScanCommand({ TableName: "biosecurity-empleados" }));
            const items = (result.Items || []).map(i => ({
                identificacion: i.identificacion?.S,
                nombre: i.nombre?.S,
                fecha_registro: i.fecha_registro?.S
            })).sort((a, b) => (b.fecha_registro || "").localeCompare(a.fecha_registro || ""));
            return { statusCode: 200, headers: CORS, body: JSON.stringify({ codigo: 0, items }) };
        } catch (error) {
            log("ERROR", "Error listando empleados", { error: error.message });
            Sentry.captureException(error);
            return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error listando empleados" }) };
        }
    }

    if (event.httpMethod === "DELETE") {
        try {
            const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || event;
            const { identificacion } = body;

            if (!identificacion) {
                return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Falta identificacion" }) };
            }

            const empleado = await dynamo.send(new GetItemCommand({
                TableName: "biosecurity-empleados",
                Key: { identificacion: { S: identificacion } }
            }));

            if (!empleado.Item) {
                return { statusCode: 404, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Empleado no encontrado" }) };
            }

            const nombre = empleado.Item.nombre?.S;
            const fecha_registro = empleado.Item.fecha_registro?.S || "";

            await dynamo.send(new PutItemCommand({
                TableName: "biosecurity-retirados",
                Item: {
                    identificacion: { S: identificacion },
                    nombre:         { S: nombre },
                    fecha_registro: { S: fecha_registro },
                    fecha_retiro:   { S: new Date().toISOString() }
                }
            }));

            const faceId = empleado.Item.face_id?.S;
            if (faceId) {
                await rekognition.send(new DeleteFacesCommand({
                    CollectionId: "coleccion2anlusoft",
                    FaceIds: [faceId]
                }));
            }

            await dynamo.send(new DeleteItemCommand({
                TableName: "biosecurity-empleados",
                Key: { identificacion: { S: identificacion } }
            }));

            log("INFO", "Empleado eliminado", { identificacion, nombre });

            return {
                statusCode: 200, headers: CORS,
                body: JSON.stringify({ codigo: 0, descripcion: `Empleado ${nombre} eliminado exitosamente` })
            };

        } catch (error) {
            log("ERROR", "Error al eliminar empleado", { error: error.message });
            Sentry.captureException(error);
            return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error al eliminar", error: error.message }) };
        }
    }

    try {
        const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || event;
        const { identificacion, nombre, foto } = body;

        if (!identificacion || !nombre || !foto) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Faltan campos: identificacion, nombre o foto" }) };
        }

        const existente = await dynamo.send(new GetItemCommand({
            TableName: "biosecurity-empleados",
            Key: { identificacion: { S: identificacion } }
        }));

        if (existente.Item) {
            return {
                statusCode: 400, headers: CORS,
                body: JSON.stringify({ codigo: 1, descripcion: `El empleado ${existente.Item.nombre?.S} ya está registrado con esta identificación` })
            };
        }

        const buffer = Buffer.from(foto.replace(/^data:image\/\w+;base64,/, ""), "base64");

        try {
            const busqueda = await rekognition.send(new SearchFacesByImageCommand({
                CollectionId: "coleccion2anlusoft",
                Image: { Bytes: buffer },
                FaceMatchThreshold: 90,
                MaxFaces: 1
            }));

            if (busqueda.FaceMatches && busqueda.FaceMatches.length > 0) {
                const idExistente = busqueda.FaceMatches[0].Face.ExternalImageId;
                const similitud = busqueda.FaceMatches[0].Similarity.toFixed(1);

                let nombreExistente = idExistente;
                let estaRetirado = false;
                try {
                    const empActivo = await dynamo.send(new GetItemCommand({
                        TableName: "biosecurity-empleados",
                        Key: { identificacion: { S: idExistente } }
                    }));
                    if (empActivo.Item) {
                        nombreExistente = empActivo.Item.nombre?.S || idExistente;
                    } else {
                        const empRetirado = await dynamo.send(new GetItemCommand({
                            TableName: "biosecurity-retirados",
                            Key: { identificacion: { S: idExistente } }
                        }));
                        if (empRetirado.Item) {
                            nombreExistente = empRetirado.Item.nombre?.S || idExistente;
                            estaRetirado = true;
                        }
                    }
                } catch(e) {}

                if (estaRetirado) {
                    const faceIdHuerfano = busqueda.FaceMatches[0].Face.FaceId;
                    try {
                        await rekognition.send(new DeleteFacesCommand({
                            CollectionId: "coleccion2anlusoft",
                            FaceIds: [faceIdHuerfano]
                        }));
                    } catch(e) {
                        log("WARN", "Error eliminando face huerfano", { error: e.message });
                    }
                } else {
                    return {
                        statusCode: 400, headers: CORS,
                        body: JSON.stringify({
                            codigo: 1,
                            descripcion: `Este rostro ya está registrado como "${nombreExistente}" (CC: ${idExistente}) con ${similitud}% de similitud.`
                        })
                    };
                }
            }
        } catch(e) {
            if (!e.message?.includes("no faces")) {
                log("WARN", "Busqueda de rostro fallo", { error: e.message });
            }
        }

        const rekResponse = await rekognition.send(new IndexFacesCommand({
            CollectionId: "coleccion2anlusoft",
            Image: { Bytes: buffer },
            ExternalImageId: identificacion,
            DetectionAttributes: ["DEFAULT"]
        }));

        if (!rekResponse.FaceRecords || rekResponse.FaceRecords.length === 0) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "No se detectó ningún rostro en la imagen" }) };
        }

        await dynamo.send(new PutItemCommand({
            TableName: "biosecurity-empleados",
            Item: {
                identificacion: { S: identificacion },
                nombre:         { S: nombre },
                fecha_registro: { S: new Date().toISOString() },
                face_id:        { S: rekResponse.FaceRecords[0].Face.FaceId }
            }
        }));

        log("INFO", "Empleado registrado", { identificacion, nombre, duration_ms: Date.now() - startTime });

        return {
            statusCode: 200, headers: CORS,
            body: JSON.stringify({ codigo: 0, descripcion: "Empleado registrado exitosamente", nombre, identificacion })
        };

    } catch (error) {
        log("ERROR", "Error en registro", { error: error.message });
        Sentry.captureException(error);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error en registro", error: error.message }) };
    }
});
