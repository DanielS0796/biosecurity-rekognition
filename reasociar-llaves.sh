#!/usr/bin/env bash
#
# Vuelve a asociar las API keys con las etapas de los APIs de RRHH y
# auditoría, y comprueba que quedó.
#
# Cuándo hace falta: cuando esos dos endpoints devuelven 403 Forbidden
# con la llave correcta. Eso pasa si el despliegue se reemplazó —un
# cambio en los triggers—, porque al reemplazarlo la etapa se borra y se
# vuelve a crear, y la asociación con el plan de uso se queda por el
# camino. Terraform no lo ve: en su configuración nada cambió.
#
# De aquí en adelante main.tf lo arregla solo con replace_triggered_by.
# Este script es para la vez que ya pasó, y para la próxima vez que algo
# parecido deje las llaves huérfanas.
#
#   ./reasociar-llaves.sh
#
# No toca producción: estos planes cubren solo los APIs de Terraform.

set -uo pipefail

echo "──────────────────────────────────────────────────"
echo " Reasociar las API keys con las etapas"
echo "──────────────────────────────────────────────────"
echo

if ! { [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; } \
   && [ -z "${AWS_PROFILE:-}" ] && [ ! -s "${HOME}/.aws/credentials" ]; then
  echo "No hay credenciales de AWS. Expórtalas y vuelve a correr."
  exit 1
fi

terraform apply -auto-approve \
  -replace=aws_api_gateway_usage_plan.rrhh_plan \
  -replace=aws_api_gateway_usage_plan.auditoria_plan \
  -target=aws_api_gateway_usage_plan.rrhh_plan \
  -target=aws_api_gateway_usage_plan.auditoria_plan \
  -target=aws_api_gateway_usage_plan_key.rrhh_plan_key \
  -target=aws_api_gateway_usage_plan_key.auditoria_plan_key \
  || { echo; echo "Falló el apply. Revisa el error de arriba."; exit 1; }

# API Gateway guarda un rato la decisión sobre una llave antes de volver
# a consultarla. Probar de inmediato puede dar 403 aunque la asociación
# ya esté bien, y eso manda a buscar el error donde no está.
echo
echo "  Esperando 60 s a que expire la caché de llaves de API Gateway"
sleep 60

echo
./verificar-apis.sh
