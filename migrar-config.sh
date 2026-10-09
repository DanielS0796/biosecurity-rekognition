#!/usr/bin/env bash
#
# Cambia config.js de los APIs de abril a los que maneja Terraform.
#
# Los valores no se escriben a mano: salen de `terraform output`, que es
# la única fuente que no se desactualiza. Cada API Gateway tiene su
# propia llave, así que migrar la URL sin migrar la llave da 403.
#
# Antes de tocar nada corre verificar-apis.sh y exige que los tres
# endpoints de Terraform contesten 200. Si alguno falla, no cambia nada:
# es justo el error que queremos no cometer.
#
#   ./migrar-config.sh
#
# Después hay que confirmar con git. El push dispara el build de
# Amplify, y ese build es el que pone el cambio frente a la gente.

set -uo pipefail

CONFIG="frontend/app/config.js"

echo "──────────────────────────────────────────────────"
echo " Migrar config.js a los APIs de Terraform"
echo "──────────────────────────────────────────────────"
echo

[ -f "$CONFIG" ] || { echo "No encuentro $CONFIG. Corre esto desde la raíz."; exit 1; }

# ── 1. Los endpoints nuevos tienen que estar sirviendo ───────────────
echo "  Paso 1 · comprobando los endpoints de Terraform"
SALIDA="$(./verificar-apis.sh 2>&1)"
echo "$SALIDA" | sed 's/^/    /'

FALLOS="$(echo "$SALIDA" | grep 'terraform' | grep -c '✗')"
if [ "$FALLOS" != "0" ]; then
  echo
  echo "  $FALLOS endpoint(s) de Terraform no contestan 200."
  echo "  No se cambia config.js: con esto migrado, eso serían 403 en la"
  echo "  cara de quien use la aplicación."
  exit 1
fi

# ── 2. Leer los valores nuevos ───────────────────────────────────────
echo
echo "  Paso 2 · leyendo los outputs"

leer() {
  local v; v="$(terraform output -raw "$1" 2>/dev/null)"
  [ -n "$v" ] || { echo "No se pudo leer el output '$1'." >&2; return 1; }
  printf '%s' "$v"
}

URL_RRHH="$(leer api_rrhh_url)"      || exit 1
URL_AUD="$(leer api_auditoria_url)"  || exit 1
URL_RESET="$(leer api_reset_url)"    || exit 1
LLAVE_RRHH="$(leer rrhh_api_key)"    || exit 1
LLAVE_AUD="$(leer auditoria_api_key)" || exit 1

# Las URLs se pueden mostrar: el ID del API va en el JavaScript que
# descarga cualquier navegador. Las llaves no se imprimen acá aunque
# también viajen al navegador, para no dejarlas en el historial de la
# terminal ni en una captura de pantalla.
echo "    RRHH      $URL_RRHH"
echo "    Auditoría $URL_AUD"
echo "    Reset     $URL_RESET"
echo "    Llaves    leídas de los outputs (no se imprimen)"

# ── 3. Reescribir las cinco líneas ───────────────────────────────────
echo
echo "  Paso 3 · reescribiendo $CONFIG"

RESPALDO="${CONFIG}.antes-de-migrar.$(date +%Y%m%d-%H%M%S)"
cp "$CONFIG" "$RESPALDO"

URL_RRHH="$URL_RRHH" URL_AUD="$URL_AUD" URL_RESET="$URL_RESET" \
LLAVE_RRHH="$LLAVE_RRHH" LLAVE_AUD="$LLAVE_AUD" CONFIG="$CONFIG" \
python3 - <<'PY'
import os, re, sys

ruta = os.environ['CONFIG']
s = open(ruta, encoding='utf-8').read()

cambios = [
    ('API_RRHH_URL',  os.environ['URL_RRHH']),
    ('API_AUDITORIA', os.environ['URL_AUD']),
    ('API_RESET',     os.environ['URL_RESET']),
    ('API_KEY_RRHH',  os.environ['LLAVE_RRHH']),
    ('API_KEY_AUD',   os.environ['LLAVE_AUD']),
]

for nombre, valor in cambios:
    patron = re.compile(r'(export const %s\s*=\s*)"[^"]*"' % nombre)
    if not patron.search(s):
        print(f"    No encontré la línea de {nombre}: no se cambió nada.", file=sys.stderr)
        sys.exit(1)
    s = patron.sub(lambda m: m.group(1) + '"' + valor + '"', s, count=1)

open(ruta, 'w', encoding='utf-8').write(s)
PY

if [ $? -ne 0 ]; then
  echo "    Falló la reescritura. Se restaura el original."
  cp "$RESPALDO" "$CONFIG"
  rm -f "$RESPALDO"
  exit 1
fi

echo
echo "  Diferencias (las llaves salen tachadas):"
git diff --no-color -- "$CONFIG" \
  | sed -E 's/(API_KEY_[A-Z]+ *= *")[^"]*"/\1••••••••"/' \
  | sed 's/^/    /'

echo
echo "──────────────────────────────────────────────────"
echo "Respaldo del archivo anterior en:"
echo "    $RESPALDO"
echo
echo "Si el diff se ve bien:"
echo
echo "    git add $CONFIG"
echo "    git commit -m 'migrar config.js a los APIs de Terraform'"
echo "    git push"
echo
echo "El push dispara el build de Amplify. Hasta que ese build termine,"
echo "la aplicación sigue hablando con los APIs de abril."
echo
echo "No borres los APIs de abril todavía. Si algo sale mal, volver es"
echo "restaurar el respaldo y empujar otra vez."
echo "──────────────────────────────────────────────────"
