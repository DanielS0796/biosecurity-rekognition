# ─────────────────────────────────────────
# Lambda Liveness Detection
# ─────────────────────────────────────────
data "archive_file" "lambda_liveness_zip" {
  type        = "zip"
  source_file = "${path.module}/lambda/liveness.js"
  output_path = "${path.module}/lambda_build/liveness.zip"
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
      TABLE_LIVENESS  = aws_dynamodb_table.liveness_sessions.name
      TABLE_EMPLEADOS = aws_dynamodb_table.empleados.name
      TABLE_ACCESOS   = aws_dynamodb_table.accesos.name
      COLLECTION_ID   = aws_rekognition_collection.coleccion.collection_id
      SENTRY_DSN      = "https://placeholder@sentry.io/1"
      MODULE_NAME     = "liveness-detection"
    }
  }

  tags = { Project = "anlusoft-rekognition" }
}

# ─────────────────────────────────────────
# API Gateway Liveness (público)
# ─────────────────────────────────────────
resource "aws_api_gateway_rest_api" "api_liveness" {
  name        = "biosecurity-liveness-api"
  description = "API para Liveness Detection con Rekognition"
}

# Recurso: /liveness-init
resource "aws_api_gateway_resource" "liveness_init" {
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  parent_id   = aws_api_gateway_rest_api.api_liveness.root_resource_id
  path_part   = "liveness-init"
}

# Method: POST /liveness-init
resource "aws_api_gateway_method" "liveness_init_post" {
  rest_api_id   = aws_api_gateway_rest_api.api_liveness.id
  resource_id   = aws_api_gateway_resource.liveness_init.id
  http_method   = "POST"
  authorization = "NONE"
}

# Integration: POST /liveness-init -> Lambda
resource "aws_api_gateway_integration" "liveness_init_lambda" {
  rest_api_id             = aws_api_gateway_rest_api.api_liveness.id
  resource_id             = aws_api_gateway_resource.liveness_init.id
  http_method             = aws_api_gateway_method.liveness_init_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.liveness.invoke_arn
}

# Method: OPTIONS /liveness-init (CORS)
resource "aws_api_gateway_method" "liveness_init_options" {
  rest_api_id   = aws_api_gateway_rest_api.api_liveness.id
  resource_id   = aws_api_gateway_resource.liveness_init.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

# Integration: OPTIONS /liveness-init
resource "aws_api_gateway_integration" "liveness_init_options" {
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  resource_id = aws_api_gateway_resource.liveness_init.id
  http_method = aws_api_gateway_method.liveness_init_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

# Response: OPTIONS /liveness-init
resource "aws_api_gateway_method_response" "liveness_init_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  resource_id = aws_api_gateway_resource.liveness_init.id
  http_method = aws_api_gateway_method.liveness_init_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

# Integration Response: OPTIONS /liveness-init
resource "aws_api_gateway_integration_response" "liveness_init_options" {
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  resource_id = aws_api_gateway_resource.liveness_init.id
  http_method = aws_api_gateway_method.liveness_init_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.liveness_init_options]
}

# Recurso: /validar
resource "aws_api_gateway_resource" "liveness_validar" {
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  parent_id   = aws_api_gateway_rest_api.api_liveness.root_resource_id
  path_part   = "validar"
}

# Method: POST /validar
resource "aws_api_gateway_method" "liveness_validar_post" {
  rest_api_id   = aws_api_gateway_rest_api.api_liveness.id
  resource_id   = aws_api_gateway_resource.liveness_validar.id
  http_method   = "POST"
  authorization = "NONE"
}

# Integration: POST /validar -> Lambda
resource "aws_api_gateway_integration" "liveness_validar_lambda" {
  rest_api_id             = aws_api_gateway_rest_api.api_liveness.id
  resource_id             = aws_api_gateway_resource.liveness_validar.id
  http_method             = aws_api_gateway_method.liveness_validar_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.liveness.invoke_arn
}

# Method: OPTIONS /validar (CORS)
resource "aws_api_gateway_method" "liveness_validar_options" {
  rest_api_id   = aws_api_gateway_rest_api.api_liveness.id
  resource_id   = aws_api_gateway_resource.liveness_validar.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

# Integration: OPTIONS /validar
resource "aws_api_gateway_integration" "liveness_validar_options" {
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  resource_id = aws_api_gateway_resource.liveness_validar.id
  http_method = aws_api_gateway_method.liveness_validar_options.http_method
  type        = "MOCK"
  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

# Response: OPTIONS /validar
resource "aws_api_gateway_method_response" "liveness_validar_options_200" {
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  resource_id = aws_api_gateway_resource.liveness_validar.id
  http_method = aws_api_gateway_method.liveness_validar_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

# Integration Response: OPTIONS /validar
resource "aws_api_gateway_integration_response" "liveness_validar_options" {
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  resource_id = aws_api_gateway_resource.liveness_validar.id
  http_method = aws_api_gateway_method.liveness_validar_options.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
  depends_on = [aws_api_gateway_integration.liveness_validar_options]
}

# Deployment
resource "aws_api_gateway_deployment" "liveness_deployment" {
  depends_on  = [
    aws_api_gateway_integration.liveness_init_lambda,
    aws_api_gateway_integration.liveness_init_options,
    aws_api_gateway_integration.liveness_validar_lambda,
    aws_api_gateway_integration.liveness_validar_options
  ]
  rest_api_id = aws_api_gateway_rest_api.api_liveness.id
  stage_name  = "prod"
}

# Lambda Permission
resource "aws_lambda_permission" "apigw_liveness" {
  statement_id  = "AllowAPIGatewayInvokeLiveness"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.liveness.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api_liveness.execution_arn}/*/*"
}

# ─────────────────────────────────────────
# Output URLs
# ─────────────────────────────────────────
output "api_liveness_init_url" {
  value       = "https://${aws_api_gateway_rest_api.api_liveness.id}.execute-api.us-east-1.amazonaws.com/prod/liveness-init"
  description = "URL para inicializar sesión de liveness detection"
}

output "api_liveness_validar_url" {
  value       = "https://${aws_api_gateway_rest_api.api_liveness.id}.execute-api.us-east-1.amazonaws.com/prod/validar"
  description = "URL para validar liveness y buscar rostro en Rekognition"
}
