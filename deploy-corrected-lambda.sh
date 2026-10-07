#!/bin/bash

# Script de despliegue corregido para AWS Lambda - Biosecurity Liveness Detection
# Sintaxis de Sentry corregida: const Sentry = require("@sentry/aws-serverless");

set -e

echo "🔧 Desplegando Lambda con sintaxis corregida..."
echo "================================================"

cd /tmp/biosecurity-rekognition || mkdir -p /tmp/biosecurity-rekognition && cd /tmp/biosecurity-rekognition

# Copiar el zip desde CloudShell o descargar desde el repositorio
echo "📦 Descargando el código del repositorio..."
if [ ! -d "lambda" ]; then
  git clone https://github.com/AnluSoft/biosecurity-rekognition.git . 2>/dev/null || true
fi

# Entrar al directorio lambda y recrear el zip
echo "📝 Recreando el archivo zip desde la estructura correcta..."
cd lambda

# Remover zip anterior si existe
rm -f ../lambda-liveness.zip

# Crear el zip con la estructura correcta (archivos en raíz)
zip -r ../lambda-liveness.zip liveness.js node_modules/ -q

echo "✅ Archivo zip creado: $(ls -lh ../lambda-liveness.zip | awk '{print $5}')"

echo ""
echo "🚀 Actualizando Lambda function 'biosecurity-liveness'..."
cd /tmp/biosecurity-rekognition

aws lambda update-function-code \
  --function-name biosecurity-liveness \
  --zip-file fileb://lambda-liveness.zip \
  --region us-east-1

echo "✅ Lambda function actualizada"

echo ""
echo "🧪 Esperando a que Lambda esté lista..."
sleep 3

echo "🧪 Probando endpoint /liveness-init..."
RESPONSE=$(curl -s -X POST https://4lq3kxldzc.execute-api.us-east-1.amazonaws.com/prod/liveness-init \
  -H "Content-Type: application/json" \
  -d '{}')

echo "Respuesta: $RESPONSE"

# Verificar si la respuesta contiene session_id (éxito) o error
if echo "$RESPONSE" | grep -q "session_id"; then
  echo ""
  echo "✅ ¡ÉXITO! El endpoint /liveness-init está funcionando correctamente"
  echo "La sesión de liveness se creó exitosamente"
elif echo "$RESPONSE" | grep -q "Internal server error"; then
  echo ""
  echo "❌ Error: El endpoint devuelve 'Internal server error'"
  echo "Verificando logs de CloudWatch..."
  aws logs tail /aws/lambda/biosecurity-liveness --follow --region us-east-1 &
  TAIL_PID=$!
  sleep 5
  kill $TAIL_PID 2>/dev/null || true
else
  echo ""
  echo "⚠️  Respuesta inesperada: $RESPONSE"
fi

echo ""
echo "================================================"
echo "Despliegue completado"
