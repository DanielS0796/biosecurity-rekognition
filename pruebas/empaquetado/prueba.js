#!/usr/bin/env node
/**
 * Verifica que el zip de cada Lambda contenga lo que su código necesita.
 *
 * Por qué existe: lambda_registrar_zip usaba source_file con un único
 * archivo, mientras registrar.js hacía require de ./instrument.js y de
 * paquetes de node_modules. El Lambda no podía ni cargar, respondía 502
 * sin cabeceras CORS, y en el navegador eso se ve como un error de
 * conexión — nada que apunte a un zip mal armado. Estuvo oculto hasta
 * que un apply tocó ese recurso por primera vez.
 */

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const TF = ["main.tf", "liveness-api.tf"];

/** Bloques `data "archive_file" "x" { ... }` de los archivos .tf. */
function leerArchivos() {
    const encontrados = {};
    for (const archivo of TF) {
        const ruta = path.join(RAIZ, archivo);
        if (!fs.existsSync(ruta)) continue;
        const texto = fs.readFileSync(ruta, "utf8");
        for (const m of texto.matchAll(/data\s+"archive_file"\s+"([^"]+)"\s*\{([\s\S]*?)\n\}/g)) {
            const cuerpo = m[2].split("\n").filter(l => !l.trim().startsWith("#")).join("\n");
            encontrados[m[1]] = {
                archivo,
                tieneDir: /source_dir\s*=/.test(cuerpo),
                soloArchivo: (cuerpo.match(/source_file\s*=\s*"([^"]+)"/) || [])[1] || null,
            };
        }
    }
    return encontrados;
}

/** Lambdas y el archive_file del que sacan su código. */
function leerLambdas() {
    const lista = [];
    for (const archivo of TF) {
        const ruta = path.join(RAIZ, archivo);
        if (!fs.existsSync(ruta)) continue;
        const texto = fs.readFileSync(ruta, "utf8");
        for (const m of texto.matchAll(/resource\s+"aws_lambda_function"\s+"([^"]+)"\s*\{([\s\S]*?)\n\}/g)) {
            const cuerpo = m[2];
            const zip = (cuerpo.match(/data\.archive_file\.(\w+)\.output_path/) || [])[1];
            const handler = (cuerpo.match(/handler\s*=\s*"([^".]+)\./) || [])[1];
            if (zip && handler) lista.push({ nombre: m[1], zip, handler });
        }
    }
    return lista;
}

/** require(...) de un archivo, separados en relativos y paquetes. */
function dependencias(archivoJs) {
    const ruta = path.join(RAIZ, "lambda", `${archivoJs}.js`);
    if (!fs.existsSync(ruta)) return null;
    const codigo = fs.readFileSync(ruta, "utf8");
    const relativos = [], paquetes = [];
    for (const m of codigo.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
        const dep = m[1];
        if (dep.startsWith(".")) relativos.push(dep);
        else if (!["crypto", "fs", "path", "util", "http", "https", "url", "os"].includes(dep)) paquetes.push(dep);
    }
    return { relativos: [...new Set(relativos)], paquetes: [...new Set(paquetes)] };
}

let fallos = 0;
console.log("\nEmpaquetado de los Lambdas\n" + "─".repeat(52));

const archivos = leerArchivos();
for (const { nombre, zip, handler } of leerLambdas()) {
    const def = archivos[zip];
    if (!def) {
        console.log(`  ✗ ${nombre} — no se encontró data.archive_file.${zip}`);
        fallos++;
        continue;
    }

    const deps = dependencias(handler);
    if (!deps) {
        console.log(`  ✗ ${nombre} — no existe lambda/${handler}.js`);
        fallos++;
        continue;
    }

    const necesitaCarpeta = deps.relativos.length > 0 || deps.paquetes.length > 0;

    if (necesitaCarpeta && !def.tieneDir) {
        const motivo = [
            deps.relativos.length ? `require relativo (${deps.relativos.join(", ")})` : null,
            deps.paquetes.length ? `paquetes (${deps.paquetes.slice(0, 3).join(", ")}${deps.paquetes.length > 3 ? "…" : ""})` : null,
        ].filter(Boolean).join(" y ");
        console.log(`  ✗ ${nombre} — ${zip} usa source_file, pero ${handler}.js necesita ${motivo}`);
        fallos++;
        continue;
    }

    console.log(`  ✓ ${nombre} — ${handler}.js, ${deps.paquetes.length} paquete(s), empaquetado completo`);
}

// node_modules tiene que existir antes del apply, o el zip sale vacío de
// dependencias aunque el source_dir esté bien.
const nm = path.join(RAIZ, "lambda", "node_modules");
if (!fs.existsSync(nm)) {
    console.log("  ! lambda/node_modules no existe: corre npm install antes del apply");
}

console.log("─".repeat(52));
console.log(fallos === 0 ? "Paquetes completos.\n" : `${fallos} Lambda(s) con el paquete incompleto.\n`);
process.exit(fallos === 0 ? 0 : 1);
