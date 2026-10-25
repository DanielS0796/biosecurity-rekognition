#!/usr/bin/env bash
#
# Comprueba en AWS, después del apply, que las acciones administrativas
# exigen sesión (riesgo R09). Las pruebas de pruebas/ verifican el código;
# esto verifica la puerta desplegada: que API Gateway deje pasar la
# cabecera Authorization y que las Lambdas nuevas sean las que responden.
#
#   ./verificar-sesion.sh
#
# No cambia nada. Ninguna llamada lleva token, así que todas deberían
# rechazarse antes de tocar datos, Rekognition o el correo. Por eso
# tampoco cuesta nada: el registro se corta antes de abrir la sesión de
# Face Liveness, que es lo único que cobra por llamada.

set -uo pipefail

URL_RRHH="$(terraform output -raw api_rrhh_url 2>/dev/null)"
URL_AUD="$(terraform output -raw api_auditoria_url 2>/dev/null)"
URL_RESET="$(terraform output -raw api_reset_url 2>/dev/null)"
URL_LIVENESS="$(terraform output -raw api_liveness_init_url 2>/dev/null)"

for v in URL_RRHH URL_AUD URL_RESET URL_LIVENESS; do
  if [ -z "${!v}" ]; then
    echo "No se pudo leer $v de los outputs de Terraform."
    echo "Corre el script desde la raíz del repositorio, después del apply."
    exit 1
  fi
done

fallos=0

# esperar <código> <etiqueta> <curl args...>
esperar() {
  local esperado="$1" etiqueta="$2"; shift 2
  local codigo
  codigo=$(curl -s -o /tmp/sesion.$$ -w '%{http_code}' --max-time 20 "$@")
  local marca="✓"
  if [ "$codigo" != "$esperado" ]; then marca="✗"; fallos=$((fallos + 1)); fi
  printf '  %s %-46s %s (esperado %s)' "$marca" "$etiqueta" "$codigo" "$esperado"
  [ "$codigo" != "$esperado" ] && printf '  %s' "$(head -c 100 /tmp/sesion.$$ | tr -d '\n')"
  echo
  rm -f /tmp/sesion.$$
}

# El navegador solo manda Authorization si el preflight lo permite.
preflight() {
  local etiqueta="$1" url="$2" metodo="$3" permitidas
  permitidas=$(curl -s -o /dev/null -D - --max-time 20 -X OPTIONS \
    -H 'Origin: https://biosecurity.example' \
    -H "Access-Control-Request-Method: ${metodo}" \
    -H 'Access-Control-Request-Headers: authorization,content-type,x-api-key' "$url" \
    | grep -i '^access-control-allow-headers:' | tr -d '\r' | cut -d' ' -f2-)
  local marca="✓"
  if ! echo "$permitidas" | grep -qi 'authorization'; then marca="✗"; fallos=$((fallos + 1)); fi
  printf '  %s %-46s %s\n' "$marca" "$etiqueta" "${permitidas:-sin Allow-Headers}"
}

echo "──────────────────────────────────────────────────"
echo " Sesión firmada: lo administrativo sin token se rechaza"
echo "──────────────────────────────────────────────────"

# Desde que se retiraron las llaves de API, estas llamadas van sin llave.
# Un 401 (y no un 403 de API Gateway) confirma las dos cosas a la vez: que
# la API ya no pide llave y que la Lambda sí pide sesión.
echo "Recursos Humanos (sin llave y sin token)"
esperar 401 "listar personas activas" \
  "${URL_RRHH}?tipo=activos"
esperar 401 "retirar una persona" \
  -X DELETE -H 'Content-Type: application/json' \
  -d '{"identificacion":"0"}' "$URL_RRHH"

echo
echo "Auditoría (sin llave y sin token)"
esperar 401 "reporte de accesos" \
  "${URL_AUD}?format=json"

echo
echo "Administración de usuarios (sin token)"
esperar 401 "listar usuarios" \
  -X POST -H 'Content-Type: application/json' -d '{"accion":"listar_usuarios"}' "$URL_RESET"
esperar 401 "crear un usuario" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"accion":"crear_usuario","usuario":"prueba-r09","correo":"nadie@example.com","rol":"rrhh"}' "$URL_RESET"
esperar 401 "con un token inventado" \
  -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer a.b.c' \
  -d '{"accion":"listar_usuarios"}' "$URL_RESET"

echo
echo "Registro facial (sin token)"
esperar 401 "abrir un registro" \
  -X POST -H 'Content-Type: application/json' \
  -d '{"proposito":"registro","identificacion":"0","nombre":"Prueba R09"}' "$URL_LIVENESS"

echo
echo "Lo público sigue público"
esperar 200 "política de contraseñas" \
  -X POST -H 'Content-Type: application/json' -d '{"accion":"politica"}' "$URL_RESET"

echo
echo "Preflight CORS: Authorization permitida"
preflight "registro de personas" "$URL_RRHH" GET
preflight "auditoría" "$URL_AUD" GET
preflight "autenticación" "$URL_RESET" POST
preflight "liveness" "$URL_LIVENESS" POST

echo
echo "──────────────────────────────────────────────────"
if [ "$fallos" -eq 0 ]; then
  echo "Todo en orden. Falta la prueba con sesión: entrar a RR. HH. y a"
  echo "auditoría desde la aplicación y usar cada pantalla una vez."
else
  echo "$fallos comprobación(es) fallaron. Si un 401 sale 200, esa Lambda"
  echo "sigue con el código anterior; si sale 403 en RR. HH. o auditoría,"
  echo "la API todavía pide llave: el despliegue no se ha propagado (hasta"
  echo "5 minutos) o el apply no quitó api_key_required."
fi
echo "──────────────────────────────────────────────────"
exit $([ "$fallos" -eq 0 ] && echo 0 || echo 1)
