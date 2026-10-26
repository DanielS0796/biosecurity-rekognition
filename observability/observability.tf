# ═════════════════════════════════════════════════════════════
# OBSERVABILITY MODULE - Phase 1, 2, 3
# Sentry + CloudWatch + SNS Alerts
# ═════════════════════════════════════════════════════════════

variable "alert_email" {
  description = "Email for CloudWatch alarms"
  type        = string
  default     = "biosecurityucompensar@gmail.com"
}

# ─────────────────────────────────────────
# CloudWatch Log Groups (90 días)
# ─────────────────────────────────────────
# Eran 7 días. El 25 de octubre de 2026 se quiso revisar qué causó los
# 5xx del 8 de octubre y los logs ya no existían. En un control de acceso
# la pregunta "¿qué pasó tal día?" llega semanas después. 90 días
# coincide con lo que se guardan los intentos rechazados y cuesta
# centavos con este volumen.
locals {
  dias_logs = 90
}

# El grupo de liveness lo creó Lambda sola y quedó sin vencimiento: se
# guardaba para siempre, con identificaciones en los logs. Se importa
# para que tenga el mismo plazo que los demás.
import {
  to = aws_cloudwatch_log_group.liveness_logs
  id = "/aws/lambda/biosecurity-liveness-detection"
}

resource "aws_cloudwatch_log_group" "liveness_logs" {
  name              = "/aws/lambda/biosecurity-liveness-detection"
  retention_in_days = local.dias_logs
  tags              = { Project = "anlusoft-rekognition", Module = "observability" }
}

resource "aws_cloudwatch_log_group" "validacion_logs" {
  name              = "/aws/lambda/validacionderostros"
  retention_in_days = local.dias_logs
  tags              = { Project = "anlusoft-rekognition", Module = "observability" }
}

resource "aws_cloudwatch_log_group" "registrar_logs" {
  name              = "/aws/lambda/biosecurity-registrar-empleado"
  retention_in_days = local.dias_logs
  tags              = { Project = "anlusoft-rekognition", Module = "observability" }
}

resource "aws_cloudwatch_log_group" "auditoria_logs" {
  name              = "/aws/lambda/biosecurity-auditoria"
  retention_in_days = local.dias_logs
  tags              = { Project = "anlusoft-rekognition", Module = "observability" }
}

resource "aws_cloudwatch_log_group" "reset_logs" {
  name              = "/aws/lambda/biosecurity-reset"
  retention_in_days = local.dias_logs
  tags              = { Project = "anlusoft-rekognition", Module = "observability" }
}

# ─────────────────────────────────────────
# SNS Topic for Alerts
# ─────────────────────────────────────────
resource "aws_sns_topic" "alerts" {
  name = "biosecurity-alerts-topic"
  tags = { Project = "anlusoft-rekognition", Module = "observability" }
}

resource "aws_sns_topic_subscription" "email_alert" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ─────────────────────────────────────────
# CloudWatch Alarms (error rate > 5%)
# ─────────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "liveness_errors" {
  alarm_name          = "biosecurity-liveness-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  alarm_description   = "Liveness Lambda error rate > 5% in 5 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "(errors / invocations) * 100"
    label       = "Error Rate"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "Errors"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = "biosecurity-liveness-detection" }
    }
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = "biosecurity-liveness-detection" }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "registrar_errors" {
  alarm_name          = "biosecurity-registrar-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  alarm_description   = "Registrar Lambda error rate > 5% in 5 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "(errors / invocations) * 100"
    label       = "Error Rate"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "Errors"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = "biosecurity-registrar-empleado" }
    }
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = "biosecurity-registrar-empleado" }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "auditoria_errors" {
  alarm_name          = "biosecurity-auditoria-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  alarm_description   = "Auditoria Lambda error rate > 5% in 5 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "(errors / invocations) * 100"
    label       = "Error Rate"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "Errors"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = "biosecurity-auditoria" }
    }
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = "biosecurity-auditoria" }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "reset_errors" {
  alarm_name          = "biosecurity-reset-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  alarm_description   = "Reset Lambda error rate > 5% in 5 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "(errors / invocations) * 100"
    label       = "Error Rate"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "Errors"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = "biosecurity-reset" }
    }
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = "biosecurity-reset" }
    }
  }
}

# ─────────────────────────────────────────
# CloudWatch Dashboard
# ─────────────────────────────────────────
resource "aws_cloudwatch_dashboard" "biosecurity" {
  dashboard_name = "biosecurity-dashboard"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", "biosecurity-liveness-detection"],
            [".", ".", ".", "biosecurity-registrar-empleado"],
            [".", ".", ".", "biosecurity-auditoria"],
            [".", ".", ".", "biosecurity-reset"]
          ]
          period = 300
          stat   = "Sum"
          region = "us-east-1"
          title  = "Lambda Invocations"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", "biosecurity-liveness-detection"],
            [".", ".", ".", "biosecurity-registrar-empleado"],
            [".", ".", ".", "biosecurity-auditoria"],
            [".", ".", ".", "biosecurity-reset"]
          ]
          period = 300
          stat   = "Sum"
          region = "us-east-1"
          title  = "Lambda Errors"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", "biosecurity-liveness-detection", { stat = "p95" }],
            ["...", "biosecurity-registrar-empleado", { stat = "p95" }],
            ["...", "biosecurity-auditoria", { stat = "p95" }],
            ["...", "biosecurity-reset", { stat = "p95" }]
          ]
          period = 300
          region = "us-east-1"
          title  = "Lambda Duration P95 (ms)"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", "biosecurity-liveness-detection", { stat = "p99" }],
            ["...", "biosecurity-registrar-empleado", { stat = "p99" }],
            ["...", "biosecurity-auditoria", { stat = "p99" }],
            ["...", "biosecurity-reset", { stat = "p99" }]
          ]
          period = 300
          region = "us-east-1"
          title  = "Lambda Duration P99 (ms)"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 24
        height = 6
        properties = {
          metrics = [
            ["AWS/Lambda", "Throttles", "FunctionName", "biosecurity-liveness-detection"],
            [".", ".", ".", "biosecurity-registrar-empleado"],
            [".", ".", ".", "biosecurity-auditoria"],
            [".", ".", ".", "biosecurity-reset"]
          ]
          period = 300
          stat   = "Sum"
          region = "us-east-1"
          title  = "Lambda Throttles"
          view   = "timeSeries"
        }
      }
    ]
  })
}

# ─────────────────────────────────────────
# Provider (necesario para archivo standalone)
# ─────────────────────────────────────────
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
# Outputs
# ─────────────────────────────────────────
output "sns_alerts_topic_arn" {
  value       = aws_sns_topic.alerts.arn
  description = "SNS topic for alerts"
}

output "cloudwatch_dashboard_url" {
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=${aws_cloudwatch_dashboard.biosecurity.dashboard_name}"
  description = "CloudWatch dashboard URL"
}

# ─────────────────────────────────────────
# Alarmas que la tasa de errores no ve
# ─────────────────────────────────────────
# Una solicitud estrangulada (throttle) nunca llega a ejecutar la función,
# así que no suma en Invocations ni en Errors: solo sube Throttles.
resource "aws_cloudwatch_metric_alarm" "liveness_throttles" {
  alarm_name          = "biosecurity-liveness-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  alarm_description   = "Liveness Lambda throttled at least once in 5 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_name = "Throttles"
  namespace   = "AWS/Lambda"
  period      = 300
  statistic   = "Sum"
  dimensions  = { FunctionName = "biosecurity-liveness-detection" }
}

# Los 500 que la función atrapa en su try/catch cuentan como invocaciones
# exitosas para Lambda. API Gateway sí los ve, igual que los throttles.
resource "aws_cloudwatch_metric_alarm" "liveness_api_5xx" {
  alarm_name          = "biosecurity-liveness-api-5xx-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  alarm_description   = "Liveness API 5XX rate > 5% in 5 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "tasa_5xx"
    expression  = "(e5xx / total) * 100"
    label       = "5XX Rate"
    return_data = true
  }

  metric_query {
    id = "e5xx"
    metric {
      metric_name = "5XXError"
      namespace   = "AWS/ApiGateway"
      period      = 300
      stat        = "Sum"
      dimensions  = { ApiName = "biosecurity-liveness-api", Stage = "prod" }
    }
  }

  metric_query {
    id = "total"
    metric {
      metric_name = "Count"
      namespace   = "AWS/ApiGateway"
      period      = 300
      stat        = "Sum"
      dimensions  = { ApiName = "biosecurity-liveness-api", Stage = "prod" }
    }
  }
}

# ─────────────────────────────────────────
# Presupuesto
# ─────────────────────────────────────────
# Cada escaneo de Face Liveness se cobra, y la API que los abre es
# pública porque en la portería nadie inicia sesión. El WAF limita lo
# que puede pedir una sola dirección IP, pero no a alguien con muchas.
# Lo que queda es enterarse a tiempo: este presupuesto avisa por correo
# cuando el gasto real del mes pasa del 80 % y cuando la proyección del
# mes completo pasa del 100 %.
#
# El valor por defecto sale de lo que cuesta hoy el sistema en reposo:
# unos 9 USD del WAF, 1 USD de la llave KMS y unos pocos dólares de
# Rekognition y Amplify. Cubre la cuenta entera, no solo los recursos del
# proyecto, así que también avisa si alguien deja encendido algo ajeno.
# Los dos primeros presupuestos de una cuenta no cuestan nada.
variable "presupuesto_mensual_usd" {
  description = "Tope mensual de gasto de la cuenta, en dólares, para la alarma de presupuesto"
  type        = string
  default     = "25"
}

resource "aws_budgets_budget" "mensual" {
  name         = "biosecurity-mensual"
  budget_type  = "COST"
  limit_amount = var.presupuesto_mensual_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

# ─────────────────────────────────────────
# Alguien está abriendo sesiones de liveness en bucle
# ─────────────────────────────────────────
# El presupuesto avisa cuando ya se gastó; esta alarma avisa en el
# momento, en cuanto el WAF bloquea por la regla de sesiones de liveness.
# En uso normal nunca dispara: dos puertas no llegan ni cerca del límite.
resource "aws_cloudwatch_metric_alarm" "liveness_waf_limite" {
  alarm_name          = "biosecurity-liveness-limite-waf"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  alarm_description   = "El WAF bloqueó solicitudes por exceder el límite de sesiones de liveness"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  metric_name = "BlockedRequests"
  namespace   = "AWS/WAFV2"
  period      = 300
  statistic   = "Sum"
  dimensions = {
    WebACL = "biosecurity-apis"
    Rule   = "limite-sesiones-liveness"
    Region = "us-east-1"
  }
}
