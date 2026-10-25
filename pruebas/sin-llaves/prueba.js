#!/usr/bin/env node
/**
 * Vigila que las llaves de API no vuelvan al navegador (riesgo R19).
 *
 * Hasta el 25 de octubre de 2026 las APIs de RR. HH. y auditoría exigían
 * una llave, y la llave estaba escrita en frontend/app/config.js: viajaba
 * en el JavaScript que descarga cualquiera. Desde que cada Lambda exige
 * una sesión firmada, la llave sobra y se retiró. Esto falla si alguien la
 * vuelve a poner, por costumbre o copiando código viejo.
 *
 *   node pruebas/sin-llaves/prueba.js
 */

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
let fallos = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const mal = (m) => { console.log(`  ✗ ${m}`); fallos++; };

console.log("\nLlaves de API fuera del navegador\n" + "─".repeat(52));

// 1. Ningún método de API Gateway exige llave.
const tf = fs.readdirSync(RAIZ).filter(n => n.endsWith(".tf"))
    .map(n => [n, fs.readFileSync(path.join(RAIZ, n), "utf8")]);
const exigen = tf.flatMap(([n, t]) =>
    t.split("\n").filter(l => !/^\s*#/.test(l) && /api_key_required\s*=\s*true/.test(l)).map(() => n));
if (exigen.length) mal(`hay métodos que exigen llave de API en: ${[...new Set(exigen)].join(", ")}`);
else ok("ningún método de API Gateway exige llave de API");

// 2. El frontend no manda ni guarda llaves.
function archivos(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...archivos(p));
        else if (/\.(js|jsx|ts|tsx|mjs)$/.test(e.name)) out.push(p);
    }
    return out;
}
const app = path.join(RAIZ, "frontend", "app");
const conCabecera = [], conLlave = [];
for (const f of archivos(app)) {
    const codigo = fs.readFileSync(f, "utf8")
        .split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
    if (/x-api-key/i.test(codigo) || /API_KEY_/.test(codigo)) conCabecera.push(path.relative(RAIZ, f));
    // Las llaves de API Gateway son cadenas de 40 caracteres alfanuméricos.
    if (/["'][A-Za-z0-9]{40}["']/.test(codigo)) conLlave.push(path.relative(RAIZ, f));
}
if (conCabecera.length) mal(`el frontend todavía manda x-api-key en: ${conCabecera.join(", ")}`);
else ok("el frontend no manda la cabecera x-api-key");
if (conLlave.length) mal(`hay algo con forma de llave de API en: ${conLlave.join(", ")}`);
else ok("no hay cadenas con forma de llave de API en el frontend");

console.log("─".repeat(52));
console.log(fallos === 0 ? "Las llaves no viajan al navegador.\n" : `${fallos} problema(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
