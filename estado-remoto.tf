# ─────────────────────────────────────────
# Dónde vive el estado de Terraform
# ─────────────────────────────────────────
# Hasta ahora el estado era un archivo en el portátil de Daniel, fuera
# del repositorio porque contiene secretos. Eso tiene dos problemas que
# ya nos costaron caro:
#
#   Si se pierde, Terraform olvida qué recursos maneja. Es exactamente
#   lo que pasó y por qué un apply intentó crear de nuevo lo que ya
#   existía, dejando catorce API Gateways donde debía haber cinco.
#
#   Y solo se puede desplegar desde esa máquina. CloudShell, otro
#   computador o un pipeline arrancarían con un estado vacío y
#   repetirían el mismo desastre.
#
# En S3 queda versionado: si un apply deja el estado inconsistente, se
# puede volver a la versión anterior. La tabla de DynamoDB evita que dos
# apply simultáneos se pisen.
#
# Estos dos recursos se guardan en el estado que ellos mismos alojan.
# Es circular pero funciona; lo único que no se puede hacer es
# destruirlos con Terraform, y para eso está prevent_destroy.

resource "aws_s3_bucket" "estado" {
  bucket = "biosecurity-tfstate-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }

  tags = { Project = "anlusoft-rekognition" }
}

# Sin versionado, un estado corrupto es un estado perdido.
resource "aws_s3_bucket_versioning" "estado" {
  bucket = aws_s3_bucket.estado.id
  versioning_configuration {
    status = "Enabled"
  }
}

# El estado lleva dentro las variables sensibles en claro: el hash del
# admin de emergencia, la clave del SMTP, las API keys.
resource "aws_s3_bucket_server_side_encryption_configuration" "estado" {
  bucket = aws_s3_bucket.estado.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "estado" {
  bucket = aws_s3_bucket.estado.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Bloqueo durante el apply. Terraform 1.10 trae bloqueo nativo en S3 con
# use_lockfile, pero acá corre 1.9.8, donde sigue siendo esta tabla.
resource "aws_dynamodb_table" "bloqueo_terraform" {
  name         = "biosecurity-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = { Project = "anlusoft-rekognition" }
}

output "bucket_estado" {
  value       = aws_s3_bucket.estado.id
  description = "Bucket donde vive el estado de Terraform"
}
