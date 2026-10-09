#!/usr/bin/env bash
#
# Pone el WAF delante de los APIs y comprueba que quedó puesto.
#
# Va aparte del despliegue normal por una razón: un WAF mal configurado
# no se nota en el apply, se nota cuando alguien no puede entrar. Así
# queda un paso con su propia verificación, y se puede quitar solo esto
# sin tocar nada más.
#
#   ./desplegar-waf.sh                 # los tres APIs de gestión
#   ./desplegar-waf.sh --con-liveness  # también la puerta de acceso
#
# Para revertir:
#   terraform destroy -target=aws_wafv2_web_acl_association.rrhh ...
# o directamente desasociar el web ACL en la consola, que es inmediato.

set -uo pipefail

CON_LIVENESS=0
[ "${1:-}" = "--con-liveness" ] && CON_LIVENESS=1

echo "──────────────────────────────────────────────────"
echo " WAF delante de los APIs"
echo "──────────────────────────────────────────────────"
echo

if ! { [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; } \
   && [ -z "${AWS_PROFILE:-}" ] && [ ! -s "${HOME}/.aws/credentials" ]; then
  echo "No hay credenciales de AWS. Expórtalas y vuelve a correr."
  exit 1
fi

OBJETIVOS=(
  -target=aws_wafv2_web_acl.apis
  -target=aws_cloudwatch_log_group.waf
  -target=aws_cloudwatch_log_resource_policy.waf
  -target=aws_wafv2_web_acl_logging_configuration.apis
  -target=aws_wafv2_web_acl_association.rrhh
  -target=aws_wafv2_web_acl_association.auditoria
  -target=aws_wafv2_web_acl_association.reset
)

if [ "$CON_LIVENESS" = "1" ]; then
  echo "  Incluye el API de liveness: es la puerta por donde entra la"
  echo "  gente todos los días. Si una regla se equivoca, se nota ahí."
  echo
  OBJETIVOS+=(-target=aws_wafv2_web_acl_association.liveness)
  OBJETIVOS+=(-var proteger_liveness=true)
fi

echo "  Aplicando"
terraform apply -auto-approve "${OBJETIVOS[@]}" || {
  echo
  echo "Falló el apply. Nada quedó asociado a medias: si el web ACL se"
  echo "creó pero la asociación no, los APIs siguen respondiendo igual."
  exit 1
}

# La asociación tarda en propagarse por los puntos de presencia. Probar
# de inmediato da falsos negativos en las dos direcciones.
echo
echo "  Esperando 90 s a que la asociación se propague"
sleep 90

# ── Comprobación 1: lo normal sigue pasando ──────────────────────────
echo
echo "  Lo legítimo sigue pasando"
./verificar-apis.sh | sed 's/^/    /'

# ── Comprobación 2: lo malicioso ya no pasa ──────────────────────────
# La llave va correcta a propósito: así el único motivo posible de un
# 403 es el WAF. Sin WAF estas mismas peticiones devuelven 200 con "no
# se encontró a nadie", porque el Lambda trata el parámetro como texto.
#
# Las tres pruebas son de lo que las reglas puestas cubren de verdad:
# recorrido de rutas y XSS vienen en el conjunto común, y Log4Shell en
# el de entradas maliciosas. Inyección de SQL no se prueba porque no
# está cubierta: vive en AWSManagedRulesSQLiRuleSet, que no pusimos.
# Acá no hay motor SQL —los datos están en DynamoDB y los Lambdas
# consultan con el SDK— así que serían 12 USD al año por una puerta que
# no existe. Si la tesis necesita decir que cubre inyección de SQL, es
# una regla más y un dólar al mes.
echo
echo "  Lo malicioso ya no pasa"
LLAVE_RRHH="$(terraform output -raw rrhh_api_key 2>/dev/null)"
URL_RRHH="$(terraform output -raw api_rrhh_url 2>/dev/null)"

probar_ataque() {
  local etiqueta="$1" consulta="$2" codigo
  codigo=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -G \
    -H "x-api-key: ${LLAVE_RRHH}" --data-urlencode "$consulta" "$URL_RRHH")
  local marca="✗"
  [ "$codigo" = "403" ] && marca="✓"
  printf '    %s %-34s %s\n' "$marca" "$etiqueta" "$codigo"
}

if [ -n "$LLAVE_RRHH" ] && [ -n "$URL_RRHH" ]; then
  probar_ataque "recorrido de rutas" "identificacion=../../etc/passwd"
  probar_ataque "script incrustado"  "identificacion=<script>alert(1)</script>"
  probar_ataque "Log4Shell"          'identificacion=${jndi:ldap://x/a}'
else
  echo "    No se pudo leer la llave de los outputs; se omite esta parte."
fi

echo
echo "──────────────────────────────────────────────────"
echo "Los 403 de arriba son lo que se busca: el WAF cortó la petición"
echo "antes de que llegara al Lambda. Un 200 ahí significa que la regla"
echo "no se aplicó, no que la petición fuera inofensiva."
echo
echo "Lo que bloquea queda en CloudWatch, grupo aws-waf-logs-biosecurity,"
echo "siete días. La cédula y la llave van tachadas en el registro."
echo "──────────────────────────────────────────────────"
