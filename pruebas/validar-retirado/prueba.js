#!/usr/bin/env node
/**
 * Impide que /best/validar vuelva.
 *
 * Por qué existe: el API anlusoft-rekognition-api recibía una fotografía
 * en el cuerpo del JSON y registraba el acceso sin comprobar que hubiera
 * una persona real delante. Una foto impresa lo superaba. Se quitó del
 * frontend hace semanas, pero siguió declarado en Terraform, y un apply
 * sin -target lo recreó: el API que se retiró el 8 de octubre de 2026
 * tenía fecha de creación del 7.
 *
 * Qué comprueba: que ningún API Gateway tenga una integración apuntando
 * al Lambda validacion_biometrica. Esa es la firma exacta del agujero, y
 * sobrevive a que alguien renombre el recurso o cambie la ruta.
 *
 * Lo que NO comprueba: la ruta /validar del API de liveness, que es
 * legítima —es un alias de /liveness-result y apunta al Lambda de
 * liveness, no a este—. Por eso la comprobación mira el destino de la
 * integración y no el nombre del camino.
 *
 * El Lambda en sí puede seguir existiendo. Sin puerta desde internet no
 * es un riesgo, y sirve para demostrar el comportamiento viejo en una
 * prueba controlada.
 */

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const LAMBDA_INSEGURO = "validacion_biometrica";

console.log("");
console.log("El endpoint de validación por fotografía sigue retirado");
console.log("─".repeat(52));

let fallos = 0;

const archivos = fs.readdirSync(RAIZ).filter(n => n.endsWith(".tf"));

for (const archivo of archivos) {
    const texto = fs.readFileSync(path.join(RAIZ, archivo), "utf8");

    // Se parten los bloques por el inicio de cada recurso. Alcanza para
    // esto: solo hace falta saber si un bloque de integración nombra al
    // Lambda, no interpretar la configuración entera.
    //
    // El (?:^|\n) importa: con solo \n, un archivo que empieza
    // directamente con 'resource' perdía su primer bloque y la
    // comprobación pasaba en verde con el agujero declarado. Se
    // descubrió probando la prueba.
    const bloques = texto.split(/(?:^|\n)resource\s+/).slice(1);

    for (const bloque of bloques) {
        const encabezado = bloque.split("\n")[0];
        if (!/^"aws_api_gateway_integration"/.test(encabezado)) continue;

        // Las líneas comentadas no declaran nada: la nota que explica por
        // qué esto se retiró menciona el Lambda a propósito.
        const efectivo = bloque
            .split("\n")
            .filter(l => !l.trimStart().startsWith("#"))
            .join("\n");

        if (efectivo.includes(LAMBDA_INSEGURO)) {
            const nombre = encabezado.replace(/"/g, "").replace(/\s*\{\s*$/, "").trim();
            console.log(`  ✗ ${archivo} — ${nombre} apunta a ${LAMBDA_INSEGURO}`);
            fallos++;
        }
    }
}

if (fallos === 0) {
    console.log(`  ✓ ningún API Gateway integra ${LAMBDA_INSEGURO}`);
}

console.log("─".repeat(52));
console.log(
    fallos === 0
        ? "El acceso solo entra por liveness.\n"
        : `${fallos} integración(es) reabren el acceso por fotografía.\n`
);
process.exit(fallos === 0 ? 0 : 1);
