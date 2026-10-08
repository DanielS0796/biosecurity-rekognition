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

// Versión de la política de tratamiento de datos que se le muestra a la
// persona al registrarse. Se guarda junto con la autorización: si mañana
// cambia el texto, queda constancia de cuál aceptó cada quien, que es lo
// que pide la Ley 1581 cuando dice "informada".
const POLITICA_VERSION = process.env.POLITICA_VERSION || "2026-10-v1";

// Buzón al que la persona escribe para consultar, actualizar o revocar.
const CANAL_HABEAS_DATA = process.env.CANAL_HABEAS_DATA || "biosecurityucompensar@gmail.com";

// Confianza mínima de liveness (0-100). Es el score que dice si había una
// persona real frente a la cámara. 85 es el punto de equilibrio que recomienda
// AWS; subirlo endurece el control a costa de más reintentos legítimos.
const UMBRAL_LIVENESS = Number(process.env.UMBRAL_LIVENESS || 85);
// Similitud mínima para considerar que dos rostros son la misma persona.
const UMBRAL_SIMILITUD = Number(process.env.UMBRAL_SIMILITUD || 95);
// Similitud usada al registrar, para detectar que el rostro ya existe.
const UMBRAL_DUPLICADO = Number(process.env.UMBRAL_DUPLICADO || 90);

// Tipo de desafío por propósito.
//
//   FaceMovementAndLightChallenge — óvalo más destellos de color. Es el que
//   AWS recomienda para máxima precisión: las luces delatan el reflejo de
//   una pantalla o de papel.
//
//   FaceMovementChallenge — solo óvalo, sin destellos. Unos 3 segundos más
//   rápido y sirve con cámara frontal o trasera, a cambio de algo menos de
//   precisión.
//
// El registro crea la identidad, así que ahí se prioriza precisión. La
// entrada es de alto volumen y ahí se prioriza rapidez.
const DESAFIO_REGISTRO = process.env.DESAFIO_REGISTRO || "FaceMovementAndLightChallenge";
const DESAFIO_VALIDACION = process.env.DESAFIO_VALIDACION || "FaceMovementChallenge";

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
    // Vía alternativa para personas fotosensibles, que AWS recomienda ofrecer:
    // los destellos pueden desencadenar crisis en epilepsia fotosensible.
    const sinDestellos = body.sin_destellos === true;

    const correo = (body.correo || "").trim();
    const autorizacion = body.autorizacion || {};

    if (proposito === "registro") {
        if (!identificacion || !nombre) {
            return responder(400, {
                codigo: 1,
                descripcion: "Para registrar se necesitan identificación y nombre",
            });
        }

        // Los datos biométricos son sensibles (Ley 1581, art. 5), así que
        // el tratamiento exige autorización previa, expresa e informada.
        // Se comprueba acá, antes de encender la cámara: capturar primero
        // y preguntar después sería tratar el dato sin permiso.
        if (autorizacion.autorizado !== true) {
            return responder(400, {
                codigo: 1,
                descripcion: "Falta la autorización para el tratamiento de datos biométricos",
            });
        }

        // Si el navegador mostró una versión distinta de la que rige, la
        // persona aceptó un texto que ya no es el vigente. Guardar eso
        // como constancia sería guardar una constancia falsa.
        if (autorizacion.politica_version !== POLITICA_VERSION) {
            return responder(409, {
                codigo: 1,
                descripcion: "La política de tratamiento de datos cambió. Recarga la página y vuelve a leerla.",
            });
        }

        if (!correo) {
            return responder(400, {
                codigo: 1,
                descripcion: "Se necesita un correo para enviar la constancia de la autorización",
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

    const desafio = sinDestellos
        ? "FaceMovementChallenge"
        : proposito === "registro" ? DESAFIO_REGISTRO : DESAFIO_VALIDACION;
    const respuesta = await crearSesionRekognition(desafio);

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
            desafio: { S: desafio },
            created_at: { N: String(ahora) },
            expires_at: { N: String(ahora + 600) },
            // Constancia de la autorización. La fecha la pone el
            // servidor: una que mande el navegador no prueba nada.
            correo: { S: correo || "-" },
            autorizacion_datos: { BOOL: proposito === "registro" },
            autorizacion_fecha: { S: new Date().toISOString() },
            politica_version: { S: proposito === "registro" ? POLITICA_VERSION : "-" },
            autorizacion_canal: { S: (autorizacion.canal || "app-web").slice(0, 40) },
        },
    }));

    log("INFO", "Sesión de liveness creada", {
        sessionId, proposito, identificacion, desafio, sin_destellos: sinDestellos,
    });

    return responder(200, { codigo: 0, session_id: sessionId, proposito, desafio });
}

// ChallengePreferences llegó a la API en julio de 2025. Si el SDK que trae
// el runtime fuera anterior y rechazara el parámetro, se reintenta sin él:
// el escaneo sigue funcionando, solo que con el desafío predeterminado.
async function crearSesionRekognition(tipoDesafio) {
    const base = { AuditImagesLimit: 1 };
    try {
        const r = await rekognition.send(new CreateFaceLivenessSessionCommand({
            Settings: { ...base, ChallengePreferences: [{ Type: tipoDesafio }] },
        }));
        log("INFO", "Sesión creada con desafío explícito", { desafio: tipoDesafio });
        return r;
    } catch (error) {
        const recuperable = error.name === "ValidationException"
            || /ChallengePreferences|unknown|unexpected/i.test(error.message || "");
        if (!recuperable) throw error;

        log("WARN", "El desafío pedido no fue aceptado, se usa el predeterminado", {
            desafio: tipoDesafio,
            error: error.message,
        });
        return await rekognition.send(new CreateFaceLivenessSessionCommand({ Settings: base }));
    }
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
    // La constancia se fijó al crear la sesión, con la hora del servidor.
    const evidencia = {
        correo: sesion.Item.correo?.S || "",
        autorizacionFecha: sesion.Item.autorizacion_fecha?.S || "",
        politicaVersion: sesion.Item.politica_version?.S || "",
        autorizacionCanal: sesion.Item.autorizacion_canal?.S || "app-web",
    };

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
            ...evidencia,
        });
    }

    return await validarAcceso({ sessionId, imagen, confianza });
}

/* ────────────────────────────────────────────────────────────
 * Registro: indexa la ReferenceImage de AWS, nunca una foto del cliente
 * ──────────────────────────────────────────────────────────── */
async function registrarEmpleado({
    sessionId, identificacion, nombre, imagen, confianza,
    correo, autorizacionFecha, politicaVersion, autorizacionCanal,
}) {
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
            // La constancia viaja con la sesión hasta acá, para que el
            // registro del empleado se baste a sí mismo: quien audite no
            // tiene que cruzar dos tablas para saber si hubo permiso.
            correo: { S: correo },
            autorizacion_datos: { BOOL: true },
            autorizacion_fecha: { S: autorizacionFecha },
            politica_version: { S: politicaVersion },
            autorizacion_canal: { S: autorizacionCanal },
        },
    }));

    if (correo && correo !== "-") {
        try {
            await enviarConstancia(correo, nombre, identificacion, autorizacionFecha, politicaVersion);
        } catch (e) {
            // El registro ya está hecho y es válido: la constancia es una
            // cortesía, no el consentimiento. No se revierte por esto.
            log("WARN", "No se pudo enviar la constancia de autorización", {
                identificacion, error: e.message,
            });
        }
    }

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
/* ────────────────────────────────────────────────────────────
 * Constancia de la autorización (Ley 1581 de 2012)
 * ──────────────────────────────────────────────────────────── */

/**
 * Le manda a la persona registrada una constancia de lo que autorizó.
 *
 * No es el consentimiento —ese se dio en la pantalla, antes de encender
 * la cámara— sino la prueba que ella conserva: qué se guardó, con qué
 * finalidad, por cuánto tiempo y a dónde escribir para salirse. La ley
 * le da derecho a conocer y revocar en cualquier momento, y un derecho
 * que la persona no sabe que tiene no se ejerce.
 */
async function enviarConstancia(correo, nombre, identificacion, fecha, version) {
    if (!process.env.SMTP_USUARIO || !process.env.SMTP_CLAVE) {
        log("WARN", "SMTP sin configurar, no se envía la constancia", { identificacion });
        return;
    }

    const nodemailer = require("nodemailer");
    const transporte = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.SMTP_USUARIO, pass: process.env.SMTP_CLAVE },
    });

    const fechaLegible = new Date(fecha).toLocaleString("es-CO", {
        timeZone: "America/Bogota", dateStyle: "long", timeStyle: "short",
    });

    const texto = [
        `Constancia de autorización de tratamiento de datos biométricos`,
        ``,
        `Nombre: ${nombre}`,
        `Identificación: ${identificacion}`,
        `Fecha de la autorización: ${fechaLegible}`,
        `Versión de la política aceptada: ${version}`,
        `Canal: aplicación web de control de acceso`,
        ``,
        `Qué se guardó: un vector matemático derivado de tu rostro, no la`,
        `fotografía. Ese vector no permite reconstruir tu cara.`,
        ``,
        `Para qué: verificar tu identidad al entrar a las instalaciones.`,
        `No se usa para ninguna otra finalidad.`,
        ``,
        `Por cuánto tiempo: mientras mantengas tu vínculo con la`,
        `institución. Al terminar, el registro pasa a retirados y el vector`,
        `se elimina de la colección biométrica.`,
        ``,
        `Tus derechos: puedes conocer, actualizar, rectificar y revocar`,
        `esta autorización cuando quieras, sin dar explicaciones,`,
        `escribiendo a ${CANAL_HABEAS_DATA}.`,
        ``,
        `Si revocas, se elimina el dato biométrico y tu ingreso se`,
        `gestiona por otro medio.`,
        ``,
        `Ley 1581 de 2012 y Decreto 1377 de 2013.`,
    ].join("\n");

    const escapar = (t) => String(t)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const html = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <div style="background:#4B2D8F;padding:20px;border-radius:12px 12px 0 0;text-align:center">
    <h2 style="color:white;margin:0;font-size:18px">Constancia de autorización</h2>
  </div>
  <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee;color:#333;line-height:1.6">
    <p>Quedó registrada tu autorización para el tratamiento de datos biométricos en el sistema de control de acceso.</p>
    <table style="width:100%;font-size:14px;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 0;color:#666">Nombre</td><td style="padding:4px 0"><strong>${escapar(nombre)}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#666">Identificación</td><td style="padding:4px 0"><strong>${escapar(identificacion)}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#666">Fecha</td><td style="padding:4px 0">${escapar(fechaLegible)}</td></tr>
      <tr><td style="padding:4px 0;color:#666">Política</td><td style="padding:4px 0">versión ${escapar(version)}</td></tr>
    </table>
    <p style="font-size:14px"><strong>Qué se guardó.</strong> Un vector matemático derivado de tu rostro, no la fotografía. Ese vector no permite reconstruir tu cara.</p>
    <p style="font-size:14px"><strong>Para qué.</strong> Verificar tu identidad al entrar a las instalaciones. Ninguna otra finalidad.</p>
    <p style="font-size:14px"><strong>Por cuánto tiempo.</strong> Mientras mantengas tu vínculo con la institución. Al terminar, el vector se elimina de la colección biométrica.</p>
    <p style="font-size:14px"><strong>Tus derechos.</strong> Puedes conocer, actualizar, rectificar y revocar esta autorización cuando quieras, sin dar explicaciones, escribiendo a <a href="mailto:${CANAL_HABEAS_DATA}">${CANAL_HABEAS_DATA}</a>. Si revocas, se elimina el dato biométrico y tu ingreso se gestiona por otro medio.</p>
    <p style="font-size:12px;color:#888;margin-top:20px">Ley 1581 de 2012 y Decreto 1377 de 2013.</p>
  </div>
</div>`;

    await transporte.sendMail({
        from: `"Biosecurity UCompensar" <${process.env.SMTP_USUARIO}>`,
        to: correo,
        subject: "Constancia de autorización de datos biométricos",
        text: texto,
        html,
    });

    log("INFO", "Constancia de autorización enviada", { identificacion, version });
}

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
