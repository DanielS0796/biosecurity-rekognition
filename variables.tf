# ─────────────────────────────────────────────────────────────
# Credenciales que no pueden vivir en el repositorio
# ─────────────────────────────────────────────────────────────
# Los valores van en terraform.tfvars, que está en .gitignore.
# Hay una plantilla en terraform.tfvars.ejemplo.

variable "smtp_usuario" {
  description = "Cuenta de Gmail desde la que el sistema envía correos"
  type        = string
  default     = ""
}

variable "smtp_clave" {
  description = "Contraseña de aplicación de esa cuenta de Gmail"
  type        = string
  default     = ""
  sensitive   = true
}

variable "admin_emergencia_usuario" {
  description = "Usuario de acceso de emergencia. Vacío lo deshabilita."
  type        = string
  default     = ""
}

variable "admin_emergencia_hash" {
  description = "Hash scrypt de la contraseña de emergencia. Se genera con: node scripts/generar-hash.js"
  type        = string
  default     = ""
  sensitive   = true
}

variable "admin_emergencia_correo" {
  description = "Correo de recuperación del usuario de emergencia"
  type        = string
  default     = ""
}
