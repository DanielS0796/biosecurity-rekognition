# Generado por migrar-estado.sh. El estado vive en S3, versionado y
# cifrado, con bloqueo en DynamoDB para que dos apply no se pisen.
#
# El bucket y la tabla se declaran en estado-remoto.tf. No se tocan a
# mano: si hay que cambiarlos, primero se saca el estado de ahí.
terraform {
  backend "s3" {
    bucket         = "biosecurity-tfstate-968481485339"
    key            = "biosecurity/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "biosecurity-terraform-locks"
    encrypt        = true
  }
}
