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

exports.handler = async (event) => {

    // ── OPTIONS ──
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: CORS, body: "" };
    }

    // ── GET ──
    if (event.httpMethod === "GET") {
        const tipo = event.queryStringParameters?.tipo;
        const identificacion = event.queryStringParameters?.identificacion;

        // Buscar empleado por ID
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
                return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error buscando empleado" }) };
            }
        }

        // Listar retirados
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
                return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error listando retirados" }) };
            }
        }

        // Listar activos (default)
        try {
            const result = await dynamo.send(new ScanCommand({ TableName: "biosecurity-empleados" }));
            const items = (result.Items || []).map(i => ({
                identificacion: i.identificacion?.S,
                nombre: i.nombre?.S,
                fecha_registro: i.fecha_registro?.S
            })).sort((a, b) => (b.fecha_registro || "").localeCompare(a.fecha_registro || ""));
            return { statusCode: 200, headers: CORS, body: JSON.stringify({ codigo: 0, items }) };
        } catch (error) {
            return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error listando empleados" }) };
        }
    }

    // ── DELETE ──
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

            // Guardar en historial de retirados
            await dynamo.send(new PutItemCommand({
                TableName: "biosecurity-retirados",
                Item: {
                    identificacion: { S: identificacion },
                    nombre:         { S: nombre },
                    fecha_registro: { S: fecha_registro },
                    fecha_retiro:   { S: new Date().toISOString() }
                }
            }));

            // Eliminar de Rekognition
            const faceId = empleado.Item.face_id?.S;
            if (faceId) {
                await rekognition.send(new DeleteFacesCommand({
                    CollectionId: "coleccion2anlusoft",
                    FaceIds: [faceId]
                }));
            }

            // Eliminar de DynamoDB
            await dynamo.send(new DeleteItemCommand({
                TableName: "biosecurity-empleados",
                Key: { identificacion: { S: identificacion } }
            }));

            return {
                statusCode: 200, headers: CORS,
                body: JSON.stringify({ codigo: 0, descripcion: `Empleado ${nombre} eliminado exitosamente` })
            };

        } catch (error) {
            console.log(error);
            return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error al eliminar", error: error.message }) };
        }
    }

    // ── POST ──
    try {
        const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || event;
        const { identificacion, nombre, foto } = body;

        if (!identificacion || !nombre || !foto) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Faltan campos: identificacion, nombre o foto" }) };
        }

        // Verificar si la cédula ya existe
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

        // Verificar si el ROSTRO ya existe en la colección (evita duplicados biométricos)
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

                // Buscar nombre del empleado existente
                let nombreExistente = idExistente;
                try {
                    const empExistente = await dynamo.send(new GetItemCommand({
                        TableName: "biosecurity-empleados",
                        Key: { identificacion: { S: idExistente } }
                    }));
                    nombreExistente = empExistente.Item?.nombre?.S || idExistente;
                } catch(e) {}

                return {
                    statusCode: 400, headers: CORS,
                    body: JSON.stringify({
                        codigo: 1,
                        descripcion: `Este rostro ya está registrado como "${nombreExistente}" (CC: ${idExistente}) con ${similitud}% de similitud. No se puede registrar el mismo rostro con datos diferentes.`
                    })
                };
            }
        } catch(e) {
            // Si no encuentra rostros la búsqueda lanza error — continuar
            if (!e.message?.includes("no faces")) {
                console.log("Búsqueda de rostro:", e.message);
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

        return {
            statusCode: 200, headers: CORS,
            body: JSON.stringify({ codigo: 0, descripcion: "Empleado registrado exitosamente", nombre, identificacion })
        };

    } catch (error) {
        console.log(error);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error en registro", error: error.message }) };
    }
};
