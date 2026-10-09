#!/usr/bin/env bash
#
# Despliega el Liveness Detection y los Lambdas de auditoría y autenticación.
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

# ── Chequeo previo ────────────────────────────────────────────────────
# Las credenciales viven en la shell, no en el repo. Al abrir una
# terminal nueva se pierden y el apply fallaba después de 3 pasos con
# "No valid credential sources found". Mejor avisar acá, en dos segundos.
#
# El CLI de aws no está instalado en todas las máquinas, así que primero
# se mira si hay credenciales de alguna forma (variables de entorno o
# ~/.aws/credentials) y solo se usa `aws sts` si existe, para confirmar
# que además son válidas.
hay_credenciales() {
  [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] && return 0
  [ -n "${AWS_PROFILE:-}" ] && return 0
  [ -s "${HOME}/.aws/credentials" ] && return 0
  return 1
}

if ! hay_credenciales; then
  cat <<'FIN'
No hay credenciales de AWS en esta terminal.

Expórtalas y vuelve a correr el script:

  export AWS_ACCESS_KEY_ID="..."
  export AWS_SECRET_ACCESS_KEY="..."
  export AWS_DEFAULT_REGION="us-east-1"
  ./desplegar-liveness.sh

Se pierden cada vez que cierras la terminal: es a propósito, así no
quedan escritas en ningún archivo del repo.
FIN
  exit 1
fi

if command -v aws >/dev/null 2>&1; then
  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "Hay credenciales de AWS, pero AWS las rechaza."
    echo "Revisa que no estén vencidas o con un typo, y vuelve a intentar."
    exit 1
  fi
fi

if [ ! -f terraform.tfvars ]; then
  echo "Falta terraform.tfvars (claves SMTP y admin de emergencia)."
  echo "Cópialo del ejemplo:  cp terraform.tfvars.ejemplo terraform.tfvars"
  exit 1
fi

echo "──────────────────────────────────────────────────"
echo " Paso 1 de 5 — dependencias del Lambda"
echo "──────────────────────────────────────────────────"

# El Lambda se empaqueta con source_dir, así que node_modules tiene que
# existir antes del apply. No se versiona: se instala acá.
if [ -f lambda/package.json ]; then
  ( cd lambda && npm install --omit=dev --no-audit --no-fund ) \
    && echo "  dependencias listas" \
    || { echo "  falló npm install en lambda/ — el zip saldría incompleto"; exit 1; }
else
  echo "  no hay lambda/package.json, se omite"
fi

echo
echo "──────────────────────────────────────────────────"
echo " Comprobaciones antes de tocar AWS"
echo "──────────────────────────────────────────────────"

# Dos cosas que los dobles de las pruebas no pueden ver, porque no son
# AWS: que cada Lambda tenga los permisos de IAM que su código usa, y
# que su zip lleve las dependencias que su código importa. Las dos ya
# rompieron producción una vez.
for comprobacion in pruebas/permisos/prueba.js pruebas/empaquetado/prueba.js; do
  if [ -f "$comprobacion" ]; then
    if ! node "$comprobacion"; then
      echo "Se detiene antes de aplicar. Revisa lo de arriba."
      exit 1
    fi
  fi
done

echo "──────────────────────────────────────────────────"
echo " Paso 2 de 5 — adoptar recursos que ya existen"
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
adoptar aws_dynamodb_table.usuarios           "biosecurity-usuarios"
adoptar aws_dynamodb_table.reset_codes        "biosecurity-reset-codes"
adoptar aws_s3_bucket.liveness_videos         "biosecurity-liveness-videos-${CUENTA}"
adoptar aws_lambda_function.auditoria         "biosecurity-auditoria"
adoptar aws_lambda_function.registrar_empleado "biosecurity-registrar-empleado"
adoptar aws_lambda_function.validacion_biometrica "validacionderostros"
adoptar aws_lambda_function.reset             "biosecurity-reset"

echo
echo "──────────────────────────────────────────────────"
echo " Paso 3 de 5 — migrar direcciones viejas del estado"
echo "──────────────────────────────────────────────────"

# El primer intento de despliegue creó /liveness-init y /validar con los
# nombres individuales del código anterior. Ahora esas rutas se declaran con
# for_each, así que cambiaron de dirección en el estado. Renombrarlas evita
# que Terraform intente crear en AWS algo que ya está ahí (error 409).
migrar() {
  local viejo="$1" nuevo="$2"
  local lista
  lista=$(terraform state list 2>/dev/null)
  if ! grep -qxF "$viejo" <<< "$lista"; then
    return 0
  fi
  if grep -qxF "$nuevo" <<< "$lista"; then
    echo "  destino ocupado, se descarta el viejo   $viejo"
    terraform state rm -no-color "$viejo" >/dev/null 2>&1
    return 0
  fi
  if terraform state mv -no-color "$viejo" "$nuevo" >/dev/null 2>&1; then
    echo "  migrado   $viejo"
  else
    echo "  no se pudo migrar   $viejo"
  fi
}

migrar 'aws_api_gateway_resource.liveness_init'                      'aws_api_gateway_resource.liveness["liveness-init"]'
migrar 'aws_api_gateway_resource.liveness_validar'                   'aws_api_gateway_resource.liveness["validar"]'
migrar 'aws_api_gateway_method.liveness_init_post'                   'aws_api_gateway_method.liveness_post["liveness-init"]'
migrar 'aws_api_gateway_method.liveness_validar_post'                'aws_api_gateway_method.liveness_post["validar"]'
migrar 'aws_api_gateway_method.liveness_init_options'                'aws_api_gateway_method.liveness_options["liveness-init"]'
migrar 'aws_api_gateway_method.liveness_validar_options'             'aws_api_gateway_method.liveness_options["validar"]'
migrar 'aws_api_gateway_integration.liveness_init_lambda'            'aws_api_gateway_integration.liveness_post["liveness-init"]'
migrar 'aws_api_gateway_integration.liveness_validar_lambda'         'aws_api_gateway_integration.liveness_post["validar"]'
migrar 'aws_api_gateway_integration.liveness_init_options'           'aws_api_gateway_integration.liveness_options["liveness-init"]'
migrar 'aws_api_gateway_integration.liveness_validar_options'        'aws_api_gateway_integration.liveness_options["validar"]'
migrar 'aws_api_gateway_method_response.liveness_init_options_200'    'aws_api_gateway_method_response.liveness_options["liveness-init"]'
migrar 'aws_api_gateway_method_response.liveness_validar_options_200' 'aws_api_gateway_method_response.liveness_options["validar"]'
migrar 'aws_api_gateway_integration_response.liveness_init_options'   'aws_api_gateway_integration_response.liveness_options["liveness-init"]'
migrar 'aws_api_gateway_integration_response.liveness_validar_options' 'aws_api_gateway_integration_response.liveness_options["validar"]'

echo
echo "──────────────────────────────────────────────────"
echo " Paso 4 de 5 — aplicar solo los recursos de liveness"
echo "──────────────────────────────────────────────────"

terraform apply -auto-approve \
  -target=aws_lambda_function.reset \
  -target=aws_lambda_function.auditoria \
  -target=aws_lambda_function.registrar_empleado \
  -target=aws_lambda_function.validacion_biometrica \
  -target=aws_lambda_function.liveness \
  -target=aws_api_gateway_deployment.rrhh_deployment \
  -target=aws_api_gateway_deployment.auditoria_deployment \
  -target=aws_api_gateway_deployment.reset_deployment \
  -target=aws_api_gateway_usage_plan.rrhh_plan \
  -target=aws_api_gateway_usage_plan.auditoria_plan \
  -target=aws_api_gateway_usage_plan_key.rrhh_plan_key \
  -target=aws_api_gateway_usage_plan_key.auditoria_plan_key \
  -target=aws_iam_role_policy.lambda_liveness_policy \
  -target=aws_iam_role_policy.lambda_reset_policy \
  -target=aws_iam_role_policy.lambda_dynamo_policy \
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
echo " Paso 5 de 5 — valores para el frontend"
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
