// Initialize Sentry FIRST
require("./instrument.js");
const Sentry = require("@sentry/aws-serverless");

const {
    DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand,
    ScanCommand, UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });

const TABLA_USUARIOS = process.env.TABLA_USUARIOS || "biosecurity-usuarios";
const TABLA_CODIGOS = process.env.TABLA_CODIGOS || "biosecurity-reset-codes";

const ROLES_VALIDOS = ["rrhh", "auditoria"];

// Intentos permitidos sobre un código de recuperación antes de invalidarlo.
// Son seis dígitos: sin este tope, un script los prueba todos y se queda con
// la cuenta.
const MAX_INTENTOS_CODIGO = Number(process.env.MAX_INTENTOS_CODIGO || 5);

// Acceso de emergencia. Antes era un usuario con la contraseña escrita en este
// archivo, que vive en un repositorio. Ahora sale de variables de entorno y se
// guarda hasheado; si no están definidas, simplemente no existe.
const ADMIN_EMERGENCIA = process.env.ADMIN_EMERGENCIA_USUARIO || "";
const ADMIN_EMERGENCIA_HASH = process.env.ADMIN_EMERGENCIA_HASH || "";
const ADMIN_EMERGENCIA_CORREO = process.env.ADMIN_EMERGENCIA_CORREO || "";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.SMTP_USUARIO || "",
        pass: process.env.SMTP_CLAVE || "",
    },
});

function log(level, message, data = {}) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        module: process.env.MODULE_NAME || "reset",
        message,
        ...data,
    }));
}

const responder = (statusCode, payload) => ({
    statusCode, headers: CORS, body: JSON.stringify(payload),
});
const error = (statusCode, descripcion, extra = {}) =>
    responder(statusCode, { codigo: 1, descripcion, ...extra });

/* ════════════════════════════════════════════════════════════
 * Contraseñas
 * ════════════════════════════════════════════════════════════ */

// scrypt viene en el módulo crypto de Node, así que no hace falta sumar una
// dependencia al Lambda. Los parámetros son los recomendados por OWASP.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashear(clave) {
    const sal = crypto.randomBytes(16);
    const derivada = crypto.scryptSync(clave, sal, SCRYPT.keylen, {
        N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
    });
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString("hex")}$${derivada.toString("hex")}`;
}

const esHash = (v) => typeof v === "string" && v.startsWith("scrypt$");

function verificarHash(clave, guardado) {
    try {
        const [, N, r, p, salHex, hashHex] = guardado.split("$");
        const derivada = crypto.scryptSync(clave, Buffer.from(salHex, "hex"), hashHex.length / 2, {
            N: Number(N), r: Number(r), p: Number(p),
        });
        // Comparación en tiempo constante: comparar con === filtra información
        // por el tiempo que tarda en fallar.
        return crypto.timingSafeEqual(derivada, Buffer.from(hashHex, "hex"));
    } catch (e) {
        log("WARN", "Hash con formato inesperado", { error: e.message });
        return false;
    }
}

const REGLAS = [
    { prueba: (c) => c.length >= 10, texto: "al menos 10 caracteres" },
    { prueba: (c) => /[A-ZÁÉÍÓÚÑ]/.test(c), texto: "una letra mayúscula" },
    { prueba: (c) => /[a-záéíóúñ]/.test(c), texto: "una letra minúscula" },
    { prueba: (c) => /[0-9]/.test(c), texto: "un número" },
    { prueba: (c) => /[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/.test(c), texto: "un símbolo" },
];

// La validación vive en el servidor porque la del formulario se puede saltar
// llamando al endpoint directamente.
function validarClave(clave, usuario = "") {
    if (typeof clave !== "string") return "La contraseña no es válida";

    const faltantes = REGLAS.filter(r => !r.prueba(clave)).map(r => r.texto);
    if (faltantes.length) {
        return `La contraseña debe tener ${faltantes.join(", ")}`;
    }
    if (usuario && clave.toLowerCase().includes(usuario.toLowerCase())) {
        return "La contraseña no puede contener el nombre de usuario";
    }
    return null;
}

// Contraseña temporal que cumple la política, para entregar en el momento de
// crear el usuario. Nunca viaja por correo.
function generarClaveTemporal() {
    const may = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const min = "abcdefghijkmnopqrstuvwxyz";
    const num = "23456789";
    const sim = "!@#$%&*?";
    const todo = may + min + num + sim;
    const al = (s) => s[crypto.randomInt(s.length)];

    let c = [al(may), al(min), al(num), al(sim)];
    while (c.length < 12) c.push(al(todo));
    // Mezcla con Fisher-Yates y aleatoriedad criptográfica
    for (let i = c.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [c[i], c[j]] = [c[j], c[i]];
    }
    return c.join("");
}

/* ════════════════════════════════════════════════════════════
 * Usuarios
 * ════════════════════════════════════════════════════════════ */

function normalizarRoles(valor) {
    const lista = (valor || "")
        .split(",")
        .map(r => r.trim().toLowerCase())
        .filter(r => ROLES_VALIDOS.includes(r));
    return lista.length ? [...new Set(lista)] : ["rrhh"];
}

async function obtenerUsuario(email) {
    if (!email) return null;
    try {
        const item = await dynamo.send(new GetItemCommand({
            TableName: TABLA_USUARIOS,
            Key: { email: { S: email } },
        }));
        if (item.Item) {
            return {
                email: item.Item.email?.S,
                password: item.Item.password?.S || "",
                correo_reset: item.Item.correo_reset?.S || "",
                // El rol se lee del registro. Antes esta función devolvía
                // siempre ["rrhh","auditoria"], así que la separación de
                // privilegios no existía por más que se guardara el campo.
                rol: normalizarRoles(item.Item.rol?.S),
                debe_cambiar_clave: item.Item.debe_cambiar_clave?.BOOL === true,
                desde_dynamo: true,
            };
        }
    } catch (e) {
        log("WARN", "Error leyendo usuario", { error: e.message });
    }

    if (ADMIN_EMERGENCIA && ADMIN_EMERGENCIA_HASH && email === ADMIN_EMERGENCIA) {
        return {
            email: ADMIN_EMERGENCIA,
            password: ADMIN_EMERGENCIA_HASH,
            correo_reset: ADMIN_EMERGENCIA_CORREO,
            rol: ["rrhh", "auditoria"],
            debe_cambiar_clave: false,
            desde_dynamo: false,
        };
    }
    return null;
}

async function guardarClave(email, clave, { debeCambiar = false } = {}) {
    await dynamo.send(new UpdateItemCommand({
        TableName: TABLA_USUARIOS,
        Key: { email: { S: email } },
        // UpdateItem y no PutItem: el PutItem anterior reemplazaba el registro
        // entero y se llevaba por delante el rol y la fecha de creación.
        UpdateExpression: "SET password = :p, debe_cambiar_clave = :d, updated_at = :u",
        ExpressionAttributeValues: {
            ":p": { S: hashear(clave) },
            ":d": { BOOL: debeCambiar },
            ":u": { S: new Date().toISOString() },
        },
    }));
}

/* ════════════════════════════════════════════════════════════
 * Correo
 * ════════════════════════════════════════════════════════════ */

async function enviarCorreo(destinatario, asunto, html) {
    if (!process.env.SMTP_USUARIO || !process.env.SMTP_CLAVE) {
        log("WARN", "SMTP sin configurar, no se envía correo", { destinatario });
        return;
    }
    await transporter.sendMail({
        from: `"Biosecurity UCompensar" <${process.env.SMTP_USUARIO}>`,
        to: destinatario,
        subject: asunto,
        html,
    });
}

const plantilla = (cuerpo) => `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <div style="background:#4B2D8F;padding:20px;border-radius:12px 12px 0 0;text-align:center">
    <h2 style="color:white;margin:0">Biosecurity UCompensar</h2>
  </div>
  <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee">
    ${cuerpo}
  </div>
</div>`;

/* ════════════════════════════════════════════════════════════
 * Acciones
 * ════════════════════════════════════════════════════════════ */

async function login(body) {
    const { email, clave } = body;
    const usuario = await obtenerUsuario(email);

    // Mismo mensaje para usuario inexistente y contraseña incorrecta: decir
    // cuál de los dos falló permite averiguar qué usuarios existen.
    const credencialesInvalidas = () =>
        error(401, "Usuario o contraseña incorrectos");

    if (!usuario || !clave) return credencialesInvalidas();

    let valida;
    let migrar = false;

    if (esHash(usuario.password)) {
        valida = verificarHash(clave, usuario.password);
    } else {
        // Registro anterior a este cambio: la contraseña estaba en texto plano.
        // Se valida así una última vez y se re-guarda hasheada, de modo que
        // nadie queda fuera del sistema por la migración.
        valida = usuario.password.length > 0 && clave === usuario.password;
        migrar = valida && usuario.desde_dynamo;
    }

    if (!valida) {
        log("WARN", "Intento de acceso fallido", { email });
        return credencialesInvalidas();
    }

    if (migrar) {
        try {
            await guardarClave(email, clave, { debeCambiar: usuario.debe_cambiar_clave });
            log("INFO", "Contraseña migrada a hash", { email });
        } catch (e) {
            log("WARN", "No se pudo migrar la contraseña", { email, error: e.message });
        }
    }

    log("INFO", "Acceso concedido", { email, rol: usuario.rol });

    return responder(200, {
        codigo: 0,
        descripcion: "Login exitoso",
        rol: usuario.rol,
        debe_cambiar_clave: usuario.debe_cambiar_clave,
    });
}

// Cambio de contraseña desde dentro de la sesión, que es lo que exige el
// primer ingreso. Pide la contraseña actual, así que no sirve para tomar una
// cuenta ajena.
async function cambiarClavePropia(body) {
    const { email, clave_actual, nueva_clave } = body;
    if (!email || !clave_actual || !nueva_clave) {
        return error(400, "Faltan datos");
    }

    const usuario = await obtenerUsuario(email);
    if (!usuario) return error(401, "Usuario o contraseña incorrectos");

    const valida = esHash(usuario.password)
        ? verificarHash(clave_actual, usuario.password)
        : clave_actual === usuario.password;

    if (!valida) {
        log("WARN", "Cambio de contraseña con clave actual incorrecta", { email });
        return error(401, "La contraseña actual no es correcta");
    }
    if (clave_actual === nueva_clave) {
        return error(400, "La contraseña nueva debe ser distinta de la actual");
    }

    const problema = validarClave(nueva_clave, email);
    if (problema) return error(400, problema);

    if (!usuario.desde_dynamo) {
        return error(400, "El usuario de emergencia se administra por configuración");
    }

    await guardarClave(email, nueva_clave, { debeCambiar: false });
    log("INFO", "Contraseña cambiada por el usuario", { email });

    return responder(200, { codigo: 0, descripcion: "Contraseña actualizada" });
}

async function crearUsuario(body) {
    const { usuario, correo, rol } = body;

    if (!usuario || !correo) {
        return error(400, "Faltan el usuario y el correo");
    }
    if (await obtenerUsuario(usuario)) {
        return error(400, "El usuario ya existe");
    }

    const roles = normalizarRoles(Array.isArray(rol) ? rol.join(",") : rol);

    // La temporal se genera acá y se devuelve una sola vez para que quien
    // administra la entregue en persona. No viaja por correo: un mensaje con
    // la contraseña dentro queda en esa bandeja para siempre.
    const temporal = generarClaveTemporal();

    await dynamo.send(new PutItemCommand({
        TableName: TABLA_USUARIOS,
        Item: {
            email: { S: usuario },
            password: { S: hashear(temporal) },
            correo_reset: { S: correo },
            rol: { S: roles.join(",") },
            debe_cambiar_clave: { BOOL: true },
            created_at: { S: new Date().toISOString() },
        },
    }));

    try {
        await enviarCorreo(correo,
            "Tu usuario de Biosecurity UCompensar fue creado",
            plantilla(`
                <p style="color:#333">Se creó tu usuario <strong>${usuario}</strong> en el sistema de control de acceso.</p>
                <p style="color:#333">La contraseña temporal te la entrega directamente la persona que administra el sistema. Por seguridad no se envía por correo.</p>
                <p style="color:#333">Al ingresar por primera vez el sistema te pedirá cambiarla.</p>
                <p style="color:#888;font-size:13px">Si no esperabas este mensaje, avisa al área responsable.</p>`));
    } catch (e) {
        log("WARN", "Error enviando correo de bienvenida", { error: e.message });
    }

    log("INFO", "Usuario creado", { usuario, rol: roles });

    return responder(200, {
        codigo: 0,
        descripcion: `Usuario ${usuario} creado`,
        clave_temporal: temporal,
        rol: roles,
    });
}

async function eliminarUsuario(body) {
    const { usuario, usuario_actual } = body;
    if (!usuario) return error(400, "Falta el usuario a eliminar");
    if (usuario === usuario_actual) return error(400, "No puedes eliminar tu propio usuario");
    if (ADMIN_EMERGENCIA && usuario === ADMIN_EMERGENCIA) {
        return error(400, "No se puede eliminar el usuario de emergencia");
    }

    await dynamo.send(new DeleteItemCommand({
        TableName: TABLA_USUARIOS,
        Key: { email: { S: usuario } },
    }));

    log("INFO", "Usuario eliminado", { usuario });
    return responder(200, { codigo: 0, descripcion: `Usuario ${usuario} eliminado` });
}

async function listarUsuarios() {
    const r = await dynamo.send(new ScanCommand({ TableName: TABLA_USUARIOS }));
    const items = (r.Items || []).map(i => ({
        usuario: i.email?.S,
        correo: i.correo_reset?.S || "",
        rol: normalizarRoles(i.rol?.S),
        debe_cambiar_clave: i.debe_cambiar_clave?.BOOL === true,
        created_at: i.created_at?.S || "",
    }));

    if (ADMIN_EMERGENCIA && !items.some(i => i.usuario === ADMIN_EMERGENCIA)) {
        items.unshift({
            usuario: ADMIN_EMERGENCIA,
            correo: ADMIN_EMERGENCIA_CORREO,
            rol: ["rrhh", "auditoria"],
            debe_cambiar_clave: false,
            created_at: "",
        });
    }

    return responder(200, { codigo: 0, items });
}

async function solicitarCodigo(body) {
    const { email } = body;
    const usuario = await obtenerUsuario(email);

    // Respuesta idéntica exista o no el usuario, para no revelar cuáles hay.
    const respuestaNeutra = () => responder(200, {
        codigo: 0,
        descripcion: "Si el usuario existe y tiene correo registrado, se envió un código",
    });

    if (!usuario || !usuario.correo_reset) {
        log("INFO", "Solicitud de código sobre usuario inexistente o sin correo", { email });
        return respuestaNeutra();
    }

    const codigo = String(crypto.randomInt(100000, 1000000));
    const expira = Date.now() + 10 * 60 * 1000;

    await dynamo.send(new PutItemCommand({
        TableName: TABLA_CODIGOS,
        Item: {
            email: { S: email },
            codigo: { S: codigo },
            expira: { N: String(expira) },
            intentos: { N: "0" },
        },
    }));

    await enviarCorreo(usuario.correo_reset,
        "Código de restablecimiento - Biosecurity UCompensar",
        plantilla(`
            <p style="color:#333">Tu código de verificación es:</p>
            <div style="text-align:center;margin:24px 0">
              <span style="font-size:36px;font-weight:900;letter-spacing:8px;color:#4B2D8F;background:#EDE9FF;padding:16px 24px;border-radius:12px">${codigo}</span>
            </div>
            <p style="color:#888;font-size:13px">Expira en <strong>10 minutos</strong> y admite ${MAX_INTENTOS_CODIGO} intentos.</p>
            <p style="color:#888;font-size:13px">Si no pediste este código, ignora el mensaje.</p>`));

    log("INFO", "Código de recuperación enviado", { email });
    return respuestaNeutra();
}

// Valida el código llevando la cuenta de intentos. Sin este contador, seis
// dígitos se recorren enteros con un script.
async function revisarCodigo(email, codigo) {
    const item = await dynamo.send(new GetItemCommand({
        TableName: TABLA_CODIGOS,
        Key: { email: { S: email } },
    }));

    if (!item.Item) return { ok: false, respuesta: error(400, "Código inválido o expirado") };

    if (Date.now() > Number(item.Item.expira.N)) {
        await dynamo.send(new DeleteItemCommand({ TableName: TABLA_CODIGOS, Key: { email: { S: email } } }));
        return { ok: false, respuesta: error(400, "Código inválido o expirado") };
    }

    const intentos = Number(item.Item.intentos?.N || 0);
    if (intentos >= MAX_INTENTOS_CODIGO) {
        await dynamo.send(new DeleteItemCommand({ TableName: TABLA_CODIGOS, Key: { email: { S: email } } }));
        log("WARN", "Código invalidado por exceso de intentos", { email });
        return { ok: false, respuesta: error(429, "Demasiados intentos. Solicita un código nuevo.") };
    }

    // Se comparan los digests y no los textos: timingSafeEqual exige buffers
    // del mismo tamaño y lanzaría si llega un código con caracteres raros.
    const digest = (v) => crypto.createHash("sha256").update(String(v)).digest();
    const coincide = crypto.timingSafeEqual(digest(item.Item.codigo.S), digest(codigo));

    if (!coincide) {
        const quedan = MAX_INTENTOS_CODIGO - intentos - 1;
        log("WARN", "Código incorrecto", { email, intentos: intentos + 1, quedan });

        if (quedan <= 0) {
            // Agotados los intentos el código se destruye en el acto, en lugar
            // de quedar vivo hasta que expire esperando un intento más.
            await dynamo.send(new DeleteItemCommand({
                TableName: TABLA_CODIGOS, Key: { email: { S: email } },
            }));
            return { ok: false, respuesta: error(429, "Demasiados intentos. Solicita un código nuevo.") };
        }

        await dynamo.send(new UpdateItemCommand({
            TableName: TABLA_CODIGOS,
            Key: { email: { S: email } },
            UpdateExpression: "SET intentos = :i",
            ExpressionAttributeValues: { ":i": { N: String(intentos + 1) } },
        }));
        return { ok: false, respuesta: error(400, `Código incorrecto. Te quedan ${quedan} intentos.`) };
    }

    return { ok: true };
}

async function verificar(body) {
    const { email, codigo } = body;
    if (!email || !codigo) return error(400, "Faltan datos");

    const r = await revisarCodigo(email, codigo);
    if (!r.ok) return r.respuesta;

    return responder(200, { codigo: 0, descripcion: "Código verificado correctamente" });
}

async function cambiarConCodigo(body) {
    const { email, codigo, nueva_clave } = body;
    if (!email || !codigo || !nueva_clave) return error(400, "Faltan datos");

    const problema = validarClave(nueva_clave, email);
    if (problema) return error(400, problema);

    const r = await revisarCodigo(email, codigo);
    if (!r.ok) return r.respuesta;

    const usuario = await obtenerUsuario(email);
    if (!usuario) return error(404, "Usuario no encontrado");
    if (!usuario.desde_dynamo) {
        return error(400, "El usuario de emergencia se administra por configuración");
    }

    await guardarClave(email, nueva_clave, { debeCambiar: false });
    await dynamo.send(new DeleteItemCommand({
        TableName: TABLA_CODIGOS,
        Key: { email: { S: email } },
    }));

    log("INFO", "Contraseña restablecida con código", { email });
    return responder(200, { codigo: 0, descripcion: "Contraseña actualizada exitosamente" });
}

// Permite que el formulario muestre los requisitos sin duplicar las reglas.
function politica() {
    return responder(200, {
        codigo: 0,
        requisitos: REGLAS.map(r => r.texto),
        minimo: 10,
    });
}

/* ════════════════════════════════════════════════════════════
 * Router
 * ════════════════════════════════════════════════════════════ */

const ACCIONES = {
    login,
    crear_usuario: crearUsuario,
    eliminar_usuario: eliminarUsuario,
    listar_usuarios: listarUsuarios,
    solicitar: solicitarCodigo,
    verificar,
    cambiar: cambiarConCodigo,
    cambiar_clave: cambiarClavePropia,
    politica,
};

exports.handler = Sentry.wrapHandler(async (event) => {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: CORS, body: "" };
    }

    try {
        const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || event;
        const { accion } = body;
        log("INFO", "Lambda invocado", { accion });

        const manejar = ACCIONES[accion];
        if (!manejar) return error(400, "Acción no reconocida");

        return await manejar(body);

    } catch (err) {
        log("ERROR", "Error en Lambda reset", { error: err.message });
        Sentry.captureException(err);
        return error(500, "Error interno");
    }
});
