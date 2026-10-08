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

// Horas que vive la contraseña temporal. No es "de un solo uso" en el
// sentido literal de morir al primer login: si muriera ahí, cerrar la
// pestaña antes de elegir la propia dejaría al usuario fuera y habría que
// recrearlo. Sirve para una sola cosa —definir la contraseña propia— y
// vence sola.
const HORAS_CLAVE_TEMPORAL = Number(process.env.HORAS_CLAVE_TEMPORAL || 72);

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
                clave_temporal_expira: item.Item.clave_temporal_expira?.S || "",
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
            clave_temporal_expira: "",
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
        // password va con alias: DynamoDB rechaza la expresión si el nombre
        // del atributo cae en su lista de palabras reservadas, y no vale la
        // pena depender de que no esté.
        // Al definir la contraseña propia se borra el vencimiento: deja de
        // haber temporal que vigilar. Al poner una nueva temporal se
        // escribe la fecha, para que caduque sola.
        UpdateExpression: debeCambiar
            ? "SET #password = :p, debe_cambiar_clave = :d, updated_at = :u, clave_temporal_expira = :e"
            : "SET #password = :p, debe_cambiar_clave = :d, updated_at = :u REMOVE clave_temporal_expira",
        ExpressionAttributeNames: { "#password": "password" },
        ExpressionAttributeValues: {
            ":p": { S: hashear(clave) },
            ":d": { BOOL: debeCambiar },
            ":u": { S: new Date().toISOString() },
            ...(debeCambiar ? { ":e": { S: vencimientoTemporal() } } : {}),
        },
    }));
}

/** Fecha ISO hasta la que sirve una contraseña temporal recién creada. */
function vencimientoTemporal() {
    return new Date(Date.now() + HORAS_CLAVE_TEMPORAL * 3600 * 1000).toISOString();
}

/** true si la temporal ya venció. Sin fecha guardada no vence: son los
 *  usuarios creados antes de este cambio, y no se los deja afuera. */
function temporalVencida(usuario) {
    if (!usuario.debe_cambiar_clave || !usuario.clave_temporal_expira) return false;
    return new Date(usuario.clave_temporal_expira).getTime() < Date.now();
}

/* ════════════════════════════════════════════════════════════
 * Correo
 * ════════════════════════════════════════════════════════════ */

/**
 * Escapa texto que va dentro del HTML de un correo. Importa sobre todo
 * para la contraseña: el 23% de las generadas llevan "&", y un & crudo
 * puede terminar interpretado como entidad. El usuario copiaría algo
 * distinto de lo que se guardó, y el login fallaría sin explicación.
 */
const escaparHtml = (t) => String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const smtpConfigurado = () =>
    Boolean(process.env.SMTP_USUARIO && process.env.SMTP_CLAVE);

/** Oculta el correo en las respuestas: confirma a dónde fue sin exponerlo. */
function enmascararCorreo(correo) {
    const [local, dominio] = String(correo).split("@");
    if (!dominio) return "***";
    const visible = local.slice(0, 2);
    return `${visible}${"*".repeat(Math.max(local.length - 2, 1))}@${dominio}`;
}

async function enviarCorreo(destinatario, asunto, html, texto) {
    if (!smtpConfigurado()) {
        log("WARN", "SMTP sin configurar, no se envía correo", { destinatario });
        return;
    }
    await transporter.sendMail({
        from: `"Biosecurity UCompensar" <${process.env.SMTP_USUARIO}>`,
        to: destinatario,
        subject: asunto,
        html,
        // Versión en texto plano: el cliente que la muestre entrega la
        // contraseña tal cual, sin pasar por el sanitizador de HTML.
        ...(texto ? { text: texto } : {}),
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

    // La contraseña era correcta, así que decir que la temporal venció no
    // revela nada que quien la escribió no sepa ya.
    if (temporalVencida(usuario)) {
        log("WARN", "Acceso con contraseña temporal vencida", { email });
        return error(403, "La contraseña temporal venció. Usa \"¿Olvidaste tu contraseña?\" para recibir un código y definir la tuya.");
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
    if (temporalVencida(usuario)) {
        log("WARN", "Cambio con temporal vencida", { email });
        return error(403, "La contraseña temporal venció. Usa \"¿Olvidaste tu contraseña?\" para recibir un código y definir la tuya.");
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

    // Se devuelve el rol para que el front entre sin pedir login otra vez.
    return responder(200, {
        codigo: 0,
        descripcion: "Contraseña actualizada",
        rol: usuario.rol,
    });
}

async function crearUsuario(body) {
    const { usuario, correo, rol } = body;

    if (!usuario || !correo) {
        return error(400, "Faltan el usuario y el correo");
    }
    if (await obtenerUsuario(usuario)) {
        return error(400, "El usuario ya existe");
    }

    // El correo es el único canal por el que viaja la temporal. Sin SMTP el
    // usuario nacería inaccesible, así que se falla antes de crearlo.
    if (!smtpConfigurado()) {
        log("ERROR", "Intento de crear usuario sin SMTP configurado", { usuario });
        return error(503, "El envío de correo no está configurado. Avisa al administrador del sistema.");
    }

    const roles = normalizarRoles(Array.isArray(rol) ? rol.join(",") : rol);
    const temporal = generarClaveTemporal();

    await dynamo.send(new PutItemCommand({
        TableName: TABLA_USUARIOS,
        Item: {
            email: { S: usuario },
            password: { S: hashear(temporal) },
            correo_reset: { S: correo },
            rol: { S: roles.join(",") },
            debe_cambiar_clave: { BOOL: true },
            clave_temporal_expira: { S: vencimientoTemporal() },
            created_at: { S: new Date().toISOString() },
        },
    }));

    // La temporal va por correo y no se devuelve a quien crea el usuario:
    // quien administra no tiene por qué conocer una credencial ajena, ni
    // siquiera de paso.
    try {
        await enviarCorreo(correo,
            "Tu acceso a Biosecurity UCompensar",
            correoClaveTemporal(usuario, temporal),
            textoClaveTemporal(usuario, temporal));
    } catch (e) {
        // Si el correo no sale, el usuario queda con una contraseña que
        // nadie conoce. Se deshace la creación en vez de dejar ese registro.
        log("ERROR", "No se pudo enviar la temporal, se revierte la creación", {
            usuario, error: e.message,
        });
        try {
            await dynamo.send(new DeleteItemCommand({
                TableName: TABLA_USUARIOS,
                Key: { email: { S: usuario } },
            }));
        } catch (e2) {
            log("ERROR", "Falló revertir la creación del usuario", {
                usuario, error: e2.message,
            });
        }
        return error(502, "No se pudo enviar el correo. El usuario no fue creado; revisa la dirección e intenta de nuevo.");
    }

    log("INFO", "Usuario creado", { usuario, rol: roles, horas: HORAS_CLAVE_TEMPORAL });

    return responder(200, {
        codigo: 0,
        descripcion: `Usuario ${usuario} creado. Se envió la contraseña temporal a ${enmascararCorreo(correo)}.`,
        correo_enmascarado: enmascararCorreo(correo),
        horas_vigencia: HORAS_CLAVE_TEMPORAL,
        rol: roles,
    });
}

/**
 * Cambia los roles de un usuario que ya existe.
 *
 * Hasta que la separación de privilegios empezó a aplicarse de verdad,
 * obtenerUsuario devolvía ["rrhh","auditoria"] a todo el mundo y el
 * campo rol no servía para nada. Al arreglarlo, los usuarios creados
 * antes se quedaron con lo que tuvieran guardado. Esto es para
 * corregirlos sin recrearlos.
 */
async function cambiarRoles(body) {
    const { usuario, rol, usuario_actual } = body;
    if (!usuario) return error(400, "Falta el usuario");

    const pedidos = Array.isArray(rol) ? rol : String(rol || "").split(",");
    const validos = [...new Set(
        pedidos.map(r => String(r).trim().toLowerCase()).filter(r => ROLES_VALIDOS.includes(r))
    )];

    // Acá no se usa normalizarRoles: su respaldo silencioso a ["rrhh"]
    // tiene sentido al crear, pero en una edición convertiría un error
    // de la interfaz en un cambio de permisos que nadie pidió.
    if (!validos.length) return error(400, "Selecciona al menos un rol válido");

    if (ADMIN_EMERGENCIA && usuario === ADMIN_EMERGENCIA) {
        return error(400, "El usuario de emergencia se administra por configuración");
    }

    const registro = await obtenerUsuario(usuario);
    if (!registro || !registro.desde_dynamo) return error(404, "El usuario no existe");

    // Quitarse a uno mismo el rol de registro es encerrarse afuera: sin
    // él no se vuelve a entrar a esta pantalla para deshacerlo.
    if (usuario === usuario_actual && !validos.includes("rrhh")) {
        return error(400, "No puedes quitarte a ti mismo el permiso de registro");
    }

    // Y dejar la tabla sin nadie que administre usuarios tiene el mismo
    // efecto para todos. El admin de emergencia sigue siendo la salida,
    // pero no es una situación a la que se deba llegar por un clic.
    if (!validos.includes("rrhh") && registro.rol.includes("rrhh")) {
        const todos = await dynamo.send(new ScanCommand({ TableName: TABLA_USUARIOS }));
        const conRegistro = (todos.Items || [])
            .filter(i => normalizarRoles(i.rol?.S).includes("rrhh"))
            .map(i => i.email?.S);
        if (conRegistro.length <= 1) {
            return error(400, "Es el único usuario con permiso de registro. Dale ese permiso a otro antes de quitárselo a este.");
        }
    }

    await dynamo.send(new UpdateItemCommand({
        TableName: TABLA_USUARIOS,
        Key: { email: { S: usuario } },
        UpdateExpression: "SET #rol = :r, updated_at = :u",
        ExpressionAttributeNames: { "#rol": "rol" },
        ExpressionAttributeValues: {
            ":r": { S: validos.join(",") },
            ":u": { S: new Date().toISOString() },
        },
    }));

    log("INFO", "Roles cambiados", { usuario, antes: registro.rol, ahora: validos });
    return responder(200, {
        codigo: 0,
        descripcion: `Permisos de ${usuario} actualizados`,
        rol: validos,
    });
}

/** Cuerpo del correo que lleva la contraseña temporal. */
function correoClaveTemporal(usuario, temporal) {
    const u = escaparHtml(usuario);
    return plantilla(`
        <p style="color:#333">Se creó tu usuario <strong>${u}</strong> en el sistema de control de acceso.</p>
        <p style="color:#333">Usuario: <strong>${u}</strong></p>
        <p style="color:#333">Contraseña temporal:</p>
        <p style="font-family:monospace;font-size:20px;background:#f4f4f4;padding:14px 18px;border-radius:8px;color:#111;display:inline-block">${escaparHtml(temporal)}</p>
        <p style="color:#333">Sirve únicamente para entrar una vez y elegir tu propia contraseña: el sistema te la va a pedir antes de dejarte usar nada. Vence en ${HORAS_CLAVE_TEMPORAL} horas.</p>
        <p style="color:#888;font-size:13px">Nadie más recibió esta contraseña. Si no esperabas este mensaje, avisa al área responsable y no la uses.</p>`);
}

/** El mismo correo en texto plano, sin nada que un cliente pueda reescribir. */
function textoClaveTemporal(usuario, temporal) {
    return [
        `Se creó tu usuario en Biosecurity UCompensar.`,
        ``,
        `Usuario: ${usuario}`,
        `Contraseña temporal: ${temporal}`,
        ``,
        `Sirve únicamente para entrar y elegir tu propia contraseña.`,
        `Vence en ${HORAS_CLAVE_TEMPORAL} horas.`,
        ``,
        `Nadie más recibió esta contraseña. Si no esperabas este mensaje,`,
        `avisa al área responsable y no la uses.`,
    ].join("\n");
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
        es_emergencia: false,
    }));

    if (ADMIN_EMERGENCIA && !items.some(i => i.usuario === ADMIN_EMERGENCIA)) {
        items.unshift({
            usuario: ADMIN_EMERGENCIA,
            correo: ADMIN_EMERGENCIA_CORREO,
            rol: ["rrhh", "auditoria"],
            debe_cambiar_clave: false,
            created_at: "",
            // Lo marca el servidor y no el front: deducirlo de un
            // created_at vacío confundiría a los registros viejos que
            // tampoco lo tienen.
            es_emergencia: true,
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
            UpdateExpression: "SET #intentos = :i",
            ExpressionAttributeNames: { "#intentos": "intentos" },
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
    cambiar_roles: cambiarRoles,
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
        // El nombre del error importa tanto como el mensaje: un
        // AccessDeniedException se ve igual que cualquier otro fallo si
        // solo se registra err.message, y se pierde media hora buscando
        // en el código lo que era un permiso de IAM.
        log("ERROR", "Error en Lambda reset", {
            error: err.message,
            tipo: err.name,
            http: err.$metadata?.httpStatusCode,
        });
        Sentry.captureException(err);
        return error(500, "Error interno");
    }
});
