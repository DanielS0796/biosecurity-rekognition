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
# CloudWatch Log Groups (7 days retention)
# ─────────────────────────────────────────
resource "aws_cloudwatch_log_group" "validacion_logs" {
  name              = "/aws/lambda/validacionderostros"
  retention_in_days = 7
  tags              = { Project = "anlusoft-rekognition", Module = "observability" }
}

resource "aws_cloudwatch_log_group" "registrar_logs" {
  name              = "/aws/lambda/biosecurity-registrar-empleado"
  retention_in_days = 7
  tags              = { Project = "anlusoft-rekognition", Module = "observability" }
}

resource "aws_cloudwatch_log_group" "auditoria_logs" {
  name              = "/aws/lambda/biosecurity-auditoria"
  retention_in_days = 7
  tags              = { Project = "anlusoft-rekognition", Module = "observability" }
}

resource "aws_cloudwatch_log_group" "reset_logs" {
  name              = "/aws/lambda/biosecurity-reset"
  retention_in_days = 7
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
resource "aws_cloudwatch_metric_alarm" "validacion_errors" {
  alarm_name          = "biosecurity-validacion-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 5
  alarm_description   = "Validacion Lambda error rate > 5% in 5 minutes"
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
      dimensions  = { FunctionName = "validacionderostros" }
    }
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = "validacionderostros" }
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
            ["AWS/Lambda", "Invocations", "FunctionName", "validacionderostros"],
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
            ["AWS/Lambda", "Errors", "FunctionName", "validacionderostros"],
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
            ["AWS/Lambda", "Duration", "FunctionName", "validacionderostros", { stat = "p95" }],
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
            ["AWS/Lambda", "Duration", "FunctionName", "validacionderostros", { stat = "p99" }],
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
            ["AWS/Lambda", "Throttles", "FunctionName", "validacionderostros"],
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
