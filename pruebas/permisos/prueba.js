#!/usr/bin/env node
/**
 * Compara los comandos de DynamoDB que usa el código de cada Lambda
 * contra las acciones que le concede su política de IAM en Terraform.
 *
 * Por qué existe: el día que guardarClave() pasó de PutItem a UpdateItem,
 * la política se quedó con PutItem. Las 45 pruebas de reset siguieron en
 * verde porque el doble de DynamoDB no sabe de permisos, y en producción
 * el cambio de contraseña obligatorio respondía "Error interno". Esta
 * comprobación es estática y tarda milisegundos: no reemplaza a las otras
 * pruebas, cubre el hueco que ellas no pueden ver.
 *
 * Alcance: compara acciones, no ARNs. Si una política concede UpdateItem
 * pero sobre la tabla equivocada, esto pasa en verde. Hoy eso no ocurre
 * porque cada política lista sus tablas explícitamente, pero vale saberlo.
 */

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");

// Comando del SDK -> acción de IAM que exige.
const ACCION = {
    PutItemCommand: "dynamodb:PutItem",
    GetItemCommand: "dynamodb:GetItem",
    UpdateItemCommand: "dynamodb:UpdateItem",
    DeleteItemCommand: "dynamodb:DeleteItem",
    ScanCommand: "dynamodb:Scan",
    QueryCommand: "dynamodb:Query",
    BatchWriteItemCommand: "dynamodb:BatchWriteItem",
    BatchGetItemCommand: "dynamodb:BatchGetItem",
    TransactWriteItemsCommand: "dynamodb:TransactWriteItems",
};

// Qué política cubre a qué Lambda. Si se agrega un Lambda nuevo que toque
// DynamoDB, va acá: una entrada que falte se reporta como hueco.
const COBERTURA = [
    { codigo: "lambda/reset.js", politica: "lambda_reset_policy", archivo: "main.tf" },
    { codigo: "lambda/liveness.js", politica: "lambda_liveness_policy", archivo: "liveness-iam.tf" },
    { codigo: "lambda/auditoria.js", politica: "lambda_dynamo_policy", archivo: "main.tf" },
    { codigo: "lambda/index.js", politica: "lambda_dynamo_policy", archivo: "main.tf" },
    { codigo: "lambda/registrar.js", politica: "lambda_dynamo_policy", archivo: "main.tf" },
];

/** Comandos de DynamoDB que aparecen instanciados en un archivo. */
function comandosUsados(ruta) {
    const codigo = fs.readFileSync(path.join(RAIZ, ruta), "utf8");
    const usados = new Set();
    for (const comando of Object.keys(ACCION)) {
        if (new RegExp(`new\\s+${comando}\\s*\\(`).test(codigo)) usados.add(comando);
    }
    return usados;
}

/**
 * Acciones dynamodb:* concedidas por un resource de política.
 * Se recorta el bloque contando llaves desde la declaración del recurso,
 * y se descartan los comentarios para que un `# "dynamodb:UpdateItem"`
 * comentado no cuente como permiso.
 */
function accionesConcedidas(archivo, politica) {
    const texto = fs.readFileSync(path.join(RAIZ, archivo), "utf8");
    const inicio = texto.indexOf(`resource "aws_iam_role_policy" "${politica}"`);
    if (inicio === -1) return null;

    let nivel = 0, fin = inicio;
    for (let i = texto.indexOf("{", inicio); i < texto.length; i++) {
        if (texto[i] === "{") nivel++;
        else if (texto[i] === "}") { nivel--; if (nivel === 0) { fin = i; break; } }
    }

    const bloque = texto.slice(inicio, fin)
        .split("\n")
        .filter(l => !l.trim().startsWith("#"))
        .join("\n");

    const concedidas = new Set();
    for (const m of bloque.matchAll(/"(dynamodb:[A-Za-z]+)"/g)) concedidas.add(m[1]);
    // Un comodín cubre todo lo demás.
    if (/"dynamodb:\*"/.test(bloque)) Object.values(ACCION).forEach(a => concedidas.add(a));
    return concedidas;
}

let fallos = 0;
console.log("\nPermisos de IAM frente al código\n" + "─".repeat(52));

// Todo archivo de lambda/ que use DynamoDB tiene que estar en COBERTURA.
const declarados = new Set(COBERTURA.map(c => c.codigo));
for (const nombre of fs.readdirSync(path.join(RAIZ, "lambda")).filter(n => n.endsWith(".js"))) {
    const ruta = `lambda/${nombre}`;
    if (declarados.has(ruta)) continue;
    if (comandosUsados(ruta).size > 0) {
        console.log(`  ✗ ${ruta} usa DynamoDB y no está en COBERTURA`);
        fallos++;
    }
}

for (const { codigo, politica, archivo } of COBERTURA) {
    const usados = comandosUsados(codigo);
    if (usados.size === 0) { console.log(`  · ${codigo} no usa DynamoDB`); continue; }

    const concedidas = accionesConcedidas(archivo, politica);
    if (!concedidas) {
        console.log(`  ✗ ${codigo} apunta a ${politica}, que no existe en ${archivo}`);
        fallos++;
        continue;
    }

    const faltantes = [...usados]
        .map(c => ACCION[c])
        .filter(a => !concedidas.has(a));

    if (faltantes.length) {
        console.log(`  ✗ ${codigo} — ${politica} no concede: ${faltantes.join(", ")}`);
        fallos++;
    } else {
        console.log(`  ✓ ${codigo} — ${[...usados].map(c => ACCION[c].split(":")[1]).join(", ")}`);
    }
}

console.log("─".repeat(52));
console.log(fallos === 0 ? "Sin huecos de permisos.\n" : `${fallos} hueco(s) de permisos.\n`);
process.exit(fallos === 0 ? 0 : 1);
