#!/usr/bin/env bash
#
# Compara los APIs que usa producción hoy contra los que maneja
# Terraform, antes de cambiar config.js.
#
# Los dos juegos apuntan a los mismos Lambdas, pero cada API Gateway
# tiene sus propias llaves, su propio CORS y su propio despliegue. Que
# el Lambda funcione no garantiza que la puerta nueva esté abierta: por
# eso se prueba la puerta, no el Lambda.
#
#   ./verificar-apis.sh
#
# No cambia nada. Solo consulta.

set -uo pipefail

echo "──────────────────────────────────────────────────"
echo " Endpoints: producción vs Terraform"
echo "──────────────────────────────────────────────────"
echo

# Las llaves salen de los outputs y nunca se imprimen: se usan dentro
# de la cabecera y se descartan al terminar el script.
LLAVE_RRHH="$(terraform output -raw rrhh_api_key 2>/dev/null)"
LLAVE_AUD="$(terraform output -raw auditoria_api_key 2>/dev/null)"

if [ -z "$LLAVE_RRHH" ] || [ -z "$LLAVE_AUD" ]; then
  echo "No se pudieron leer las API keys de los outputs de Terraform."
  echo "Comprueba que 'terraform output' funcione y vuelve a correr."
  exit 1
fi

# Las que usa el frontend hoy, copiadas de frontend/app/config.js.
LLAVE_RRHH_VIEJA="UBsklq8EyX8pPI2W2sHIp39gxALuSAGv7posYBGW"
LLAVE_AUD_VIEJA="XYyh4xXyyka10J27CVIaA4UiKpjDW37a4lepAX1n"

probar() {
  local etiqueta="$1" metodo="$2" url="$3" llave="$4" cuerpo="${5:-}"
  local codigo

  if [ "$metodo" = "GET" ]; then
    codigo=$(curl -s -o /tmp/respuesta.$$ -w '%{http_code}' --max-time 20 \
      -H "x-api-key: ${llave}" "$url")
  else
    codigo=$(curl -s -o /tmp/respuesta.$$ -w '%{http_code}' --max-time 20 \
      -X POST -H 'Content-Type: application/json' -H "x-api-key: ${llave}" \
      -d "$cuerpo" "$url")
  fi

  local marca="✗"
  [ "$codigo" = "200" ] && marca="✓"

  printf '  %s %-34s %s' "$marca" "$etiqueta" "$codigo"
  if [ "$codigo" != "200" ]; then
    printf '  %s' "$(head -c 110 /tmp/respuesta.$$ | tr -d '\n')"
  fi
  echo
  rm -f /tmp/respuesta.$$
}

echo "Registro de personas"
probar "produccion  uadjcukyx1" GET \
  "https://uadjcukyx1.execute-api.us-east-1.amazonaws.com/prod/registrar?tipo=activos" \
  "$LLAVE_RRHH_VIEJA"
probar "terraform   jfshekzwbl" GET \
  "https://jfshekzwbl.execute-api.us-east-1.amazonaws.com/prod/registrar?tipo=activos" \
  "$LLAVE_RRHH"

echo
echo "Auditoría"
probar "produccion  3tqg18yo1l" GET \
  "https://3tqg18yo1l.execute-api.us-east-1.amazonaws.com/prod/reporte?format=json" \
  "$LLAVE_AUD_VIEJA"
probar "terraform   sdvymkutn7" GET \
  "https://sdvymkutn7.execute-api.us-east-1.amazonaws.com/prod/reporte?format=json" \
  "$LLAVE_AUD"

echo
echo "Autenticación"
# 'politica' solo devuelve las reglas de contraseña: no toca usuarios ni
# envía correos, así que se puede llamar sin consecuencias.
probar "produccion  0geuesizya" POST \
  "https://0geuesizya.execute-api.us-east-1.amazonaws.com/prod/reset" \
  "" '{"accion":"politica"}'
probar "terraform   qwnsrgtar9" POST \
  "https://qwnsrgtar9.execute-api.us-east-1.amazonaws.com/prod/reset" \
  "" '{"accion":"politica"}'

echo
echo "Liveness (mismo API en los dos: no hay nada que migrar)"
probar "h1jhziuxw4  liveness-init" POST \
  "https://h1jhziuxw4.execute-api.us-east-1.amazonaws.com/prod/liveness-init" \
  "" '{"proposito":"validacion"}'

echo
echo "──────────────────────────────────────────────────"
echo "Si las cuatro líneas 'terraform' dan 200, el cambio de config.js"
echo "es seguro. Si alguna falla, el número y el mensaje dicen qué le"
echo "falta a ese API antes de poder migrar."
echo "──────────────────────────────────────────────────"
