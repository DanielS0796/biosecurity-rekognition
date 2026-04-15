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
resource "aws_rekognition_collection" "coleccion" {
  collection_id = "coleccion2anlusoft"
  tags          = { Project = "anlusoft-rekognition" }
}

# ─────────────────────────────────────────
# DynamoDB
# ─────────────────────────────────────────
resource "aws_dynamodb_table" "empleados" {
  name         = "biosecurity-empleados"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "identificacion"
  attribute {
    name = "identificacion"
    type = "S"
  }
  tags = { Project = "anlusoft-rekognition" }
}

resource "aws_dynamodb_table" "retirados" {
  name         = "biosecurity-retirados"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "identificacion"
  attribute {
    name = "identificacion"
    type = "S"
  }
  tags = { Project = "anlusoft-rekognition" }
}

resource "aws_dynamodb_table" "accesos" {
  name         = "biosecurity-accesos"
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
    variables = {
      COLLECTION_ID = aws_rekognition_collection.coleccion.collection_id
    }
  }
  tags = { Project = "anlusoft-rekognition" }
}

# ─────────────────────────────────────────
# Lambda registro RRHH
# ─────────────────────────────────────────
data "archive_file" "lambda_registrar_zip" {
  type        = "zip"
  source_file = "${path.module}/lambda/registrar.js"
  output_path = "${path.module}/lambda_build/registrar.zip"
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
    variables = {
      COLLECTION_ID   = "coleccion2anlusoft"
      TABLE_EMPLEADOS = aws_dynamodb_table.empleados.name
    }
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
  tags             = { Project = "anlusoft-rekognition" }
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

resource "aws_api_gateway_deployment" "rrhh_deployment" {
  depends_on  = [aws_api_gateway_integration.rrhh_lambda]
  rest_api_id = aws_api_gateway_rest_api.api_rrhh.id
  stage_name  = "prod"
}

resource "aws_api_gateway_api_key" "rrhh_key" {
  name    = "biosecurity-rrhh-key"
  enabled = true
}

resource "aws_api_gateway_usage_plan" "rrhh_plan" {
  name = "biosecurity-rrhh-plan"
  api_stages {
    api_id = aws_api_gateway_rest_api.api_rrhh.id
    stage  = aws_api_gateway_deployment.rrhh_deployment.stage_name
  }
}

resource "aws_api_gateway_usage_plan_key" "rrhh_plan_key" {
  key_id        = aws_api_gateway_api_key.rrhh_key.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.rrhh_plan.id
}

resource "aws_lambda_permission" "apigw_rrhh" {
  statement_id  = "AllowAPIGatewayInvokeRRHH"
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

resource "aws_api_gateway_deployment" "auditoria_deployment" {
  depends_on  = [aws_api_gateway_integration.auditoria_lambda]
  rest_api_id = aws_api_gateway_rest_api.api_auditoria.id
  stage_name  = "prod"
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
}

resource "aws_api_gateway_usage_plan_key" "auditoria_plan_key" {
  key_id        = aws_api_gateway_api_key.auditoria_key.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.auditoria_plan.id
}

resource "aws_lambda_permission" "apigw_auditoria" {
  statement_id  = "AllowAPIGatewayInvokeAuditoria"
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
  name         = "biosecurity-web-client"
  user_pool_id = aws_cognito_user_pool.biosecurity.id

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
output "api_url" {
  value       = "https://${aws_api_gateway_rest_api.api.id}.execute-api.us-east-1.amazonaws.com/best/validar"
  description = "URL validacion biometrica"
}

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
  name         = "biosecurity-reset-codes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"
  attribute {
    name = "email"
    type = "S"
  }
  tags = { Project = "anlusoft-rekognition" }
}

resource "aws_dynamodb_table" "usuarios" {
  name         = "biosecurity-usuarios"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"
  attribute {
    name = "email"
    type = "S"
  }
  tags = { Project = "anlusoft-rekognition" }
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
resource "aws_lambda_function" "reset" {
  function_name = "biosecurity-reset"
  filename      = "${path.module}/lambda_build/reset.zip"
  handler       = "reset.handler"
  runtime       = "nodejs22.x"
  role          = aws_iam_role.lambda_role.arn
  timeout       = 30
  memory_size   = 256
  tags          = { Project = "anlusoft-rekognition" }
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
  depends_on = [aws_api_gateway_integration.reset_options]
}

resource "aws_api_gateway_deployment" "reset_deployment" {
  depends_on  = [aws_api_gateway_integration.reset_lambda, aws_api_gateway_integration.reset_options]
  rest_api_id = aws_api_gateway_rest_api.api_reset.id
  stage_name  = "prod"
}

resource "aws_lambda_permission" "apigw_reset" {
  statement_id  = "AllowAPIGatewayInvokeReset"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reset.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_reset.execution_arn}/*/*"
}

output "api_reset_url" {
  value       = "https://${aws_api_gateway_rest_api.api_reset.id}.execute-api.us-east-1.amazonaws.com/prod/reset"
  description = "URL restablecimiento de contraseña y gestión de usuarios"
}
