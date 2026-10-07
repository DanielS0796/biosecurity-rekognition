const { RekognitionClient, CreateFaceLivenessSessionCommand, GetFaceLivenessSessionResultsCommand, SearchFacesByImageCommand } = require("@aws-sdk/client-rekognition");
const { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand } = require("@aws-sdk/client-dynamodb");
const Sentry = require("@sentry/aws-serverless");

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://examplePublicKey@o0.ingest.sentry.io/0",
  tracesSampleRate: 1.0,
  environment: process.env.ENVIRONMENT || "production",
});

const rekognitionClient = new RekognitionClient({ region: "us-east-1" });
const dynamoClient = new DynamoDBClient({ region: "us-east-1" });

const TABLE_LIVENESS = process.env.TABLE_LIVENESS || "biosecurity-liveness-sessions";
const TABLE_EMPLEADOS = process.env.TABLE_EMPLEADOS || "biosecurity-empleados";
const TABLE_ACCESOS = process.env.TABLE_ACCESOS || "biosecurity-accesos";
const COLLECTION_ID = process.env.COLLECTION_ID || "coleccion2anlusoft";

function logStructured(level, message, data = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    module: process.env.MODULE_NAME || "validacion-biometrica",
    message,
    ...data,
  };
  console.log(JSON.stringify(logEntry));
}

async function iniciarLiveness(event) {
  try {
    logStructured("INFO", "Iniciando sesión de Liveness Detection");

    // Crear sesión sin OutputConfig para probar
    const params = {};

    const command = new CreateFaceLivenessSessionCommand(params);
    const response = await rekognitionClient.send(command);

    const sessionId = response.SessionId;
    logStructured("INFO", "Sesión de Liveness creada", { sessionId });

    // Guardar en DynamoDB con TTL de 10 minutos
    const expiresAt = Math.floor(Date.now() / 1000) + 600;
    await dynamoClient.send(
      new PutItemCommand({
        TableName: TABLE_LIVENESS,
        Item: {
          session_id: { S: sessionId },
          created_at: { N: String(Math.floor(Date.now() / 1000)) },
          expires_at: { N: String(expiresAt) },
          status: { S: "active" },
        },
      })
    );

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ session_id: sessionId }),
    };
  } catch (error) {
    logStructured("ERROR", "Error al iniciar Liveness", { error: error.message });
    Sentry.captureException(error);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Error iniciando sesión" }),
    };
  }
}

async function validarAccesoConLiveness(event) {
  try {
    const { liveness_session_id, imgvalidacion, identificacion } = JSON.parse(event.body);

    logStructured("INFO", "Validando Liveness", { sessionId: liveness_session_id });

    // Validar sesión existe en DynamoDB
    const sessionQuery = await dynamoClient.send(
      new GetItemCommand({
        TableName: TABLE_LIVENESS,
        Key: { session_id: { S: liveness_session_id } },
      })
    );

    if (!sessionQuery.Item) {
      logStructured("WARN", "Sesión de Liveness no encontrada", { sessionId: liveness_session_id });
      return {
        statusCode: 401,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Sesión inválida" }),
      };
    }

    // Obtener resultados de Liveness
    const livenessCommand = new GetFaceLivenessSessionResultsCommand({
      SessionId: liveness_session_id,
    });
    const livenessResponse = await rekognitionClient.send(livenessCommand);

    const livenessConfidence = livenessResponse.Confidence || 0;
    const isLive = livenessResponse.IsLive && livenessConfidence >= 95;

    logStructured("INFO", "Resultado de Liveness", {
      sessionId: liveness_session_id,
      confidence: livenessConfidence,
      isLive,
    });

    if (!isLive) {
      logStructured("WARN", "Validación de Liveness fallida", { confidence: livenessConfidence });
      return {
        statusCode: 401,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Validación de Liveness fallida" }),
      };
    }

    // Buscar cara en colección Rekognition
    const imgBuffer = Buffer.from(imgvalidacion.split(",")[1], "base64");
    const searchCommand = new SearchFacesByImageCommand({
      CollectionId: COLLECTION_ID,
      Image: { Bytes: imgBuffer },
      MaxFaces: 1,
      FaceMatchThreshold: 95,
    });

    const searchResponse = await rekognitionClient.send(searchCommand);
    const faceMatches = searchResponse.FaceMatches || [];

    logStructured("INFO", "Búsqueda de cara completada", { matchesFound: faceMatches.length });

    if (faceMatches.length === 0) {
      logStructured("WARN", "Cara no reconocida", { identificacion });
      return {
        statusCode: 401,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Cara no reconocida" }),
      };
    }

    const faceMatch = faceMatches[0];
    const similarity = faceMatch.Similarity || 0;

    logStructured("INFO", "Validación completada", {
      identificacion,
      similarity,
      liveness_verified: true,
    });

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        success: true,
        identificacion,
        similarity,
        liveness_verified: true,
      }),
    };
  } catch (error) {
    logStructured("ERROR", "Error en validación", { error: error.message });
    Sentry.captureException(error);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Error en validación" }),
    };
  }
}

exports.handler = Sentry.wrapHandler(async (event) => {
  logStructured("INFO", "Lambda invocado", { path: event.path, method: event.httpMethod });

  if (event.path === "/liveness-init" && event.httpMethod === "POST") {
    return await iniciarLiveness(event);
  } else if (event.path === "/validar" && event.httpMethod === "POST") {
    return await validarAccesoConLiveness(event);
  }

  return {
    statusCode: 404,
    body: JSON.stringify({ error: "Endpoint no encontrado" }),
  };
});
