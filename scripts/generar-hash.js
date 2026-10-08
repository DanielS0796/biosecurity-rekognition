#!/usr/bin/env node
// Genera el hash scrypt de una contraseña, con el mismo formato que usa el
// Lambda de autenticación. Sirve para llenar admin_emergencia_hash en
// terraform.tfvars sin tener que escribir la contraseña en ningún archivo.
//
//   node scripts/generar-hash.js "MiContraseñaSegura"

const crypto = require("crypto");

const clave = process.argv[2];
if (!clave) {
  console.error("Uso: node scripts/generar-hash.js \"LaContraseña\"");
  process.exit(1);
}

const REGLAS = [
  [clave.length >= 10, "al menos 10 caracteres"],
  [/[A-ZÁÉÍÓÚÑ]/.test(clave), "una mayúscula"],
  [/[a-záéíóúñ]/.test(clave), "una minúscula"],
  [/[0-9]/.test(clave), "un número"],
  [/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/.test(clave), "un símbolo"],
];
const faltan = REGLAS.filter(([ok]) => !ok).map(([, t]) => t);
if (faltan.length) {
  console.error(`Esa contraseña no cumple la política: falta ${faltan.join(", ")}.`);
  process.exit(1);
}

const N = 16384, r = 8, p = 1, keylen = 64;
const sal = crypto.randomBytes(16);
const derivada = crypto.scryptSync(clave, sal, keylen, { N, r, p });

console.log(`scrypt$${N}$${r}$${p}$${sal.toString("hex")}$${derivada.toString("hex")}`);
