#!/usr/bin/env node
/**
 * Comprueba en el Terraform que nada quede suelto cuando se reemplaza un
 * despliegue de API Gateway, y que la API de liveness tenga sus límites.
 *
 * Por qué existe: los despliegues declaran la etapa "prod" en línea. Cada
 * vez que un cambio los reemplaza, AWS borra la etapa y la vuelve a crear,
 * y con ella se pierde todo lo que estaba colgado de la etapa: la
 * asociación del plan de uso (las llaves empiezan a dar 403), la del WAF
 * (el API queda sin firewall) y los límites de solicitudes. Terraform no
 * lo nota, porque en su configuración la etapa sigue llamándose igual.
 * Pasó con los planes de uso el 8 de octubre y casi pasa con el WAF el 25,
 * donde solo se vio leyendo el plan. La solución es replace_triggered_by
 * hacia el despliegue; esto vigila que ningún recurso nuevo se lo salte.
 *
 *   node pruebas/etapas/prueba.js
 */

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..", "..");
const ARCHIVOS = fs.readdirSync(RAIZ).filter(n => n.endsWith(".tf"));

let fallos = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const mal = (m) => { console.log(`  ✗ ${m}`); fallos++; };

/** Texto de todos los .tf sin las líneas de comentario. */
const tf = ARCHIVOS
    .map(a => fs.readFileSync(path.join(RAIZ, a), "utf8"))
    .join("\n")
    .split("\n").filter(l => !/^\s*#/.test(l)).join("\n");

/** Bloques `resource "tipo" "nombre" { ... }`, recortados contando llaves. */
function bloques(tipo) {
    const lista = [];
    const re = new RegExp(`resource\\s+"${tipo}"\\s+"([^"]+)"\\s*\\{`, "g");
    for (const m of tf.matchAll(re)) {
        let nivel = 0, fin = m.index;
        for (let i = tf.indexOf("{", m.index); i < tf.length; i++) {
            if (tf[i] === "{") nivel++;
            else if (tf[i] === "}") { nivel--; if (nivel === 0) { fin = i; break; } }
        }
        lista.push({ nombre: m[1], cuerpo: tf.slice(m.index, fin + 1) });
    }
    return lista;
}

// Despliegues con la etapa en línea: los que se llevan la etapa al reemplazarse.
const conEtapa = new Set(bloques("aws_api_gateway_deployment")
    .filter(b => /stage_name\s*=/.test(b.cuerpo))
    .map(b => b.nombre));

// waf.tf arma los ARN de las etapas en un local; se resuelve a qué
// despliegue apunta cada clave.
const etapaArn = {};
const local = /etapa_arn\s*=\s*\{([\s\S]*?)\n\s*\}/.exec(tf);
if (local) {
    for (const m of local[1].matchAll(/(\w+)\s*=\s*".*?aws_api_gateway_deployment\.(\w+)\.stage_name/g)) {
        etapaArn[m[1]] = m[2];
    }
}

console.log("\nRecursos que cuelgan de una etapa\n" + "─".repeat(52));

const TIPOS = [
    "aws_wafv2_web_acl_association",
    "aws_api_gateway_usage_plan",
    "aws_api_gateway_method_settings",
];
let revisados = 0;
for (const tipo of TIPOS) {
    for (const { nombre, cuerpo } of bloques(tipo)) {
        const deps = new Set();
        for (const m of cuerpo.matchAll(/aws_api_gateway_deployment\.(\w+)\.stage_name/g)) deps.add(m[1]);
        for (const m of cuerpo.matchAll(/local\.etapa_arn\.(\w+)/g)) if (etapaArn[m[1]]) deps.add(etapaArn[m[1]]);

        for (const dep of deps) {
            if (!conEtapa.has(dep)) continue;
            revisados++;
            const rtb = /replace_triggered_by\s*=\s*\[([^\]]*)\]/.exec(cuerpo);
            if (rtb && rtb[1].includes(`aws_api_gateway_deployment.${dep}`)) {
                ok(`${tipo}.${nombre} se recrea con ${dep}`);
            } else {
                mal(`${tipo}.${nombre} cuelga de la etapa de ${dep} y no se recrea con él: se perdería en el próximo redespliegue`);
            }
        }
    }
}
if (revisados === 0) mal("no se encontró ningún recurso de etapa: la prueba no está leyendo el Terraform");

console.log("\nProtección de la API de liveness\n" + "─".repeat(52));

// La asociación del WAF a liveness existe y está activa por defecto.
const asoc = bloques("aws_wafv2_web_acl_association").find(b => /etapa_arn\.liveness/.test(b.cuerpo));
const variable = /variable\s+"proteger_liveness"\s*\{([\s\S]*?)\n\}/.exec(tf);
if (asoc && variable && /default\s*=\s*true/.test(variable[1])) ok("el WAF se asocia a liveness por defecto");
else mal("el WAF no queda asociado a liveness con un apply normal");

// Hay una regla de límite propia para abrir sesiones.
const acl = bloques("aws_wafv2_web_acl")[0]?.cuerpo || "";
const reglas = acl.split(/\n\s*rule\s*\{/).slice(1);
const reglaSesiones = reglas.find(r =>
    /rate_based_statement/.test(r) &&
    /search_string\s*=\s*"\/liveness-init"/.test(r) &&
    /block\s*\{/.test(r));
if (reglaSesiones) {
    const limite = Number((/limit\s*=\s*(\d+)/.exec(reglaSesiones) || [])[1]);
    if (limite > 0 && limite <= 500) ok(`límite de sesiones de liveness por IP: ${limite} cada 5 minutos`);
    else mal(`el límite de sesiones de liveness (${limite}) es demasiado alto para frenar un script`);
    if (/response_code\s*=\s*429/.test(reglaSesiones) && /Access-Control-Allow-Origin/.test(reglaSesiones)) {
        ok("responde 429 con cabecera CORS, que la aplicación puede leer");
    } else {
        mal("el bloqueo de sesiones no responde 429 con CORS: el navegador lo mostraría como error de conexión");
    }
} else {
    mal("no hay una regla de WAF que limite /liveness-init");
}

// API Gateway corta antes de llegar al tope de Lambda.
const ajustes = bloques("aws_api_gateway_method_settings").find(b => /api_liveness/.test(b.cuerpo));
if (ajustes && /throttling_rate_limit/.test(ajustes.cuerpo) && /throttling_burst_limit/.test(ajustes.cuerpo)) {
    ok("la etapa de liveness tiene límite de solicitudes");
} else {
    mal("la etapa de liveness no tiene throttling: lo que pase del tope de Lambda saldría como 500");
}

// Las respuestas propias de API Gateway llevan CORS y entran en el despliegue.
// Se mira solo dentro de triggers: estar en depends_on ordena la creación,
// pero no hace que un cambio en la respuesta vuelva a publicar la etapa.
const despliegueLiveness = bloques("aws_api_gateway_deployment").find(b => /api_liveness/.test(b.cuerpo))?.cuerpo || "";
const despliegue = (/triggers\s*=\s*\{([\s\S]*?)\n\s*\}/.exec(despliegueLiveness) || [])[1] || "";
for (const tipo of ["THROTTLED", "WAF_FILTERED"]) {
    const r = bloques("aws_api_gateway_gateway_response")
        .find(b => /api_liveness/.test(b.cuerpo) && new RegExp(`response_type\\s*=\\s*"${tipo}"`).test(b.cuerpo));
    if (!r) { mal(`falta la respuesta ${tipo} con CORS en liveness`); continue; }
    if (!/Access-Control-Allow-Origin/.test(r.cuerpo)) mal(`la respuesta ${tipo} no lleva CORS`);
    else if (!despliegue.includes(`aws_api_gateway_gateway_response.${r.nombre}`)) {
        mal(`la respuesta ${tipo} no está en los triggers del despliegue: un cambio en ella no se publicaría`);
    } else ok(`respuesta ${tipo} con CORS, publicada con el despliegue`);
}

console.log("─".repeat(52));
console.log(fallos === 0 ? "Nada se suelta al redesplegar.\n" : `${fallos} problema(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
