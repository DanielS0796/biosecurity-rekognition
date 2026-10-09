# ─────────────────────────────────────────
# WAF delante de los APIs
# ─────────────────────────────────────────
# Hasta ahora la única puerta de los APIs era la API key, y una llave que
# viaja en el JavaScript del navegador la puede leer cualquiera que abra
# las herramientas de desarrollo. Eso no se arregla con un WAF, pero el
# WAF sí cubre lo que la llave no cubre: inyección, rutas de ataque
# conocidas y alguien golpeando el endpoint miles de veces por minuto.
#
# Un solo web ACL para los cuatro APIs. Se puede asociar a varias etapas
# a la vez y así se paga una sola vez: el costo es 5 USD al mes por el
# ACL, 1 USD por regla y 0,60 USD por millón de peticiones. Con las tres
# reglas de acá son 8 USD al mes, que es la cifra que va al presupuesto.
#
# La acción por defecto es permitir. Un WAF que empieza bloqueando todo
# deja la portería cerrada el día que una regla nueva se equivoca.
#
# Lo que este ACL no cubre, dicho de frente: inyección de SQL. Esa vive
# en AWSManagedRulesSQLiRuleSet, un grupo aparte que no pusimos porque
# acá no hay motor SQL —los datos están en DynamoDB y los Lambdas
# consultan con el SDK, no armando cadenas—. Si hace falta decir que
# está cubierta, es un dólar más al mes.

resource "aws_wafv2_web_acl" "apis" {
  name        = "biosecurity-apis"
  description = "Protege los APIs de registro, auditoría, autenticación y liveness"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # ── Reglas comunes de AWS ──────────────────────────────────────────
  # Inyección de SQL, XSS, recorrido de rutas, cabeceras malformadas.
  #
  # SizeRestrictions_BODY va en 'count' y no en 'block' a propósito: esa
  # regla bloquea cuerpos de más de 8 KB, y el registro de una persona
  # manda la fotografía en base64 dentro del JSON, que pesa bastante
  # más. Dejarla bloqueando rompería el alta de personas. Queda contando
  # para que aparezca en las métricas sin tumbar nada.
  rule {
    name     = "reglas-comunes"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "reglas-comunes"
      sampled_requests_enabled   = true
    }
  }

  # ── Entradas conocidas como maliciosas ─────────────────────────────
  # Cargas que explotan vulnerabilidades concretas: Log4Shell, intentos
  # de leer el metadata de EC2, deserialización de Java.
  rule {
    name     = "entradas-maliciosas"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "entradas-maliciosas"
      sampled_requests_enabled   = true
    }
  }

  # ── Límite por dirección IP ────────────────────────────────────────
  # El límite es alto a propósito. Toda la universidad sale a internet
  # por unas pocas direcciones, así que para el WAF el campus entero
  # parece una sola IP: un límite estrecho dejaría sin acceso a todo el
  # mundo en hora pico. 2000 peticiones cada cinco minutos pasa
  # holgadamente el uso normal y corta un bucle o un script.
  rule {
    name     = "limite-por-ip"
    priority = 3

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "limite-por-ip"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "biosecurity-apis"
    sampled_requests_enabled   = true
  }

  tags = { Project = "anlusoft-rekognition" }
}

# ─────────────────────────────────────────
# Registro de lo que el WAF bloquea
# ─────────────────────────────────────────
# Las métricas de CloudWatch dicen cuántas peticiones se bloquearon; el
# registro dice cuáles. Para la tesis sirve lo segundo: es la evidencia
# de que la capa existe y actúa.
#
# El nombre tiene que empezar por 'aws-waf-logs-'. No es una convención:
# WAF rechaza cualquier otro destino.
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-biosecurity"
  retention_in_days = 7

  tags = { Project = "anlusoft-rekognition" }
}

# WAF escribe en el grupo con su propia identidad de servicio, así que
# necesita permiso explícito sobre el grupo. Sin esto la configuración
# de registro falla al crearse.
resource "aws_cloudwatch_log_resource_policy" "waf" {
  policy_name     = "biosecurity-waf-logs"
  policy_document = data.aws_iam_policy_document.waf_logs.json
}

data "aws_iam_policy_document" "waf_logs" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.waf.arn}:*"]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_wafv2_web_acl_logging_configuration" "apis" {
  resource_arn            = aws_wafv2_web_acl.apis.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  # El registro guarda cabeceras y cadena de consulta. Las dos llevan
  # datos que no deberían quedar escritos en texto plano:
  #
  #   x-api-key es la llave del API.
  #   La cadena de consulta lleva la cédula: ?identificacion=1234567.
  #
  # La cédula es un dato personal, y guardarla en un registro que nadie
  # va a leer contradice lo que le prometemos a la persona en la
  # autorización de tratamiento. Se tachan las dos.
  #
  # El cuerpo de la petición no se registra nunca, así que las
  # contraseñas del login y las fotografías no pasan por acá.
  redacted_fields {
    single_header {
      name = "x-api-key"
    }
  }

  redacted_fields {
    query_string {}
  }

  depends_on = [aws_cloudwatch_log_resource_policy.waf]
}

# ─────────────────────────────────────────
# A qué etapas se asocia
# ─────────────────────────────────────────
# El ARN de una etapa de API Gateway no es un atributo de ningún recurso
# acá: las etapas se crean dentro del aws_api_gateway_deployment, no
# aparte. Se arma a mano, que es estable y documentado.
locals {
  etapa_arn = {
    rrhh      = "arn:aws:apigateway:${data.aws_region.actual.name}::/restapis/${aws_api_gateway_rest_api.api_rrhh.id}/stages/${aws_api_gateway_deployment.rrhh_deployment.stage_name}"
    auditoria = "arn:aws:apigateway:${data.aws_region.actual.name}::/restapis/${aws_api_gateway_rest_api.api_auditoria.id}/stages/${aws_api_gateway_deployment.auditoria_deployment.stage_name}"
    reset     = "arn:aws:apigateway:${data.aws_region.actual.name}::/restapis/${aws_api_gateway_rest_api.api_reset.id}/stages/${aws_api_gateway_deployment.reset_deployment.stage_name}"
    liveness  = "arn:aws:apigateway:${data.aws_region.actual.name}::/restapis/${aws_api_gateway_rest_api.api_liveness.id}/stages/${aws_api_gateway_deployment.liveness_deployment.stage_name}"
  }
}

data "aws_region" "actual" {}

# Estos tres todavía no reciben tráfico: si una regla se equivoca, se ve
# con curl y no en la cara de nadie.
resource "aws_wafv2_web_acl_association" "rrhh" {
  resource_arn = local.etapa_arn.rrhh
  web_acl_arn  = aws_wafv2_web_acl.apis.arn
}

resource "aws_wafv2_web_acl_association" "auditoria" {
  resource_arn = local.etapa_arn.auditoria
  web_acl_arn  = aws_wafv2_web_acl.apis.arn
}

resource "aws_wafv2_web_acl_association" "reset" {
  resource_arn = local.etapa_arn.reset
  web_acl_arn  = aws_wafv2_web_acl.apis.arn
}

# Liveness es el único de los cuatro que ya sirve producción: es la
# puerta por donde entra la gente todos los días. Se protege aparte,
# cuando los otros tres lleven unos días con el WAF encima sin bloquear
# nada legítimo.
#
#   terraform apply -var proteger_liveness=true
resource "aws_wafv2_web_acl_association" "liveness" {
  count = var.proteger_liveness ? 1 : 0

  resource_arn = local.etapa_arn.liveness
  web_acl_arn  = aws_wafv2_web_acl.apis.arn
}

output "waf_web_acl" {
  value       = aws_wafv2_web_acl.apis.name
  description = "Nombre del web ACL que protege los APIs"
}
