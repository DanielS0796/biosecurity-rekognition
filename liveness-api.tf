# ═════════════════════════════════════════════════════════════
# Liveness Detection — Lambda, API Gateway y Cognito Identity Pool
# ═════════════════════════════════════════════════════════════
#
# El componente FaceLivenessDetector del navegador abre un WebSocket
# directo a Rekognition para transmitir el video del escaneo. Para eso
# necesita credenciales de AWS en el cliente, que se obtienen de un
# Cognito Identity Pool con permiso de StartFaceLivenessSession.
#
# Ese permiso por sí solo no sirve de nada sin un session_id, y los
# session_id solo los emite nuestro Lambda.

# ─────────────────────────────────────────
# Lambda
# ─────────────────────────────────────────
# Se empaqueta el directorio completo (igual que los otros Lambdas del
# proyecto) para que node_modules viaje con la función.
data "archive_file" "lambda_liveness_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda_build/liveness.zip"
  excludes    = ["registrar.zip", "function.zip", "auditoria.zip", "liveness.zip", "reset.zip"]
}

resource "aws_lambda_function" "liveness" {
  function_name    = "biosecurity-liveness-detection"
  filename         = data.archive_file.lambda_liveness_zip.output_path
  source_code_hash = data.archive_file.lambda_liveness_zip.output_base64sha256
  handler          = "liveness.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_role.arn
  timeout          = 60
  memory_size      = 512

  environment {
    variables = {
      TABLE_LIVENESS   = aws_dynamodb_table.liveness_sessions.name
      TABLE_EMPLEADOS  = aws_dynamodb_table.empleados.name
      TABLE_RETIRADOS  = aws_dynamodb_table.retirados.name
      TABLE_ACCESOS    = aws_dynamodb_table.accesos.name
      COLLECTION_ID    = aws_rekognition_collection.coleccion.collection_id
      BUCKET_AUDITORIA = aws_s3_bucket.liveness_videos.id
      MODULE_NAME      = "liveness-detection"
      UMBRAL_LIVENESS  = "85"
      UMBRAL_SIMILITUD = "95"
      UMBRAL_DUPLICADO = "90"

      # El registro crea la identidad: destellos incluidos, máxima precisión.
      # La entrada prioriza rapidez: solo el óvalo, unos 3 segundos menos.
      DESAFIO_REGISTRO   = "FaceMovementAndLightChallenge"
      DESAFIO_VALIDACION = "FaceMovementChallenge"

      # Ley 1581: versión de la política que se muestra al registrarse y
      # que queda guardada con cada autorización. Al cambiar el texto hay
      # que subir este número, o las constancias dirán que la gente
      # aceptó algo que ya no existe.
      POLITICA_VERSION  = "2026-10-v1"
      CANAL_HABEAS_DATA = "biosecurityucompensar@gmail.com"

      # Para la constancia que se le envía a la persona registrada.
      SMTP_USUARIO = var.smtp_usuario
      SMTP_CLAVE   = var.smtp_clave
    }
  }

  tags = { Project = "anlusoft-rekognition" }
}

# ─────────────────────────────────────────
# API Gateway
# ─────────────────────────────────────────
resource "aws_api_gateway_rest_api" "api_liveness" {
  name        = "biosecurity-liveness-api"
  description = "API para Liveness Detection con Rekognition"
}

locals {
  # Las tres rutas del API. /validar queda como alias de /liveness-result
  # para no romper nada que ya apunte ahí.
  liveness_rutas = toset(["liveness-init", "liveness-result", "validar"])
}

resource "aws_api_gateway_resource" "liveness" {
  for_each    = local.liveness_rutas
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  parent_id   = aws_api_gateway_rest_api.api_liveness.root_resource_id
  path_part   = each.value
}

# POST -> Lambda
resource "aws_api_gateway_method" "liveness_post" {
  for_each      = local.liveness_rutas
  rest_api_id   = aws_api_gateway_rest_api.api_liveness.id
  resource_id   = aws_api_gateway_resource.liveness[each.key].id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "liveness_post" {
  for_each                = local.liveness_rutas
  rest_api_id             = aws_api_gateway_rest_api.api_liveness.id
  resource_id             = aws_api_gateway_resource.liveness[each.key].id
  http_method             = aws_api_gateway_method.liveness_post[each.key].http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.liveness.invoke_arn
}

# OPTIONS -> CORS preflight
resource "aws_api_gateway_method" "liveness_options" {
  for_each      = local.liveness_rutas
  rest_api_id   = aws_api_gateway_rest_api.api_liveness.id
  resource_id   = aws_api_gateway_resource.liveness[each.key].id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "liveness_options" {
  for_each    = local.liveness_rutas
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  resource_id = aws_api_gateway_resource.liveness[each.key].id
  http_method = aws_api_gateway_method.liveness_options[each.key].http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "liveness_options" {
  for_each    = local.liveness_rutas
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  resource_id = aws_api_gateway_resource.liveness[each.key].id
  http_method = aws_api_gateway_method.liveness_options[each.key].http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "liveness_options" {
  for_each    = local.liveness_rutas
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  resource_id = aws_api_gateway_resource.liveness[each.key].id
  http_method = aws_api_gateway_method.liveness_options[each.key].http_method
  status_code = aws_api_gateway_method_response.liveness_options[each.key].status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.liveness_options]
}

resource "aws_api_gateway_deployment" "liveness_deployment" {
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  stage_name  = "prod"

  # Fuerza un redespliegue cuando cambia cualquier pieza del API.
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.liveness,
      aws_api_gateway_method.liveness_post,
      aws_api_gateway_integration.liveness_post,
      aws_api_gateway_method.liveness_options,
      aws_api_gateway_integration.liveness_options,
      aws_api_gateway_integration_response.liveness_options,
    ]))
  }

  depends_on = [
    aws_api_gateway_integration.liveness_post,
    aws_api_gateway_integration.liveness_options,
    aws_api_gateway_integration_response.liveness_options,
  ]
}

resource "aws_lambda_permission" "apigw_liveness" {
  statement_id  = "AllowAPIGatewayInvokeLiveness"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.liveness.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_liveness.execution_arn}/*/*"
}

# ─────────────────────────────────────────
# Cognito Identity Pool para el navegador
# ─────────────────────────────────────────
resource "aws_cognito_identity_pool" "liveness" {
  identity_pool_name               = "biosecurity_liveness"
  allow_unauthenticated_identities = true
  allow_classic_flow               = false

  tags = { Project = "anlusoft-rekognition" }
}

resource "aws_iam_role" "liveness_browser" {
  name = "biosecurity-liveness-browser-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = "cognito-identity.amazonaws.com" }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.liveness.id
        }
        "ForAnyValue:StringLike" = {
          "cognito-identity.amazonaws.com:amr" = "unauthenticated"
        }
      }
    }]
  })

  tags = { Project = "anlusoft-rekognition" }
}

# Único permiso que recibe el navegador. Sin un session_id emitido por
# nuestro Lambda no puede iniciar ningún escaneo.
resource "aws_iam_role_policy" "liveness_browser" {
  name = "biosecurity-liveness-browser-policy"
  role = aws_iam_role.liveness_browser.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "rekognition:StartFaceLivenessSession"
      Resource = "*"
    }]
  })
}

resource "aws_cognito_identity_pool_roles_attachment" "liveness" {
  identity_pool_id = aws_cognito_identity_pool.liveness.id

  roles = {
    unauthenticated = aws_iam_role.liveness_browser.arn
  }
}

# ─────────────────────────────────────────
# Outputs
# ─────────────────────────────────────────
output "api_liveness_init_url" {
  value       = "https://${aws_api_gateway_rest_api.api_liveness.id}.execute-api.us-east-1.amazonaws.com/${aws_api_gateway_deployment.liveness_deployment.stage_name}/liveness-init"
  description = "URL para crear la sesión de liveness"
}

output "api_liveness_result_url" {
  value       = "https://${aws_api_gateway_rest_api.api_liveness.id}.execute-api.us-east-1.amazonaws.com/${aws_api_gateway_deployment.liveness_deployment.stage_name}/liveness-result"
  description = "URL para cerrar la sesión y obtener el resultado"
}

output "liveness_identity_pool_id" {
  value       = aws_cognito_identity_pool.liveness.id
  description = "Identity Pool ID que necesita el frontend para el escaneo"
}
