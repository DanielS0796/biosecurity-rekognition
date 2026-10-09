#!/usr/bin/env bash
#
# Genera los dos diagramas del proyecto a partir del código.
#
#   ./diagramas/generar.sh
#
# Deja dos archivos:
#
#   diagramas/arquitectura.png   qué habla con qué, dibujado a mano pero
#                                a partir de lo que hay en el Terraform
#   diagramas/dependencias.png   el grafo que Terraform usa para decidir
#                                el orden de creación, salido de
#                                `terraform graph`
#
# Se generan en vez de dibujarse una vez porque los diagramas que
# teníamos mostraban el frontend en S3 con CloudFront y un endpoint de
# validación por fotografía: cosas que dejaron de existir sin que el
# dibujo se enterara. Un diagrama viejo no se ve viejo, y ahí está el
# problema.
#
# Requiere graphviz y la librería diagrams:
#
#   sudo apt install graphviz
#   pip install diagrams

set -uo pipefail

cd "$(dirname "$0")/.."

echo "──────────────────────────────────────────────────"
echo " Diagramas de Biosecurity UCompensar"
echo "──────────────────────────────────────────────────"
echo

FALTA=0

if ! command -v dot >/dev/null 2>&1; then
  echo "  Falta graphviz:  sudo apt install graphviz"
  FALTA=1
fi

if ! python3 -c "import diagrams" >/dev/null 2>&1; then
  echo "  Falta la librería:  pip install diagrams"
  FALTA=1
fi

[ "$FALTA" = "1" ] && { echo; echo "Instala lo de arriba y vuelve a correr."; exit 1; }

# ── Arquitectura ─────────────────────────────────────────────────────
echo "  Arquitectura"
if python3 diagramas/arquitectura.py; then
  echo "      diagramas/arquitectura.png"
else
  echo "      falló; mira el error de arriba"
fi

# ── Dependencias ─────────────────────────────────────────────────────
# terraform graph no toca la cuenta: lee la configuración y el estado.
echo
echo "  Dependencias"
if ! command -v terraform >/dev/null 2>&1; then
  echo "      no hay terraform en esta máquina; se omite"
elif terraform graph 2>/dev/null \
     | python3 diagramas/limpiar-grafo.py \
     | dot -Tpng -o diagramas/dependencias.png; then
  echo "      diagramas/dependencias.png"
else
  echo "      falló. Si el error es de inicialización, corre"
  echo "      'terraform init' y vuelve a intentar."
fi

echo
echo "──────────────────────────────────────────────────"
echo "Si algo en los diagramas no coincide con lo que crees que hay"
echo "desplegado, el que está equivocado no es el diagrama."
echo "──────────────────────────────────────────────────"
