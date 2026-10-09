terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# ─────────────────────────────────────────
# S3
# ─────────────────────────────────────────
resource "aws_s3_bucket" "frontend" {
  bucket = "buckebiosecurity"
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  index_document { suffix = "index.html" }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "frontend_public" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadGetObject"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.frontend]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.biosecurity.arn
    }
    bucket_key_enabled = true
  }
}

# ─────────────────────────────────────────
# KMS
# ─────────────────────────────────────────
resource "aws_kms_key" "biosecurity" {
  description             = "Clave de cifrado para datos biometricos biosecurity"
  deletion_window_in_days = 10
  enable_key_rotation     = true
  tags                    = { Project = "anlusoft-rekognition" }
}

resource "aws_kms_alias" "biosecurity" {
  name          = "alias/biosecurity-key"
  target_key_id = aws_kms_key.biosecurity.key_id
}

# ─────────────────────────────────────────
# IAM
# ─────────────────────────────────────────
resource "aws_iam_role" "lambda_role" {
  name = "validacionderostros-role-vfa72p0a"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_rekognition_policy" {
  name = "anlusoft-rekognition-policy"
  role = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "rekognition:SearchFacesByImage",
          "rekognition:IndexFaces",
          "rekognition:DeleteFaces",
          "rekognition:ListFaces",
          "rekognition:CreateCollection",
          "rekognition:ListCollections",
          "rekognition:DescribeCollection"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_dynamo_policy" {
  name = "biosecurity-dynamo-policy"
  role = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem"
      ]
      Resource = [
        aws_dynamodb_table.empleados.arn,
        aws_dynamodb_table.accesos.arn,
        "${aws_dynamodb_table.accesos.arn}/index/*",
        "${aws_dynamodb_table.empleados.arn}/index/*",
        aws_dynamodb_table.retirados.arn
      ]
    }]
  })
}

resource "aws_iam_role_policy" "lambda_kms_policy" {
  name = "biosecurity-kms-policy"
  role = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:DescribeKey"
      ]
      Resource = aws_kms_key.biosecurity.arn
    }]
  })
}

# ─────────────────────────────────────────
# Rekognition
# ─────────────────────────────────────────
# ─────────────────────────────────────────
# Observabilidad compartida
# ─────────────────────────────────────────
# instrument.js lee estas tres. Se mezclan en el environment de cada
# Lambda que hace require("./instrument") en vez de repetirlas: si
# faltan, Sentry arranca sin DSN y no reporta nada, sin error visible.
locals {
  observabilidad = {
    SENTRY_DSN = var.sentry_dsn
    TEAM_GROUP = var.team_group
  }
}

resource "aws_rekognition_collection" "coleccion" {
  collection_id = "coleccion2anlusoft"
  tags          = { Project = "anlusoft-rekognition" }
  # Un plan que quiera recrear esto borraría datos irrecuperables. Así
  # Terraform falla en vez de destruirlo: el error se revisa a mano.
  lifecycle {
    prevent_destroy = true
  }
}

# ─────────────────────────────────────────
# DynamoDB
# ─────────────────────────────────────────
resource "aws_dynamodb_table" "empleados" {
  name             = "biosecurity-empleados"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "identificacion"
  attribute {
    name = "identificacion"
    type = "S"
  }
  tags = { Project = "anlusoft-rekognition" }
  # Un plan que quiera recrear esto borraría datos irrecuperables. Así
  # Terraform falla en vez de destruirlo: el error se revisa a mano.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_dynamodb_table" "retirados" {
  name             = "biosecurity-retirados"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "identificacion"
  attribute {
    name = "identificacion"
    type = "S"
  }
  tags = { Project = "anlusoft-rekognition" }
  # Un plan que quiera recrear esto borraría datos irrecuperables. Así
  # Terraform falla en vez de destruirlo: el error se revisa a mano.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_dynamodb_table" "accesos" {
  name             = "biosecurity-accesos"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id_acceso"
  range_key    = "fecha_hora"

  attribute {
    name = "id_acceso"
    type = "S"
  }
  attribute {
    name = "fecha_hora"
    type = "S"
  }
  attribute {
    name = "identificacion"
    type = "S"
  }

  global_secondary_index {
    name            = "fecha_hora-index"
    hash_key        = "fecha_hora"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "identificacion-fecha-index"
    hash_key        = "identificacion"
    range_key       = "fecha_hora"
    projection_type = "ALL"
  }

  tags = { Project = "anlusoft-rekognition" }
  # Un plan que quiera recrear esto borraría datos irrecuperables. Así
  # Terraform falla en vez de destruirlo: el error se revisa a mano.
  lifecycle {
    prevent_destroy = true
  }
}

# ─────────────────────────────────────────
# Lambda validacion
# ─────────────────────────────────────────
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda_build/function.zip"
  excludes    = ["registrar.zip", "function.zip", "auditoria.zip"]
}

resource "aws_lambda_function" "validacion_biometrica" {
  function_name    = "validacionderostros"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_role.arn
  timeout          = 30
  memory_size      = 256
  environment {
    variables = merge(local.observabilidad, {
      COLLECTION_ID = aws_rekognition_collection.coleccion.collection_id
      MODULE_NAME   = "validacion-biometrica"
    })
  }
  tags = { Project = "anlusoft-rekognition" }
}

# ─────────────────────────────────────────
# Lambda registro RRHH
# ─────────────────────────────────────────
data "archive_file" "lambda_registrar_zip" {
  type = "zip"
  # source_dir, no source_file: registrar.js hace require de
  # ./instrument.js y de @aws-sdk y @sentry, así que un zip con el
  # archivo suelto produce un Lambda que no arranca. Pasó: el primer
  # apply que tocó este recurso tumbó el registro en producción.
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda_build/registrar.zip"
  excludes    = ["registrar.zip", "function.zip", "auditoria.zip", "liveness.zip", "reset.zip"]
}

resource "aws_lambda_function" "registrar_empleado" {
  function_name    = "biosecurity-registrar-empleado"
  filename         = data.archive_file.lambda_registrar_zip.output_path
  source_code_hash = data.archive_file.lambda_registrar_zip.output_base64sha256
  handler          = "registrar.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_role.arn
  timeout          = 30
  memory_size      = 256
  environment {
    variables = merge(local.observabilidad, {
      COLLECTION_ID   = "coleccion2anlusoft"
      TABLE_EMPLEADOS = aws_dynamodb_table.empleados.name
      MODULE_NAME     = "registrar-empleado"
    })
  }
  tags = { Project = "anlusoft-rekognition" }
}

# ─────────────────────────────────────────
# Lambda auditoria
# ─────────────────────────────────────────
data "archive_file" "lambda_auditoria_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda_build/auditoria.zip"
  excludes    = ["registrar.zip", "function.zip", "auditoria.zip"]
}

resource "aws_lambda_function" "auditoria" {
  function_name    = "biosecurity-auditoria"
  filename         = data.archive_file.lambda_auditoria_zip.output_path
  source_code_hash = data.archive_file.lambda_auditoria_zip.output_base64sha256
  handler          = "auditoria.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_role.arn
  timeout          = 60
  memory_size      = 512

  environment {
    variables = merge(local.observabilidad, {
      MODULE_NAME  = "auditoria"
      ZONA_HORARIA = "America/Bogota"
    })
  }

  tags = { Project = "anlusoft-rekognition" }
}

# ─────────────────────────────────────────
# API Gateway validacion (publico)
# ─────────────────────────────────────────
resource "aws_api_gateway_rest_api" "api" {
  name        = "anlusoft-rekognition-api"
  description = "API para validacion biometrica"
}

resource "aws_api_gateway_resource" "root" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "validar"
}

resource "aws_api_gateway_method" "post" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.root.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "lambda" {
  rest_api_id             = aws_api_gateway_rest_api.api.id
  resource_id             = aws_api_gateway_resource.root.id
  http_method             = aws_api_gateway_method.post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.validacion_biometrica.invoke_arn
}

resource "aws_api_gateway_method" "options" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  resource_id   = aws_api_gateway_resource.root.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.root.id
  http_method = aws_api_gateway_method.options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_200" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.root.id
  http_method = aws_api_gateway_method.options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.root.id
  http_method = aws_api_gateway_method.options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.options]
}

resource "aws_api_gateway_deployment" "deployment" {
  depends_on  = [aws_api_gateway_integration.lambda, aws_api_gateway_integration.options]
  rest_api_id = aws_api_gateway_rest_api.api.id
  stage_name  = "best"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.validacion_biometrica.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/*/*"
}

# ─────────────────────────────────────────
# API Gateway RRHH (protegido)
# ─────────────────────────────────────────
resource "aws_api_gateway_rest_api" "api_rrhh" {
  name        = "biosecurity-rrhh-api"
  description = "API protegida para registro de empleados"
}

resource "aws_api_gateway_resource" "rrhh_root" {
  rest_api_id = aws_api_gateway_rest_api.api_rrhh.id
  parent_id   = aws_api_gateway_rest_api.api_rrhh.root_resource_id
  path_part   = "registrar"
}

resource "aws_api_gateway_method" "rrhh_post" {
  rest_api_id      = aws_api_gateway_rest_api.api_rrhh.id
  resource_id      = aws_api_gateway_resource.rrhh_root.id
  http_method      = "POST"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "rrhh_lambda" {
  rest_api_id             = aws_api_gateway_rest_api.api_rrhh.id
  resource_id             = aws_api_gateway_resource.rrhh_root.id
  http_method             = aws_api_gateway_method.rrhh_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.registrar_empleado.invoke_arn
}

# El frontend consulta este API con GET (activos, retirados y búsqueda
# por cédula) y borra con DELETE. Hasta ahora Terraform solo declaraba
# POST, así que este API nunca pudo servir la aplicación: por eso
# producción siguió usando el API creado a mano en abril.
resource "aws_api_gateway_method" "rrhh_get" {
  rest_api_id      = aws_api_gateway_rest_api.api_rrhh.id
  resource_id      = aws_api_gateway_resource.rrhh_root.id
  http_method      = "GET"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "rrhh_get" {
  rest_api_id             = aws_api_gateway_rest_api.api_rrhh.id
  resource_id             = aws_api_gateway_resource.rrhh_root.id
  http_method             = aws_api_gateway_method.rrhh_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.registrar_empleado.invoke_arn
}

resource "aws_api_gateway_method" "rrhh_delete" {
  rest_api_id      = aws_api_gateway_rest_api.api_rrhh.id
  resource_id      = aws_api_gateway_resource.rrhh_root.id
  http_method      = "DELETE"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "rrhh_delete" {
  rest_api_id             = aws_api_gateway_rest_api.api_rrhh.id
  resource_id             = aws_api_gateway_resource.rrhh_root.id
  http_method             = aws_api_gateway_method.rrhh_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.registrar_empleado.invoke_arn
}

# El navegador manda x-api-key, que no es una cabecera simple, así que
# toda petición va precedida de un preflight OPTIONS. Sin esto el
# navegador bloquea la respuesta aunque el Lambda conteste bien.
resource "aws_api_gateway_method" "rrhh_options" {
  rest_api_id   = aws_api_gateway_rest_api.api_rrhh.id
  resource_id   = aws_api_gateway_resource.rrhh_root.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "rrhh_options" {
  rest_api_id = aws_api_gateway_rest_api.api_rrhh.id
  resource_id = aws_api_gateway_resource.rrhh_root.id
  http_method = aws_api_gateway_method.rrhh_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "rrhh_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api_rrhh.id
  resource_id = aws_api_gateway_resource.rrhh_root.id
  http_method = aws_api_gateway_method.rrhh_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "rrhh_options" {
  rest_api_id = aws_api_gateway_rest_api.api_rrhh.id
  resource_id = aws_api_gateway_resource.rrhh_root.id
  http_method = aws_api_gateway_method.rrhh_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  # AWS exige que la respuesta de método exista antes: sin ella,
  # PutIntegrationResponse falla con 'No method response exists for
  # method'. La dependencia no se deduce sola porque los dos
  # recursos no se referencian entre sí.
  depends_on = [
    aws_api_gateway_integration.rrhh_options,
    aws_api_gateway_method_response.rrhh_options_200,
  ]
}

resource "aws_api_gateway_deployment" "rrhh_deployment" {
  rest_api_id = aws_api_gateway_rest_api.api_rrhh.id
  stage_name  = "prod"

  # Sin triggers, el despliegue se crea una vez y nunca se vuelve a
  # publicar: la etapa sigue sirviendo una foto vieja aunque cambien los
  # métodos. Es la razón por la que estos APIs respondían 403.
  #
  # No lleva create_before_destroy a propósito. Con stage_name en línea,
  # crear primero el reemplazo choca con la etapa 'prod' que ya existe.
  # El API de liveness, el único de este juego que ya sirve producción,
  # usa triggers sin create_before_destroy y funciona; se iguala eso.
  triggers = {
    redespliegue = sha1(jsonencode([
      aws_api_gateway_resource.rrhh_root,
      aws_api_gateway_method.rrhh_post,
      aws_api_gateway_integration.rrhh_lambda,
      aws_api_gateway_method.rrhh_get,
      aws_api_gateway_integration.rrhh_get,
      aws_api_gateway_method.rrhh_delete,
      aws_api_gateway_integration.rrhh_delete,
      aws_api_gateway_method.rrhh_options,
      aws_api_gateway_integration.rrhh_options,
      aws_api_gateway_method_response.rrhh_options_200,
      aws_api_gateway_integration_response.rrhh_options,
    ]))
  }

  depends_on = [
    aws_api_gateway_integration.rrhh_lambda,
    aws_api_gateway_integration.rrhh_get,
    aws_api_gateway_integration.rrhh_delete,
    aws_api_gateway_integration.rrhh_options,
    aws_api_gateway_method_response.rrhh_options_200,
    aws_api_gateway_integration_response.rrhh_options,
  ]
}

resource "aws_api_gateway_api_key" "rrhh_key" {
  name    = "biosecurity-rrhh-key"
  enabled = true
}

# El plan de uso es lo que hace válida la API key en una etapa. La
# asociación vive en AWS contra la etapa concreta, no contra el nombre
# "prod": cuando un cambio en los triggers reemplaza el despliegue, la
# etapa se borra y se vuelve a crear, y la asociación se queda por el
# camino. Terraform no lo nota porque en su configuración nada cambió:
# sigue diciendo "prod".
#
# El síntoma es desconcertante —200 justo después del apply y 403 unos
# minutos más tarde— porque API Gateway guarda un rato la decisión sobre
# la llave antes de volver a consultarla.
#
# replace_triggered_by vuelve a crear el plan cada vez que el despliegue
# se reemplaza, que es lo único que restablece la asociación. Si alguna
# vez hay que arreglarlo a mano:
#
#   terraform apply -auto-approve \
#     -replace=aws_api_gateway_usage_plan.rrhh_plan \
#     -target=aws_api_gateway_usage_plan.rrhh_plan \
#     -target=aws_api_gateway_usage_plan_key.rrhh_plan_key
#
# La cura de fondo es declarar la etapa como aws_api_gateway_stage
# aparte, que es lo que Terraform viene pidiendo en los avisos de
# obsolescencia: así la etapa sobrevive a los despliegues y nada de esto
# pasa. Eso toca la etapa de liveness, que es producción, así que va en
# su propio momento y no a mitad de una migración.
resource "aws_api_gateway_usage_plan" "rrhh_plan" {
  name = "biosecurity-rrhh-plan"
  api_stages {
    api_id = aws_api_gateway_rest_api.api_rrhh.id
    stage  = aws_api_gateway_deployment.rrhh_deployment.stage_name
  }

  lifecycle {
    replace_triggered_by = [aws_api_gateway_deployment.rrhh_deployment]
  }
}

resource "aws_api_gateway_usage_plan_key" "rrhh_plan_key" {
  key_id        = aws_api_gateway_api_key.rrhh_key.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.rrhh_plan.id
}

# El identificador lleva sufijo -tf a propósito. En los Lambdas ya hay
# una sentencia con el nombre sin sufijo, puesta a mano en abril, y
# apunta al API de abril: por eso AddPermission daba 409 y, al mismo
# tiempo, el API nuevo devolvía 500 —la sentencia existía, pero no
# autorizaba a este API a invocar la función—.
#
# Importar la vieja y dejar que Terraform la reemplace le quitaría el
# permiso al API que hoy sirve producción. Así que se añade una segunda
# sentencia en vez de tocar la primera: durante la convivencia los dos
# APIs pueden invocar el Lambda, que es justo lo que se necesita para
# poder volver atrás. Las sentencias viejas se borran el día que se
# borren los APIs de abril.
resource "aws_lambda_permission" "apigw_rrhh" {
  statement_id  = "AllowAPIGatewayInvokeRRHHtf"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.registrar_empleado.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_rrhh.execution_arn}/*/*"
}

# ─────────────────────────────────────────
# API Gateway auditoria (protegido)
# ─────────────────────────────────────────
resource "aws_api_gateway_rest_api" "api_auditoria" {
  name        = "biosecurity-auditoria-api"
  description = "API protegida para auditoria de accesos"
}

resource "aws_api_gateway_resource" "auditoria_root" {
  rest_api_id = aws_api_gateway_rest_api.api_auditoria.id
  parent_id   = aws_api_gateway_rest_api.api_auditoria.root_resource_id
  path_part   = "reporte"
}

resource "aws_api_gateway_method" "auditoria_get" {
  rest_api_id      = aws_api_gateway_rest_api.api_auditoria.id
  resource_id      = aws_api_gateway_resource.auditoria_root.id
  http_method      = "GET"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "auditoria_lambda" {
  rest_api_id             = aws_api_gateway_rest_api.api_auditoria.id
  resource_id             = aws_api_gateway_resource.auditoria_root.id
  http_method             = aws_api_gateway_method.auditoria_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.auditoria.invoke_arn
}

resource "aws_api_gateway_method" "auditoria_options" {
  rest_api_id   = aws_api_gateway_rest_api.api_auditoria.id
  resource_id   = aws_api_gateway_resource.auditoria_root.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "auditoria_options" {
  rest_api_id = aws_api_gateway_rest_api.api_auditoria.id
  resource_id = aws_api_gateway_resource.auditoria_root.id
  http_method = aws_api_gateway_method.auditoria_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "auditoria_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api_auditoria.id
  resource_id = aws_api_gateway_resource.auditoria_root.id
  http_method = aws_api_gateway_method.auditoria_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "auditoria_options" {
  rest_api_id = aws_api_gateway_rest_api.api_auditoria.id
  resource_id = aws_api_gateway_resource.auditoria_root.id
  http_method = aws_api_gateway_method.auditoria_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  # AWS exige que la respuesta de método exista antes: sin ella,
  # PutIntegrationResponse falla con 'No method response exists for
  # method'. La dependencia no se deduce sola porque los dos
  # recursos no se referencian entre sí.
  depends_on = [
    aws_api_gateway_integration.auditoria_options,
    aws_api_gateway_method_response.auditoria_options_200,
  ]
}

resource "aws_api_gateway_deployment" "auditoria_deployment" {
  rest_api_id = aws_api_gateway_rest_api.api_auditoria.id
  stage_name  = "prod"

  triggers = {
    redespliegue = sha1(jsonencode([
      aws_api_gateway_resource.auditoria_root,
      aws_api_gateway_method.auditoria_get,
      aws_api_gateway_integration.auditoria_lambda,
      aws_api_gateway_method.auditoria_options,
      aws_api_gateway_integration.auditoria_options,
      aws_api_gateway_method_response.auditoria_options_200,
      aws_api_gateway_integration_response.auditoria_options,
    ]))
  }

  depends_on = [
    aws_api_gateway_integration.auditoria_lambda,
    aws_api_gateway_integration.auditoria_options,
    aws_api_gateway_method_response.auditoria_options_200,
    aws_api_gateway_integration_response.auditoria_options,
  ]
}

resource "aws_api_gateway_api_key" "auditoria_key" {
  name    = "biosecurity-auditoria-key"
  enabled = true
}

resource "aws_api_gateway_usage_plan" "auditoria_plan" {
  name = "biosecurity-auditoria-plan"
  api_stages {
    api_id = aws_api_gateway_rest_api.api_auditoria.id
    stage  = aws_api_gateway_deployment.auditoria_deployment.stage_name
  }

  lifecycle {
    replace_triggered_by = [aws_api_gateway_deployment.auditoria_deployment]
  }
}

resource "aws_api_gateway_usage_plan_key" "auditoria_plan_key" {
  key_id        = aws_api_gateway_api_key.auditoria_key.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.auditoria_plan.id
}

resource "aws_lambda_permission" "apigw_auditoria" {
  statement_id  = "AllowAPIGatewayInvokeAuditoriatf"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auditoria.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_auditoria.execution_arn}/*/*"
}

# ─────────────────────────────────────────
# CloudFront
# ─────────────────────────────────────────
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name = aws_s3_bucket_website_configuration.frontend.website_endpoint
    origin_id   = "s3-frontend"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
    min_ttl     = 0
    default_ttl = 300
    max_ttl     = 1200
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Project = "anlusoft-rekognition" }
}

# ─────────────────────────────────────────
# Cognito
# ─────────────────────────────────────────
resource "aws_cognito_user_pool" "biosecurity" {
  name = "biosecurity-users"

  password_policy {
    minimum_length    = 8
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  auto_verified_attributes = []
  tags                     = { Project = "anlusoft-rekognition" }
}

resource "aws_cognito_user_pool_client" "biosecurity_client" {
  name            = "biosecurity-web-client"
  user_pool_id    = aws_cognito_user_pool.biosecurity.id

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  token_validity_units {
    access_token  = "hours"
    refresh_token = "days"
  }

  access_token_validity  = 1
  refresh_token_validity = 1
}

# ─────────────────────────────────────────
# Outputs
# ─────────────────────────────────────────
output "api_rrhh_url" {
  value       = "https://${aws_api_gateway_rest_api.api_rrhh.id}.execute-api.us-east-1.amazonaws.com/prod/registrar"
  description = "URL registro RRHH"
}

output "api_auditoria_url" {
  value       = "https://${aws_api_gateway_rest_api.api_auditoria.id}.execute-api.us-east-1.amazonaws.com/prod/reporte"
  description = "URL reporte auditoria"
}

output "cloudfront_url" {
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
  description = "URL HTTPS del sistema"
}

output "rrhh_api_key" {
  value       = aws_api_gateway_api_key.rrhh_key.value
  sensitive   = true
  description = "API Key RRHH"
}

output "auditoria_api_key" {
  value       = aws_api_gateway_api_key.auditoria_key.value
  sensitive   = true
  description = "API Key auditoria"
}

output "s3_website_url" {
  value = aws_s3_bucket_website_configuration.frontend.website_endpoint
}

output "lambda_name" {
  value = aws_lambda_function.validacion_biometrica.function_name
}

output "rekognition_collection" {
  value = aws_rekognition_collection.coleccion.collection_id
}

output "cognito_user_pool_id" {
  value       = aws_cognito_user_pool.biosecurity.id
  description = "ID del User Pool de Cognito"
}

output "cognito_client_id" {
  value       = aws_cognito_user_pool_client.biosecurity_client.id
  description = "Client ID para el front"
}

output "kms_key_id" {
  value       = aws_kms_key.biosecurity.key_id
  description = "ID de la llave KMS"
}

# ─────────────────────────────────────────
# DynamoDB - Reset codes y usuarios
# ─────────────────────────────────────────
resource "aws_dynamodb_table" "reset_codes" {
  name             = "biosecurity-reset-codes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"
  attribute {
    name = "email"
    type = "S"
  }
  tags = { Project = "anlusoft-rekognition" }
}

resource "aws_dynamodb_table" "usuarios" {
  name             = "biosecurity-usuarios"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"
  attribute {
    name = "email"
    type = "S"
  }
  tags = { Project = "anlusoft-rekognition" }
  # Un plan que quiera recrear esto borraría datos irrecuperables. Así
  # Terraform falla en vez de destruirlo: el error se revisa a mano.
  lifecycle {
    prevent_destroy = true
  }
}

# ─────────────────────────────────────────
# IAM - Política reset (DynamoDB + Gmail SMTP)
# ─────────────────────────────────────────
resource "aws_iam_role_policy" "lambda_reset_policy" {
  name = "biosecurity-reset-policy"
  role = aws_iam_role.lambda_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          # UpdateItem: guardarClave() y el contador de intentos del código
          # de reset escriben con UpdateItem, no con PutItem, para no
          # reemplazar el registro entero y perder el rol y created_at.
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.reset_codes.arn,
          aws_dynamodb_table.usuarios.arn
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail", "ses:VerifyEmailIdentity"]
        Resource = "*"
      }
    ]
  })
}

# ─────────────────────────────────────────
# Lambda reset
# ─────────────────────────────────────────
# El zip antes se daba por existente y nunca se generaba, así que este Lambda
# no se desplegaba desde Terraform.
data "archive_file" "lambda_reset_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda_build/reset.zip"
  excludes    = ["registrar.zip", "function.zip", "auditoria.zip", "liveness.zip", "reset.zip"]
}

resource "aws_lambda_function" "reset" {
  function_name    = "biosecurity-reset"
  filename         = data.archive_file.lambda_reset_zip.output_path
  source_code_hash = data.archive_file.lambda_reset_zip.output_base64sha256
  handler          = "reset.handler"
  runtime          = "nodejs22.x"
  role             = aws_iam_role.lambda_role.arn
  timeout          = 30
  memory_size      = 256

  environment {
    variables = merge(local.observabilidad, {
      TABLA_USUARIOS      = aws_dynamodb_table.usuarios.name
      TABLA_CODIGOS       = aws_dynamodb_table.reset_codes.name
      MODULE_NAME         = "reset"
      MAX_INTENTOS_CODIGO = "5"

      # Horas que vive la contraseña temporal que se envía por correo.
      HORAS_CLAVE_TEMPORAL = "72"

      # Credenciales fuera del código: antes vivían escritas en reset.js, que
      # está versionado. Los valores se pasan por terraform.tfvars, que no se
      # versiona.
      SMTP_USUARIO = var.smtp_usuario
      SMTP_CLAVE   = var.smtp_clave

      # Acceso de emergencia. Se guarda el hash, no la contraseña.
      ADMIN_EMERGENCIA_USUARIO = var.admin_emergencia_usuario
      ADMIN_EMERGENCIA_HASH    = var.admin_emergencia_hash
      ADMIN_EMERGENCIA_CORREO  = var.admin_emergencia_correo
    })
  }

  tags = { Project = "anlusoft-rekognition" }
}

# ─────────────────────────────────────────
# API Gateway reset (público)
# ─────────────────────────────────────────
resource "aws_api_gateway_rest_api" "api_reset" {
  name        = "biosecurity-reset-api"
  description = "API para restablecimiento de contraseña y gestión de usuarios"
}

resource "aws_api_gateway_resource" "reset_root" {
  rest_api_id = aws_api_gateway_rest_api.api_reset.id
  parent_id   = aws_api_gateway_rest_api.api_reset.root_resource_id
  path_part   = "reset"
}

resource "aws_api_gateway_method" "reset_post" {
  rest_api_id   = aws_api_gateway_rest_api.api_reset.id
  resource_id   = aws_api_gateway_resource.reset_root.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "reset_lambda" {
  rest_api_id             = aws_api_gateway_rest_api.api_reset.id
  resource_id             = aws_api_gateway_resource.reset_root.id
  http_method             = aws_api_gateway_method.reset_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.reset.invoke_arn
}

resource "aws_api_gateway_method" "reset_options" {
  rest_api_id   = aws_api_gateway_rest_api.api_reset.id
  resource_id   = aws_api_gateway_resource.reset_root.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "reset_options" {
  rest_api_id = aws_api_gateway_rest_api.api_reset.id
  resource_id = aws_api_gateway_resource.reset_root.id
  http_method = aws_api_gateway_method.reset_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "reset_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api_reset.id
  resource_id = aws_api_gateway_resource.reset_root.id
  http_method = aws_api_gateway_method.reset_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "reset_options" {
  rest_api_id = aws_api_gateway_rest_api.api_reset.id
  resource_id = aws_api_gateway_resource.reset_root.id
  http_method = aws_api_gateway_method.reset_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  # AWS exige que la respuesta de método exista antes: sin ella,
  # PutIntegrationResponse falla con 'No method response exists for
  # method'. La dependencia no se deduce sola porque los dos
  # recursos no se referencian entre sí.
  depends_on = [
    aws_api_gateway_integration.reset_options,
    aws_api_gateway_method_response.reset_options_200,
  ]
}

resource "aws_api_gateway_deployment" "reset_deployment" {
  rest_api_id = aws_api_gateway_rest_api.api_reset.id
  stage_name  = "prod"

  triggers = {
    redespliegue = sha1(jsonencode([
      aws_api_gateway_resource.reset_root,
      aws_api_gateway_method.reset_post,
      aws_api_gateway_integration.reset_lambda,
      aws_api_gateway_method.reset_options,
      aws_api_gateway_integration.reset_options,
      aws_api_gateway_method_response.reset_options_200,
      aws_api_gateway_integration_response.reset_options,
    ]))
  }

  depends_on = [
    aws_api_gateway_integration.reset_lambda,
    aws_api_gateway_integration.reset_options,
    aws_api_gateway_method_response.reset_options_200,
    aws_api_gateway_integration_response.reset_options,
  ]
}

resource "aws_lambda_permission" "apigw_reset" {
  statement_id  = "AllowAPIGatewayInvokeResettf"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reset.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_reset.execution_arn}/*/*"
}

output "api_reset_url" {
  value       = "https://${aws_api_gateway_rest_api.api_reset.id}.execute-api.us-east-1.amazonaws.com/prod/reset"
  description = "URL restablecimiento de contraseña y gestión de usuarios"
}
