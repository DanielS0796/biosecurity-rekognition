#!/usr/bin/env bash
#
# Mueve el estado de Terraform del portátil a un bucket de S3.
#
# Se corre una sola vez. Después, todos los comandos de Terraform leen y
# escriben el estado en S3 sin que haya que hacer nada más.
#
# El orden importa: el bucket tiene que existir antes de que Terraform
# pueda usarlo como backend, y el backend no se puede declarar antes de
# que el bucket exista. Por eso son tres pasos y no un apply.
#
#   ./migrar-estado.sh

set -uo pipefail

CUENTA="${CUENTA_AWS:-968481485339}"
BUCKET="biosecurity-tfstate-${CUENTA}"
TABLA="biosecurity-terraform-locks"

echo "──────────────────────────────────────────────────"
echo " Migrar el estado de Terraform a S3"
echo "──────────────────────────────────────────────────"
echo

if [ -f backend.tf ]; then
  echo "backend.tf ya existe: el estado ya está en S3."
  echo "Si quieres rehacer la migración, borra backend.tf y vuelve a correr."
  exit 0
fi

if ! { [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; } \
   && [ -z "${AWS_PROFILE:-}" ] && [ ! -s "${HOME}/.aws/credentials" ]; then
  echo "No hay credenciales de AWS. Expórtalas y vuelve a correr."
  exit 1
fi

# ── 1. Copia de seguridad del estado local ───────────────────────────
# terraform init -migrate-state copia, no mueve, así que el archivo
# local queda igual. Aun así se guarda aparte: es el único sitio donde
# vive esta información hasta que el paso 3 termine bien.
if [ -f terraform.tfstate ]; then
  RESPALDO="terraform.tfstate.antes-de-s3.$(date +%Y%m%d-%H%M%S)"
  cp terraform.tfstate "$RESPALDO"
  echo "  Paso 1 · respaldo del estado local en $RESPALDO"
else
  echo "  Paso 1 · no hay terraform.tfstate local; nada que respaldar"
fi

# ── 2. Crear el bucket y la tabla de bloqueo ─────────────────────────
echo
echo "  Paso 2 · creando el bucket y la tabla de bloqueo"
terraform apply -auto-approve \
  -target=aws_s3_bucket.estado \
  -target=aws_s3_bucket_versioning.estado \
  -target=aws_s3_bucket_server_side_encryption_configuration.estado \
  -target=aws_s3_bucket_public_access_block.estado \
  -target=aws_dynamodb_table.bloqueo_terraform \
  || { echo; echo "Falló al crear el bucket. El estado sigue donde estaba."; exit 1; }

# ── 3. Declarar el backend y mover el estado ─────────────────────────
echo
echo "  Paso 3 · declarando el backend y copiando el estado"

cat > backend.tf <<EOF
# Generado por migrar-estado.sh. El estado vive en S3, versionado y
# cifrado, con bloqueo en DynamoDB para que dos apply no se pisen.
#
# El bucket y la tabla se declaran en estado-remoto.tf. No se tocan a
# mano: si hay que cambiarlos, primero se saca el estado de ahí.
terraform {
  backend "s3" {
    bucket         = "${BUCKET}"
    key            = "biosecurity/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "${TABLA}"
    encrypt        = true
  }
}
EOF

# -force-copy evita la pregunta interactiva, que un script no puede
# contestar. Es una copia: el archivo local sigue ahí y además está el
# respaldo del paso 1.
if terraform init -migrate-state -force-copy; then
  echo
  echo "──────────────────────────────────────────────────"
  echo " Listo. El estado vive en s3://${BUCKET}"
  echo "──────────────────────────────────────────────────"
  echo
  echo "Comprueba que Terraform ve todo lo que manejaba:"
  echo
  echo "    terraform state list | wc -l"
  echo
  echo "Si ese número coincide con lo que había antes, el estado local"
  echo "ya no hace falta. Mientras tanto no lo borres."
else
  echo
  echo "Falló la migración. Se quita backend.tf para dejar las cosas"
  echo "como estaban; el estado local no se tocó."
  rm -f backend.tf
  exit 1
fi
