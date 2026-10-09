#!/usr/bin/env node
/**
 * Ningún bucket de este proyecto puede ser de lectura pública.
 *
 * Por qué existe: el montaje anterior a Amplify declaraba el bucket
 * buckebiosecurity con una política de lectura para Principal "*" y un
 * aws_s3_bucket_public_access_block con las cuatro opciones en false, o
 * sea con las cuatro barreras de AWS desactivadas a mano. Nunca llegó a
 * existir —se perdió el estado antes de aplicarlo— pero quedó declarado
 * meses, y un `terraform apply` sin -target lo habría creado.
 *
 * En un sistema que guarda fotografías de rostros, un bucket público no
 * es un descuido de configuración: es una fuga de datos biométricos, que
 * el artículo 5 de la Ley 1581 clasifica como sensibles.
 *
 * Qué comprueba, en los dos frentes que lo hacen posible:
 *
 *   1. Que ningún aws_s3_bucket_public_access_block apague una barrera.
 *      Las cuatro opciones deben estar en true o no estar.
 *   2. Que ninguna política de bucket conceda lectura a Principal "*".
 *
 * Los dos hacen falta: AWS bloquea el acceso público por defecto en los
 * buckets nuevos, así que una política pública sola no basta para abrir
 * uno; hay que desactivar las barreras además. Comprobar solo uno de los
 * dos dejaría pasar la mitad del camino.
 */

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const BARRERAS = [
    "block_public_acls",
    "block_public_policy",
    "ignore_public_acls",
    "restrict_public_buckets",
];

console.log("");
console.log("Ningún bucket es de lectura pública");
console.log("─".repeat(52));

let fallos = 0;

for (const archivo of fs.readdirSync(RAIZ).filter(n => n.endsWith(".tf"))) {
    const texto = fs.readFileSync(path.join(RAIZ, archivo), "utf8");

    // El (?:^|\n) importa: un archivo que empieza con 'resource' perdería
    // su primer bloque. Es el fallo que tuvo la primera versión de
    // pruebas/validar-retirado.
    const bloques = texto.split(/(?:^|\n)resource\s+/).slice(1);

    for (const bloque of bloques) {
        const encabezado = bloque.split("\n")[0];
        const nombre = encabezado.replace(/"/g, "").replace(/\s*\{\s*$/, "").trim();

        // Las líneas comentadas no declaran nada. La nota que explica por
        // qué esto se retiró nombra a propósito lo que se quitó.
        const efectivo = bloque
            .split("\n")
            .filter(l => !l.trimStart().startsWith("#"))
            .join("\n");

        if (/^"aws_s3_bucket_public_access_block"/.test(encabezado)) {
            const apagadas = BARRERAS.filter(b =>
                new RegExp(`${b}\\s*=\\s*false`).test(efectivo)
            );
            if (apagadas.length) {
                console.log(`  ✗ ${archivo} — ${nombre} apaga: ${apagadas.join(", ")}`);
                fallos++;
            }
        }

        if (/^"aws_s3_bucket_policy"/.test(encabezado)) {
            const abierta = /Principal\s*=\s*"\*"/.test(efectivo)
                && /s3:(GetObject|\*)/.test(efectivo);
            if (abierta) {
                console.log(`  ✗ ${archivo} — ${nombre} concede lectura a Principal "*"`);
                fallos++;
            }
        }
    }
}

if (fallos === 0) {
    console.log("  ✓ ninguna barrera de acceso público desactivada");
    console.log("  ✓ ninguna política abierta a Principal \"*\"");
}

console.log("─".repeat(52));
console.log(
    fallos === 0
        ? "Los buckets están cerrados.\n"
        : `${fallos} declaración(es) abren un bucket al público.\n`
);
process.exit(fallos === 0 ? 0 : 1);
