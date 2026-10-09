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

# API Gateway guarda su decisión sobre una llave hasta cinco minutos, y
# guarda también los "no". Si ya había un 403 cacheado de antes de la
# reasociación, una sola prueba al minuto sigue dando 403 aunque todo
# esté bien, y eso manda a buscar el error donde no está. Por eso
# reintenta en vez de esperar un rato fijo y resignarse.
echo
echo "  Comprobando cada 45 s hasta que la caché expire (máximo 6 min)"
echo

for intento in 1 2 3 4 5 6 7 8; do
  SALIDA="$(./verificar-apis.sh 2>&1)"
  FALLOS="$(echo "$SALIDA" | grep 'terraform' | grep -c '✗')"

  if [ "$FALLOS" = "0" ]; then
    echo "$SALIDA"
    echo
    echo "Listo en el intento $intento. Sigue ./migrar-config.sh"
    exit 0
  fi

  printf '  intento %d · %s endpoint(s) todavía en 403\n' "$intento" "$FALLOS"
  [ "$intento" -lt 8 ] && sleep 45
done

echo
echo "$SALIDA"
echo
echo "Seis minutos y sigue fallando: ya no es la caché."
echo "Corre ./diagnosticar-llave.sh para ver qué es."
exit 1
