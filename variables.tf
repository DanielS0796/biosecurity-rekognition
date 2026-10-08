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

# ── Observabilidad ────────────────────────────────────────────────────
# El DSN estaba puesto a mano en la consola de cada Lambda, así que el
# primer apply que tocó uno lo borró y Sentry quedó apagado sin avisar
# (un dsn vacío no falla: simplemente no reporta nada). Acá queda
# declarado para que no vuelva a pasar. El valor va en terraform.tfvars,
# que no se versiona.
variable "sentry_dsn" {
  description = "DSN de Sentry para los Lambdas. Vacío = sin reporte de errores."
  type        = string
  default     = ""
  sensitive   = true
}

variable "team_group" {
  description = "Etiqueta de equipo con la que Sentry agrupa los eventos."
  type        = string
  default     = "anlusoft"
}
