/**
 * Liveness Detection real con AWS Rekognition Face Liveness.
 *
 * Flujo correcto (el que impide que una foto pase la validación):
 *
 *   1. POST /liveness-init  -> CreateFaceLivenessSession, devuelve session_id
 *   2. El navegador usa el componente FaceLivenessDetector de Amplify, que
 *      transmite VIDEO EN VIVO por WebSocket directo a Rekognition y ejecuta
 *      los desafíos (mover el rostro al óvalo + secuencia de destellos).
 *   3. POST /liveness-result -> GetFaceLivenessSessionResults.
 *      Rekognition devuelve Confidence + ReferenceImage, un frame que AWS
 *      extrajo del video que él mismo verificó.
 *
 * Reglas de seguridad que sostienen todo esto:
 *
 *   - El endpoint de resultado NO acepta imágenes del cliente. Solo un
 *     session_id. La imagen con la que se indexa o se busca el rostro es
 *     SIEMPRE la ReferenceImage que produce Rekognition. Si se aceptara una
 *     imagen del navegador, alguien podría pasar el liveness con su cara y
 *     después enviar la foto de otra persona.
 *   - Cada sesión se consume una sola vez (transición de estado atómica en
 *     DynamoDB), así que un session_id ya usado no se puede reproducir.
 *   - El propósito (registro o validación) y la identificación se fijan al
 *     crear la sesión, no al cerrarla.
 */

const {
    RekognitionClient,
    CreateFaceLivenessSessionCommand,
    GetFaceLivenessSessionResultsCommand,
    SearchFacesByImageCommand,
    IndexFacesCommand,
    DeleteFacesCommand,
} = require("@aws-sdk/client-rekognition");
const {
    DynamoDBClient,
    PutItemCommand,
    GetItemCommand,
    UpdateItemCommand,
    QueryCommand,
} = require("@aws-sdk/client-dynamodb");
const crypto = require("crypto");

const rekognition = new RekognitionClient({ region: process.env.AWS_REGION || "us-east-1" });
const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });

const TABLE_LIVENESS = process.env.TABLE_LIVENESS || "biosecurity-liveness-sessions";
const TABLE_EMPLEADOS = process.env.TABLE_EMPLEADOS || "biosecurity-empleados";
const TABLE_RETIRADOS = process.env.TABLE_RETIRADOS || "biosecurity-retirados";
const TABLE_ACCESOS = process.env.TABLE_ACCESOS || "biosecurity-accesos";
const COLLECTION_ID = process.env.COLLECTION_ID || "coleccion2anlusoft";
const BUCKET_AUDITORIA = process.env.BUCKET_AUDITORIA || "";

// Confianza mínima de liveness (0-100). Es el score que dice si había una
// persona real frente a la cámara. 85 es el punto de equilibrio que recomienda
// AWS; subirlo endurece el control a costa de más reintentos legítimos.
const UMBRAL_LIVENESS = Number(process.env.UMBRAL_LIVENESS || 85);
// Similitud mínima para considerar que dos rostros son la misma persona.
const UMBRAL_SIMILITUD = Number(process.env.UMBRAL_SIMILITUD || 95);
// Similitud usada al registrar, para detectar que el rostro ya existe.
const UMBRAL_DUPLICADO = Number(process.env.UMBRAL_DUPLICADO || 90);

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function log(level, message, data = {}) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        module: process.env.MODULE_NAME || "liveness-detection",
        message,
        ...data,
    }));
}

function responder(statusCode, payload) {
    return { statusCode, headers: CORS, body: JSON.stringify(payload) };
}

function parseBody(event) {
    if (!event.body) return {};
    try {
        return typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    } catch {
        return {};
    }
}

/* ────────────────────────────────────────────────────────────
 * 1. Crear la sesión de liveness
 * ──────────────────────────────────────────────────────────── */
async function iniciarLiveness(event) {
    const body = parseBody(event);
    const proposito = body.proposito === "registro" ? "registro" : "validacion";
    const identificacion = (body.identificacion || "").trim();
    const nombre = (body.nombre || "").trim();

    if (proposito === "registro") {
        if (!identificacion || !nombre) {
            return responder(400, {
                codigo: 1,
                descripcion: "Para registrar se necesitan identificación y nombre",
            });
        }

        // Falla rápido: no tiene sentido hacer pasar a la persona por el escaneo
        // si la cédula ya está tomada.
        const existente = await dynamo.send(new GetItemCommand({
            TableName: TABLE_EMPLEADOS,
            Key: { identificacion: { S: identificacion } },
        }));
        if (existente.Item) {
            return responder(400, {
                codigo: 1,
                descripcion: `El empleado ${existente.Item.nombre?.S} ya está registrado con esta identificación`,
            });
        }
    }

    const respuesta = await rekognition.send(new CreateFaceLivenessSessionCommand({
        Settings: { AuditImagesLimit: 1 },
    }));

    const sessionId = respuesta.SessionId;
    const ahora = Math.floor(Date.now() / 1000);

    await dynamo.send(new PutItemCommand({
        TableName: TABLE_LIVENESS,
        Item: {
            session_id: { S: sessionId },
            proposito: { S: proposito },
            identificacion: { S: identificacion || "-" },
            nombre: { S: nombre || "-" },
            estado: { S: "pendiente" },
            created_at: { N: String(ahora) },
            expires_at: { N: String(ahora + 600) },
        },
    }));

    log("INFO", "Sesión de liveness creada", { sessionId, proposito, identificacion });

    return responder(200, { codigo: 0, session_id: sessionId, proposito });
}

/* ────────────────────────────────────────────────────────────
 * 2. Cerrar la sesión y actuar sobre el resultado
 * ──────────────────────────────────────────────────────────── */
async function procesarResultado(event) {
    const body = parseBody(event);
    const sessionId = (body.session_id || "").trim();

    if (!sessionId) {
        return responder(400, { codigo: 1, descripcion: "Falta session_id" });
    }

    const sesion = await dynamo.send(new GetItemCommand({
        TableName: TABLE_LIVENESS,
        Key: { session_id: { S: sessionId } },
    }));

    if (!sesion.Item) {
        log("WARN", "Sesión de liveness inexistente o expirada", { sessionId });
        return responder(401, { codigo: 1, descripcion: "Sesión inválida o expirada" });
    }

    const proposito = sesion.Item.proposito?.S || "validacion";
    const identificacionSesion = sesion.Item.identificacion?.S || "";
    const nombreSesion = sesion.Item.nombre?.S || "";

    // Anti-replay: solo una transición pendiente -> procesando puede ganar.
    // Si dos peticiones llegan con el mismo session_id, la segunda falla aquí.
    try {
        await dynamo.send(new UpdateItemCommand({
            TableName: TABLE_LIVENESS,
            Key: { session_id: { S: sessionId } },
            UpdateExpression: "SET #estado = :procesando",
            ConditionExpression: "#estado = :pendiente",
            ExpressionAttributeNames: { "#estado": "estado" },
            ExpressionAttributeValues: {
                ":procesando": { S: "procesando" },
                ":pendiente": { S: "pendiente" },
            },
        }));
    } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
            log("WARN", "Intento de reutilizar una sesión de liveness", {
                sessionId,
                estado: sesion.Item.estado?.S,
            });
            return responder(409, {
                codigo: 1,
                descripcion: "Esta sesión ya fue utilizada. Inicie un escaneo nuevo.",
            });
        }
        throw error;
    }

    // Aquí está el corazón del asunto: Rekognition nos dice si lo que vio por
    // la cámara era una persona real, y nos entrega el frame que él extrajo.
    const resultado = await rekognition.send(new GetFaceLivenessSessionResultsCommand({
        SessionId: sessionId,
    }));

    const estadoSesion = resultado.Status;
    const confianza = resultado.Confidence ?? 0;

    log("INFO", "Resultado de liveness recibido", {
        sessionId,
        status: estadoSesion,
        confidence: confianza,
    });

    if (estadoSesion !== "SUCCEEDED") {
        await marcarSesion(sessionId, "fallida");
        const motivos = {
            CREATED: "El escaneo no se completó. Intente de nuevo.",
            IN_PROGRESS: "El escaneo aún está en proceso. Espere un momento.",
            FAILED: "El escaneo falló. Asegúrese de tener buena luz y seguir las instrucciones en pantalla.",
            EXPIRED: "La sesión expiró. Inicie un escaneo nuevo.",
        };
        return responder(401, {
            codigo: 1,
            descripcion: motivos[estadoSesion] || "El escaneo no pudo completarse",
            liveness_status: estadoSesion,
        });
    }

    if (confianza < UMBRAL_LIVENESS) {
        await marcarSesion(sessionId, "rechazada");
        log("WARN", "Liveness rechazado por baja confianza", { sessionId, confianza });
        return responder(401, {
            codigo: 1,
            descripcion: "No se pudo confirmar que fuera una persona real frente a la cámara",
            confianza_liveness: Number(confianza.toFixed(2)),
        });
    }

    const referenceBytes = resultado.ReferenceImage?.Bytes;
    if (!referenceBytes) {
        await marcarSesion(sessionId, "fallida");
        log("ERROR", "Liveness exitoso pero sin imagen de referencia", { sessionId });
        return responder(500, {
            codigo: 1,
            descripcion: "El escaneo no devolvió imagen de referencia",
        });
    }

    const imagen = Buffer.from(referenceBytes);

    // Deja rastro de la imagen que realmente se usó, para auditoría.
    await guardarEvidencia(sessionId, proposito, imagen);

    if (proposito === "registro") {
        return await registrarEmpleado({
            sessionId,
            identificacion: identificacionSesion,
            nombre: nombreSesion,
            imagen,
            confianza,
        });
    }

    return await validarAcceso({ sessionId, imagen, confianza });
}

/* ────────────────────────────────────────────────────────────
 * Registro: indexa la ReferenceImage de AWS, nunca una foto del cliente
 * ──────────────────────────────────────────────────────────── */
async function registrarEmpleado({ sessionId, identificacion, nombre, imagen, confianza }) {
    // Revalida la cédula: pudo registrarse alguien más mientras duraba el escaneo.
    const existente = await dynamo.send(new GetItemCommand({
        TableName: TABLE_EMPLEADOS,
        Key: { identificacion: { S: identificacion } },
    }));
    if (existente.Item) {
        await marcarSesion(sessionId, "rechazada");
        return responder(400, {
            codigo: 1,
            descripcion: `El empleado ${existente.Item.nombre?.S} ya está registrado con esta identificación`,
        });
    }

    // ¿Este rostro ya está en la colección con otra cédula?
    try {
        const busqueda = await rekognition.send(new SearchFacesByImageCommand({
            CollectionId: COLLECTION_ID,
            Image: { Bytes: imagen },
            FaceMatchThreshold: UMBRAL_DUPLICADO,
            MaxFaces: 1,
        }));

        const match = busqueda.FaceMatches?.[0];
        if (match?.Face?.ExternalImageId) {
            const idExistente = match.Face.ExternalImageId;
            const similitud = match.Similarity.toFixed(1);

            const activo = await dynamo.send(new GetItemCommand({
                TableName: TABLE_EMPLEADOS,
                Key: { identificacion: { S: idExistente } },
            }));

            if (activo.Item) {
                await marcarSesion(sessionId, "rechazada");
                return responder(400, {
                    codigo: 1,
                    descripcion: `Este rostro ya está registrado como "${activo.Item.nombre?.S || idExistente}" (CC: ${idExistente}) con ${similitud}% de similitud.`,
                });
            }

            // Rostro huérfano de alguien ya retirado: se limpia y se sigue.
            const retirado = await dynamo.send(new GetItemCommand({
                TableName: TABLE_RETIRADOS,
                Key: { identificacion: { S: idExistente } },
            }));
            if (retirado.Item) {
                try {
                    await rekognition.send(new DeleteFacesCommand({
                        CollectionId: COLLECTION_ID,
                        FaceIds: [match.Face.FaceId],
                    }));
                    log("INFO", "Rostro huérfano de retirado eliminado", { idExistente });
                } catch (error) {
                    log("WARN", "No se pudo eliminar rostro huérfano", { error: error.message });
                }
            }
        }
    } catch (error) {
        if (!/no faces/i.test(error.message || "")) {
            log("WARN", "Búsqueda de duplicados falló", { error: error.message });
        }
    }

    const indexado = await rekognition.send(new IndexFacesCommand({
        CollectionId: COLLECTION_ID,
        Image: { Bytes: imagen },
        ExternalImageId: identificacion,
        DetectionAttributes: ["DEFAULT"],
    }));

    const faceRecord = indexado.FaceRecords?.[0];
    if (!faceRecord) {
        await marcarSesion(sessionId, "fallida");
        return responder(400, {
            codigo: 1,
            descripcion: "No se detectó un rostro utilizable en el escaneo",
        });
    }

    await dynamo.send(new PutItemCommand({
        TableName: TABLE_EMPLEADOS,
        Item: {
            identificacion: { S: identificacion },
            nombre: { S: nombre },
            fecha_registro: { S: new Date().toISOString() },
            face_id: { S: faceRecord.Face.FaceId },
            metodo_registro: { S: "liveness" },
            liveness_session_id: { S: sessionId },
            liveness_confianza: { N: confianza.toFixed(2) },
        },
    }));

    await marcarSesion(sessionId, "consumida");

    log("INFO", "Empleado registrado con liveness", {
        identificacion,
        nombre,
        confianza: confianza.toFixed(2),
    });

    return responder(200, {
        codigo: 0,
        descripcion: "Empleado registrado exitosamente con verificación de persona viva",
        identificacion,
        nombre,
        confianza_liveness: Number(confianza.toFixed(2)),
    });
}

/* ────────────────────────────────────────────────────────────
 * Validación de acceso: busca la ReferenceImage en la colección
 * ──────────────────────────────────────────────────────────── */
async function validarAcceso({ sessionId, imagen, confianza }) {
    const fechaHora = new Date().toISOString();
    const fecha = fechaHora.split("T")[0];
    const idAcceso = crypto.randomUUID();

    let busqueda;
    try {
        busqueda = await rekognition.send(new SearchFacesByImageCommand({
            CollectionId: COLLECTION_ID,
            Image: { Bytes: imagen },
            FaceMatchThreshold: UMBRAL_SIMILITUD,
            MaxFaces: 1,
        }));
    } catch (error) {
        if (/no faces/i.test(error.message || "")) {
            await marcarSesion(sessionId, "fallida");
            return responder(401, { codigo: 1, descripcion: "No se detectó un rostro en el escaneo" });
        }
        throw error;
    }

    const match = busqueda.FaceMatches?.[0];

    if (!match?.Face?.ExternalImageId) {
        await dynamo.send(new PutItemCommand({
            TableName: TABLE_ACCESOS,
            Item: {
                id_acceso: { S: idAcceso },
                fecha_hora: { S: fechaHora },
                identificacion: { S: "DESCONOCIDO" },
                nombre: { S: "DESCONOCIDO" },
                similitud: { N: "0" },
                resultado: { S: "RECHAZADO" },
                tipo_acceso: { S: "ENTRADA" },
                metodo_validacion: { S: "liveness" },
                liveness_confianza: { N: confianza.toFixed(2) },
            },
        }));
        await marcarSesion(sessionId, "consumida");

        log("WARN", "Persona viva pero no registrada", { sessionId });
        return responder(401, {
            codigo: 1,
            descripcion: "Persona verificada como real, pero no está registrada en el sistema",
            liveness_verificado: true,
        });
    }

    const identificacion = match.Face.ExternalImageId;
    const similitud = match.Similarity;

    const empleado = await dynamo.send(new GetItemCommand({
        TableName: TABLE_EMPLEADOS,
        Key: { identificacion: { S: identificacion } },
    }));

    if (!empleado.Item) {
        await marcarSesion(sessionId, "consumida");
        log("WARN", "Rostro reconocido pero el empleado ya no está activo", { identificacion });
        return responder(401, {
            codigo: 1,
            descripcion: "El rostro corresponde a un empleado que no está activo",
            liveness_verificado: true,
        });
    }

    const nombre = empleado.Item.nombre?.S || identificacion;

    // Si ya hay una ENTRADA abierta hoy, este escaneo es la SALIDA.
    const abiertas = await dynamo.send(new QueryCommand({
        TableName: TABLE_ACCESOS,
        IndexName: "identificacion-fecha-index",
        KeyConditionExpression: "identificacion = :id AND begins_with(fecha_hora, :fecha)",
        FilterExpression: "tipo_acceso = :entrada AND attribute_not_exists(hora_salida)",
        ExpressionAttributeValues: {
            ":id": { S: identificacion },
            ":fecha": { S: fecha },
            ":entrada": { S: "ENTRADA" },
        },
    }));

    let tipoAcceso = "ENTRADA";
    let mensaje = "Bienvenido";

    if (abiertas.Items?.length > 0) {
        tipoAcceso = "SALIDA";
        mensaje = "Hasta luego";

        await dynamo.send(new PutItemCommand({
            TableName: TABLE_ACCESOS,
            Item: {
                ...abiertas.Items[0],
                hora_salida: { S: fechaHora },
                resultado: { S: "SALIDA" },
            },
        }));
    }

    await dynamo.send(new PutItemCommand({
        TableName: TABLE_ACCESOS,
        Item: {
            id_acceso: { S: idAcceso },
            fecha_hora: { S: fechaHora },
            identificacion: { S: identificacion },
            nombre: { S: nombre },
            similitud: { N: similitud.toFixed(2) },
            resultado: { S: "EXITOSO" },
            tipo_acceso: { S: tipoAcceso },
            metodo_validacion: { S: "liveness" },
            liveness_confianza: { N: confianza.toFixed(2) },
        },
    }));

    await marcarSesion(sessionId, "consumida");

    log("INFO", "Acceso validado con liveness", {
        identificacion,
        nombre,
        tipo_acceso: tipoAcceso,
        similitud: similitud.toFixed(2),
        confianza_liveness: confianza.toFixed(2),
    });

    return responder(200, {
        codigo: 0,
        descripcion: "Validación biométrica exitosa con verificación de persona viva",
        identificacion,
        nombre,
        tipo_acceso: tipoAcceso,
        mensaje,
        similitud: Number(similitud.toFixed(2)),
        confianza_liveness: Number(confianza.toFixed(2)),
        liveness_verificado: true,
    });
}

/* ────────────────────────────────────────────────────────────
 * Utilidades
 * ──────────────────────────────────────────────────────────── */
async function marcarSesion(sessionId, estado) {
    try {
        await dynamo.send(new UpdateItemCommand({
            TableName: TABLE_LIVENESS,
            Key: { session_id: { S: sessionId } },
            UpdateExpression: "SET #estado = :estado, cerrada_en = :ts",
            ExpressionAttributeNames: { "#estado": "estado" },
            ExpressionAttributeValues: {
                ":estado": { S: estado },
                ":ts": { S: new Date().toISOString() },
            },
        }));
    } catch (error) {
        log("WARN", "No se pudo actualizar el estado de la sesión", {
            sessionId,
            estado,
            error: error.message,
        });
    }
}

// La evidencia en S3 es deseable pero no indispensable: si el cliente de S3
// no estuviera disponible en el runtime, el escaneo debe seguir funcionando.
async function guardarEvidencia(sessionId, proposito, imagen) {
    if (!BUCKET_AUDITORIA) return;
    try {
        const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
        const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
        await s3.send(new PutObjectCommand({
            Bucket: BUCKET_AUDITORIA,
            Key: `liveness/${proposito}/${new Date().toISOString().split("T")[0]}/${sessionId}.jpg`,
            Body: imagen,
            ContentType: "image/jpeg",
        }));
    } catch (error) {
        log("WARN", "No se pudo guardar la evidencia en S3", { error: error.message });
    }
}

/* ────────────────────────────────────────────────────────────
 * Router
 * ──────────────────────────────────────────────────────────── */
exports.handler = async (event) => {
    const inicio = Date.now();
    const ruta = event.path || event.rawPath || "";
    const metodo = event.httpMethod || event.requestContext?.http?.method || "";

    log("INFO", "Lambda invocado", { path: ruta, method: metodo });

    if (metodo === "OPTIONS") {
        return { statusCode: 200, headers: CORS, body: "" };
    }

    try {
        if (ruta.endsWith("/liveness-init") && metodo === "POST") {
            return await iniciarLiveness(event);
        }

        if ((ruta.endsWith("/liveness-result") || ruta.endsWith("/validar")) && metodo === "POST") {
            return await procesarResultado(event);
        }

        return responder(404, { codigo: 1, descripcion: "Endpoint no encontrado" });
    } catch (error) {
        log("ERROR", "Error no controlado", {
            error: error.message,
            name: error.name,
            path: ruta,
            duration_ms: Date.now() - inicio,
        });
        return responder(500, {
            codigo: 1,
            descripcion: "Error procesando la solicitud",
        });
    }
};
