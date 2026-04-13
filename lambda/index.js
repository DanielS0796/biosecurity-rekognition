const { RekognitionClient, SearchFacesByImageCommand } = require("@aws-sdk/client-rekognition");
const { DynamoDBClient, PutItemCommand, QueryCommand, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const crypto = require("crypto");

const rekognition = new RekognitionClient({ region: "us-east-1" });
const dynamo = new DynamoDBClient({ region: "us-east-1" });

exports.handler = async (event) => {
    try {
        const body = typeof event.body === "string"
            ? JSON.parse(event.body)
            : event.body || event;

        const bufferValidacion = Buffer.from(
            body.imgvalidacion.replace(/^data:image\/\w+;base64,/, ""),
            "base64"
        );

        const params = {
            CollectionId: "coleccion2anlusoft",
            FaceMatchThreshold: 95,
            Image: { Bytes: bufferValidacion },
            MaxFaces: 1
        };

        const responseAWS = await rekognition.send(new SearchFacesByImageCommand(params));

        const fechaHora = new Date().toISOString();
        const fecha = fechaHora.split("T")[0];
        const idAcceso = crypto.randomUUID();

        if (
            responseAWS.FaceMatches &&
            responseAWS.FaceMatches.length > 0 &&
            responseAWS.FaceMatches[0].Face.ExternalImageId
        ) {
            const identificacion = responseAWS.FaceMatches[0].Face.ExternalImageId;
            const similitud = responseAWS.FaceMatches[0].Similarity;

            // Obtener nombre del empleado
            const empleado = await dynamo.send(new GetItemCommand({
                TableName: "biosecurity-empleados",
                Key: { identificacion: { S: identificacion } }
            }));
            const nombre = empleado.Item?.nombre?.S || identificacion;

            // Buscar si ya tiene entrada hoy sin salida
            const queryResult = await dynamo.send(new QueryCommand({
                TableName: "biosecurity-accesos",
                IndexName: "identificacion-fecha-index",
                KeyConditionExpression: "identificacion = :id AND begins_with(fecha_hora, :fecha)",
                FilterExpression: "tipo_acceso = :entrada AND attribute_not_exists(hora_salida)",
                ExpressionAttributeValues: {
                    ":id":      { S: identificacion },
                    ":fecha":   { S: fecha },
                    ":entrada": { S: "ENTRADA" }
                }
            }));

            let tipoAcceso = "ENTRADA";
            let mensaje = "Bienvenido";

            if (queryResult.Items && queryResult.Items.length > 0) {
                tipoAcceso = "SALIDA";
                mensaje = "Hasta luego";

                // Actualizar el registro de entrada con la hora de salida
                const registroEntrada = queryResult.Items[0];
                await dynamo.send(new PutItemCommand({
                    TableName: "biosecurity-accesos",
                    Item: {
                        ...registroEntrada,
                        hora_salida: { S: fechaHora },
                        resultado:   { S: "SALIDA" }
                    }
                }));
            }

            // Guardar nuevo registro con nombre incluido
            await dynamo.send(new PutItemCommand({
                TableName: "biosecurity-accesos",
                Item: {
                    id_acceso:      { S: idAcceso },
                    fecha_hora:     { S: fechaHora },
                    identificacion: { S: identificacion },
                    nombre:         { S: nombre },
                    similitud:      { N: similitud.toFixed(2) },
                    resultado:      { S: "EXITOSO" },
                    tipo_acceso:    { S: tipoAcceso }
                }
            }));

            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type"
                },
                body: JSON.stringify({
                    codigo: 0,
                    descripcion: "Validacion Biometrica Exitosa",
                    similutud: identificacion,
                    nombre,
                    tipo_acceso: tipoAcceso,
                    mensaje
                })
            };

        } else {
            await dynamo.send(new PutItemCommand({
                TableName: "biosecurity-accesos",
                Item: {
                    id_acceso:      { S: idAcceso },
                    fecha_hora:     { S: fechaHora },
                    identificacion: { S: "DESCONOCIDO" },
                    nombre:         { S: "DESCONOCIDO" },
                    similitud:      { N: "0" },
                    resultado:      { S: "FALLIDO" },
                    tipo_acceso:    { S: "INTENTO" }
                }
            }));

            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type"
                },
                body: JSON.stringify({
                    codigo: 1,
                    descripcion: "Validacion Biometrica Erronea",
                    similutud: -1
                })
            };
        }

    } catch (error) {
        console.log(error);
        return {
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({
                codigo: 1,
                descripcion: "Error en Lambda",
                error: error.message
            })
        };
    }
};
