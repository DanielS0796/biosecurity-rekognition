#!/usr/bin/env bash
#
# Averigua por qué los endpoints con API key devuelven 403.
#
# Después de reasociar el plan de uso siguen en 403, así que quedan dos
# explicaciones y hay que separarlas:
#
#   1. La llave que usa el script de verificación no es la que vale.
#      `terraform output` saca el valor de aws_api_gateway_api_key,
#      mientras que lo que AWS valida es la llave asociada al plan. Si
#      los dos valores no coinciden, el 403 es correcto: estamos
#      llamando con una llave que no está en ningún plan.
#
#   2. La asociación está bien y lo que falta es tiempo. API Gateway
#      guarda su decisión sobre una llave hasta cinco minutos, y también
#      guarda los "no". Un minuto de espera puede no alcanzar.
#
# Esto no cambia nada en AWS. Solo lee y prueba.
#
#   ./diagnosticar-llave.sh

set -uo pipefail

# De una llave solo se muestran los extremos: alcanza para comparar dos
# valores sin dejar la llave entera en la terminal.
huella() {
  local v="$1"
  [ -z "$v" ] && { printf '(vacía)'; return; }
  printf '%s…%s  (%d caracteres)' "${v:0:4}" "${v: -4}" "${#v}"
}

valor_en_estado() {
  terraform state show "$1" 2>/dev/null \
    | grep -E '^[[:space:]]+value[[:space:]]+=' | head -1 \
    | sed -E 's/.*= "?//; s/"$//'
}

etapas_del_plan() {
  terraform state show "$1" 2>/dev/null \
    | grep -E 'api_id|stage ' | sed 's/^/      /'
}

revisar() {
  local nombre="$1" output_llave="$2" rec_plan="$3" rec_key="$4" url="$5"

  echo "──────────────────────────────────────────────────"
  echo " $nombre"
  echo "──────────────────────────────────────────────────"

  local l_output l_plan
  l_output="$(terraform output -raw "$output_llave" 2>/dev/null)"
  l_plan="$(valor_en_estado "$rec_key")"

  echo "  La llave que usa verificar-apis.sh (terraform output):"
  echo "      $(huella "$l_output")"
  echo "  La llave asociada al plan de uso (estado):"
  echo "      $(huella "$l_plan")"

  if [ "$l_output" = "$l_plan" ]; then
    echo "  → Son la misma. La llave no es el problema."
  else
    echo "  → NO coinciden. Ahí está el 403: estamos llamando con una"
    echo "    llave que no está en ningún plan de uso."
  fi

  echo
  echo "  Etapas que cubre el plan de uso:"
  etapas_del_plan "$rec_plan"

  # La prueba se hace con la llave del plan, que es la que AWS valida.
  local llave="${l_plan:-$l_output}"
  if [ -z "$llave" ]; then
    echo
    echo "  No se pudo leer ninguna llave; no hay nada que probar."
    return
  fi

  # Prueba cruzada: la llave que usa producción hoy, contra el API
  # nuevo. Se lee de config.js para no tener la llave escrita dos veces.
  # Las llaves son de la cuenta, no del API, así que si esta pasara
  # significaría que el plan del API nuevo quedó con la llave vieja
  # adentro. Un 403 acá descarta esa confusión.
  local llave_vieja cruzada
  llave_vieja="$(grep -E "export const ${6} " frontend/app/config.js \
    | sed -E 's/.*= *"//; s/".*//')"
  if [ -n "$llave_vieja" ]; then
    cruzada=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
      -H "x-api-key: ${llave_vieja}" "$url")
    echo
    echo "  Prueba cruzada, llave de producción contra el API nuevo: $cruzada"
    [ "$cruzada" = "200" ] && \
      echo "    → El plan del API nuevo tiene la llave vieja adentro."
  fi

  echo
  echo "  Probando cada 45 s hasta seis minutos, por si es la caché:"
  local i codigo
  for i in 1 2 3 4 5 6 7 8; do
    codigo=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
      -H "x-api-key: ${llave}" "$url")
    printf '      intento %d  %s\n' "$i" "$codigo"
    if [ "$codigo" = "200" ]; then
      echo "      → Era la caché. Ya está sirviendo."
      return
    fi
    [ "$i" -lt 8 ] && sleep 45
  done
  echo "      → Seis minutos en 403. No es la caché."
}

revisar "Registro de personas" \
  rrhh_api_key \
  aws_api_gateway_usage_plan.rrhh_plan \
  aws_api_gateway_usage_plan_key.rrhh_plan_key \
  "https://jfshekzwbl.execute-api.us-east-1.amazonaws.com/prod/registrar?tipo=activos" \
  "API_KEY_RRHH"

echo
revisar "Auditoría" \
  auditoria_api_key \
  aws_api_gateway_usage_plan.auditoria_plan \
  aws_api_gateway_usage_plan_key.auditoria_plan_key \
  "https://sdvymkutn7.execute-api.us-east-1.amazonaws.com/prod/reporte?format=json" \
  "API_KEY_AUD"
