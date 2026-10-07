#!/usr/bin/env bash
#
# Despliega únicamente la pieza de Liveness Detection.
#
# Por qué no un `terraform apply` normal: el estado de Terraform no conoce
# los recursos que ya existen en AWS desde hace meses (tablas, colección,
# rol IAM). Un apply completo intenta crearlos de nuevo, falla con
# "already exists" y en el camino deja APIs duplicados — que es justo lo
# que pasó antes.
#
# Este script primero adopta en el estado lo que ya existe, y después
# aplica solo los recursos de liveness.
#
# Uso:
#   export AWS_ACCESS_KEY_ID=...
#   export AWS_SECRET_ACCESS_KEY=...
#   export AWS_DEFAULT_REGION=us-east-1
#   ./desplegar-liveness.sh

set -uo pipefail

CUENTA="${CUENTA_AWS:-968481485339}"

echo "──────────────────────────────────────────────────"
echo " Paso 1 de 3 — adoptar recursos que ya existen"
echo "──────────────────────────────────────────────────"

# Cada import es opcional: si el recurso ya está en el estado, se salta.
adoptar() {
  local direccion="$1" id="$2"
  if terraform state list 2>/dev/null | grep -qxF "$direccion"; then
    echo "  ya en el estado   $direccion"
    return 0
  fi
  if terraform import -no-color "$direccion" "$id" >/tmp/import.log 2>&1; then
    echo "  adoptado          $direccion"
  else
    echo "  no se pudo        $direccion"
    sed 's/^/                    /' /tmp/import.log | grep -i "error" | head -2
  fi
}

adoptar aws_iam_role.lambda_role              "validacionderostros-role-vfa72p0a"
adoptar aws_rekognition_collection.coleccion  "coleccion2anlusoft"
adoptar aws_dynamodb_table.empleados          "biosecurity-empleados"
adoptar aws_dynamodb_table.retirados          "biosecurity-retirados"
adoptar aws_dynamodb_table.accesos            "biosecurity-accesos"
adoptar aws_dynamodb_table.liveness_sessions  "biosecurity-liveness-sessions"
adoptar aws_s3_bucket.liveness_videos         "biosecurity-liveness-videos-${CUENTA}"

echo
echo "──────────────────────────────────────────────────"
echo " Paso 2 de 3 — aplicar solo los recursos de liveness"
echo "──────────────────────────────────────────────────"

terraform apply -auto-approve \
  -target=aws_lambda_function.liveness \
  -target=aws_iam_role_policy.lambda_liveness_policy \
  -target=aws_api_gateway_rest_api.api_liveness \
  -target=aws_api_gateway_resource.liveness \
  -target=aws_api_gateway_method.liveness_post \
  -target=aws_api_gateway_integration.liveness_post \
  -target=aws_api_gateway_method.liveness_options \
  -target=aws_api_gateway_integration.liveness_options \
  -target=aws_api_gateway_method_response.liveness_options \
  -target=aws_api_gateway_integration_response.liveness_options \
  -target=aws_api_gateway_deployment.liveness_deployment \
  -target=aws_lambda_permission.apigw_liveness \
  -target=aws_cognito_identity_pool.liveness \
  -target=aws_iam_role.liveness_browser \
  -target=aws_iam_role_policy.liveness_browser \
  -target=aws_cognito_identity_pool_roles_attachment.liveness

CODIGO=$?
if [ $CODIGO -ne 0 ]; then
  echo
  echo "El apply falló. Nada más que hacer hasta revisar el error de arriba."
  exit $CODIGO
fi

echo
echo "──────────────────────────────────────────────────"
echo " Paso 3 de 3 — valores para el frontend"
echo "──────────────────────────────────────────────────"
echo
POOL=$(terraform output -raw liveness_identity_pool_id 2>/dev/null)
INIT=$(terraform output -raw api_liveness_init_url 2>/dev/null)
RES=$(terraform output -raw api_liveness_result_url 2>/dev/null)

echo "Identity Pool : $POOL"
echo "Init URL      : $INIT"
echo "Result URL    : $RES"
echo
echo "Pegue esto en frontend/.env.local y en las variables de entorno de Amplify:"
echo
echo "NEXT_PUBLIC_IDENTITY_POOL_ID=$POOL"
echo
