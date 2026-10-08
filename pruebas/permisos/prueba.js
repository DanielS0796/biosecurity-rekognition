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

// Qué política cubre a qué Lambda, por nombre del recurso de Terraform.
// Un Lambda nuevo que toque DynamoDB y no esté acá se reporta como hueco.
const COBERTURA = {
    reset: { politica: "lambda_reset_policy", archivo: "main.tf" },
    liveness: { politica: "lambda_liveness_policy", archivo: "liveness-iam.tf" },
    auditoria: { politica: "lambda_dynamo_policy", archivo: "main.tf" },
    validacion_biometrica: { politica: "lambda_dynamo_policy", archivo: "main.tf" },
    registrar_empleado: { politica: "lambda_dynamo_policy", archivo: "main.tf" },
};

const TF = ["main.tf", "liveness-api.tf"];

/**
 * Lambdas declarados en Terraform y el archivo que ejecuta cada uno.
 * Se parte de acá y no del listado de lambda/, porque esa carpeta puede
 * tener archivos sueltos que no son el handler de nadie: se empaquetan
 * de más, pero no corren, y bloquear el despliegue por ellos sería
 * ruido.
 */
function lambdasDeclarados() {
    const lista = [];
    for (const archivo of TF) {
        const ruta = path.join(RAIZ, archivo);
        if (!fs.existsSync(ruta)) continue;
        const texto = fs.readFileSync(ruta, "utf8");
        for (const m of texto.matchAll(/resource\s+"aws_lambda_function"\s+"([^"]+)"\s*\{([\s\S]*?)\n\}/g)) {
            const handler = (m[2].match(/handler\s*=\s*"([^".]+)\./) || [])[1];
            if (handler) lista.push({ recurso: m[1], codigo: `lambda/${handler}.js` });
        }
    }
    return lista;
}

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

for (const { recurso, codigo } of lambdasDeclarados()) {
    if (!fs.existsSync(path.join(RAIZ, codigo))) {
        console.log(`  ✗ ${recurso} apunta a ${codigo}, que no existe`);
        fallos++;
        continue;
    }

    const usados = comandosUsados(codigo);
    if (usados.size === 0) { console.log(`  · ${codigo} no usa DynamoDB`); continue; }

    const cobertura = COBERTURA[recurso];
    if (!cobertura) {
        console.log(`  ✗ ${recurso} usa DynamoDB y no está en COBERTURA`);
        fallos++;
        continue;
    }
    const { politica, archivo } = cobertura;

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

// Aviso, no fallo: archivos en lambda/ que no son el handler de nadie.
// Viajan dentro de todos los zips porque se empaqueta la carpeta entera,
// así que conviene saber que están, pero no corren y no bloquean nada.
const handlers = new Set(lambdasDeclarados().map(l => path.basename(l.codigo)));
const sueltos = fs.readdirSync(path.join(RAIZ, "lambda"))
    .filter(n => n.endsWith(".js") && !handlers.has(n) && n !== "instrument.js");
if (sueltos.length) {
    console.log(`  ! sin usar, pero dentro de cada zip: ${sueltos.join(", ")}`);
}

console.log("─".repeat(52));
console.log(fallos === 0 ? "Sin huecos de permisos.\n" : `${fallos} hueco(s) de permisos.\n`);
process.exit(fallos === 0 ? 0 : 1);
