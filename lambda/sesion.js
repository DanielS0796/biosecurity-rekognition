/**
 * Sesión firmada para las acciones administrativas.
 *
 * Antes, la sesión existía solo en el navegador. La función de reset
 * respondía al login con el rol y nada más, y desde ahí cualquiera que
 * llamara directo a las APIs podía crear usuarios, cambiar roles, borrar
 * personas o pedir un registro facial, sin haber iniciado sesión. La
 * interfaz escondía los botones, pero el servidor no preguntaba quién
 * llamaba (riesgo R09 de la matriz, en nivel extremo).
 *
 * Ahora el login entrega un token firmado con HMAC-SHA256 y cada acción
 * administrativa lo exige. El token dice quién es la persona y hasta cuándo
 * vale. El rol no se toma del token sino de la tabla de usuarios en cada
 * petición, de modo que si a alguien le quitan un rol o lo eliminan, pierde
 * el acceso en la siguiente solicitud y no cuando venza el token.
 *
 * Es el formato de un JWT (header.payload.firma en base64url), así que
 * cualquier decodificador de JWT lo puede leer. Se escribe a mano porque
 * son pocas líneas con el módulo crypto de Node y no vale la pena sumar
 * una dependencia a las cuatro Lambdas.
 */
const crypto = require("crypto");

const ROLES_VALIDOS = ["rrhh", "auditoria"];
const ALG = "HS256";

// El secreto llega por variable de entorno desde terraform.tfvars, que no se
// versiona. Menos de 32 caracteres se trata como ausente: un secreto corto
// se adivina por fuerza bruta y con él se firman tokens de cualquiera.
function secreto() {
    const s = process.env.SESION_SECRETO || "";
    return s.length >= 32 ? s : null;
}

function horasVigencia() {
    const h = Number(process.env.SESION_HORAS || 8);
    return Number.isFinite(h) && h > 0 ? h : 8;
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function firma(datos, clave) {
    return crypto.createHmac("sha256", clave).update(datos).digest("base64url");
}

/**
 * Crea el token de una persona que acaba de iniciar sesión.
 * Devuelve null si no hay secreto configurado: sin secreto no se puede
 * emitir nada que después se pueda verificar.
 */
function emitir(usuario, ahora = Date.now()) {
    const clave = secreto();
    if (!clave || !usuario) return null;

    const iat = Math.floor(ahora / 1000);
    const cuerpo = {
        sub: String(usuario),
        iat,
        exp: iat + Math.round(horasVigencia() * 3600),
        // Identificador único del token, útil para rastrearlo en los logs.
        jti: crypto.randomBytes(9).toString("base64url"),
    };
    const datos = `${b64({ alg: ALG, typ: "JWT" })}.${b64(cuerpo)}`;
    return { token: `${datos}.${firma(datos, clave)}`, expira: cuerpo.exp };
}

/**
 * Revisa firma y vigencia. No consulta la base: eso lo hace exigir().
 * Devuelve { ok: true, sub } o { ok: false, motivo }.
 */
function verificar(token, ahora = Date.now()) {
    const clave = secreto();
    if (!clave) return { ok: false, motivo: "sin_secreto" };
    if (typeof token !== "string") return { ok: false, motivo: "sin_token" };

    const partes = token.split(".");
    if (partes.length !== 3) return { ok: false, motivo: "formato" };
    const [h, p, f] = partes;

    let header, cuerpo;
    try {
        header = JSON.parse(Buffer.from(h, "base64url").toString());
        cuerpo = JSON.parse(Buffer.from(p, "base64url").toString());
    } catch {
        return { ok: false, motivo: "formato" };
    }

    // El algoritmo se fija acá y no se lee del token. Si se aceptara lo que
    // el token declara, uno con "alg":"none" pasaría sin firma.
    if (header?.alg !== ALG) return { ok: false, motivo: "algoritmo" };

    const esperada = Buffer.from(firma(`${h}.${p}`, clave));
    const recibida = Buffer.from(f);
    if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) {
        return { ok: false, motivo: "firma" };
    }

    const seg = Math.floor(ahora / 1000);
    if (typeof cuerpo.exp !== "number" || seg >= cuerpo.exp) return { ok: false, motivo: "vencido" };
    // Un token emitido "en el futuro" solo sale de un reloj alterado o de
    // alguien que tiene el secreto. Se deja un minuto de margen.
    if (typeof cuerpo.iat !== "number" || cuerpo.iat > seg + 60) return { ok: false, motivo: "fecha" };
    if (!cuerpo.sub) return { ok: false, motivo: "sin_usuario" };

    return { ok: true, sub: cuerpo.sub, jti: cuerpo.jti, exp: cuerpo.exp };
}

/** Saca el token de la cabecera Authorization: Bearer <token>. */
function leerToken(event) {
    const cabeceras = event?.headers || {};
    const valor = Object.entries(cabeceras)
        .find(([k]) => k.toLowerCase() === "authorization")?.[1];
    const m = /^Bearer\s+(.+)$/i.exec(String(valor || "").trim());
    return m ? m[1].trim() : null;
}

/**
 * Roles actuales de una persona según la tabla de usuarios. null si ya no
 * existe. El usuario de emergencia no vive en la tabla; se reconoce por la
 * variable de entorno, igual que en el login.
 */
async function rolesDesdeTabla(usuario) {
    const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");
    const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
    const r = await dynamo.send(new GetItemCommand({
        TableName: process.env.TABLA_USUARIOS || "biosecurity-usuarios",
        Key: { email: { S: usuario } },
    }));
    if (r.Item) {
        const roles = (r.Item.rol?.S || "")
            .split(",").map(x => x.trim().toLowerCase())
            .filter(x => ROLES_VALIDOS.includes(x));
        return roles.length ? roles : ["rrhh"];
    }
    const emergencia = process.env.ADMIN_EMERGENCIA_USUARIO || "";
    if (emergencia && usuario === emergencia) return ["rrhh", "auditoria"];
    return null;
}

/**
 * Exige una sesión válida con el rol indicado.
 *
 *   const s = await exigir(event, "rrhh");
 *   if (!s.ok) return responder(s.status, { codigo: 1, descripcion: s.descripcion });
 *   // s.usuario es quien llama, según el servidor y no según el cuerpo.
 *
 * 401 cuando no hay sesión o no sirve; 403 cuando la hay pero sin el rol.
 * Las respuestas no dicen cuál de las comprobaciones falló: eso queda en el
 * log, que es donde le sirve a quien investiga y no a quien ataca.
 */
async function exigir(event, rol, { cargarRoles = rolesDesdeTabla, log = () => {} } = {}) {
    const v = verificar(leerToken(event));
    if (!v.ok) {
        if (v.motivo === "sin_secreto") {
            // Falla cerrado: sin secreto nadie entra, ni siquiera con un token
            // que parezca válido. Es un error de configuración, no del usuario.
            log("ERROR", "SESION_SECRETO no configurado o demasiado corto");
            return { ok: false, status: 503, descripcion: "El servicio no está configurado. Avisa al administrador del sistema." };
        }
        log("WARN", "Sesión rechazada", { motivo: v.motivo, rol_pedido: rol });
        return { ok: false, status: 401, descripcion: "Tu sesión no es válida o ya venció. Inicia sesión de nuevo." };
    }

    let roles;
    try {
        roles = await cargarRoles(v.sub);
    } catch (e) {
        log("ERROR", "No se pudo leer el usuario de la sesión", { usuario: v.sub, error: e.message });
        return { ok: false, status: 503, descripcion: "No se pudo verificar la sesión. Intenta de nuevo." };
    }

    if (!roles) {
        log("WARN", "Sesión de un usuario que ya no existe", { usuario: v.sub, jti: v.jti });
        return { ok: false, status: 401, descripcion: "Tu sesión no es válida o ya venció. Inicia sesión de nuevo." };
    }
    if (rol && !roles.includes(rol)) {
        log("WARN", "Acción sin el rol requerido", { usuario: v.sub, roles, rol_pedido: rol, jti: v.jti });
        return { ok: false, status: 403, descripcion: "No tienes permiso para esta acción." };
    }

    return { ok: true, usuario: v.sub, roles, jti: v.jti };
}

module.exports = { emitir, verificar, leerToken, exigir, rolesDesdeTabla, ROLES_VALIDOS };
