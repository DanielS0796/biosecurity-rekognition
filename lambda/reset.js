const { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb");
const nodemailer = require("nodemailer");

const dynamo = new DynamoDBClient({ region: "us-east-1" });

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
};

const USUARIO_BASE = {
    email: "dfguatibonza",
    pass_default: "clave123",
    correo_reset: "danielsuarez0796@gmail.com",
    rol: ["rrhh", "auditoria"]
};

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "biosecurityucompensar@gmail.com",
        pass: "ymhc vgey hzfa jnxb"
    }
});

async function enviarCorreo(destinatario, asunto, html) {
    await transporter.sendMail({
        from: '"Biosecurity UCompensar" <biosecurityucompensar@gmail.com>',
        to: destinatario,
        subject: asunto,
        html
    });
}

// Obtener usuario desde DynamoDB o base
async function obtenerUsuario(email) {
    // Primero verificar en DynamoDB
    try {
        const item = await dynamo.send(new GetItemCommand({
            TableName: "biosecurity-usuarios",
            Key: { email: { S: email } }
        }));
        if (item.Item) {
            return {
                email: item.Item.email?.S,
                password: item.Item.password?.S,
                correo_reset: item.Item.correo_reset?.S,
                rol: ["rrhh", "auditoria"],
                desde_dynamo: true
            };
        }
    } catch(e) {}

    // Si no está en DynamoDB, verificar usuario base
    if (email === USUARIO_BASE.email) {
        return { ...USUARIO_BASE, desde_dynamo: false };
    }

    return null;
}

exports.handler = async (event) => {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers: CORS, body: "" };
    }

    const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || event;
    const { accion } = body;

    // ── LOGIN ──
    if (accion === "login") {
        const { email, clave } = body;
        const usuario = await obtenerUsuario(email);

        if (!usuario) {
            return { statusCode: 401, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Usuario no encontrado" }) };
        }

        // Contraseña válida: si está en DynamoDB usa esa, si no usa la default
        const passValida = usuario.desde_dynamo ? usuario.password : usuario.pass_default;

        if (clave !== passValida) {
            return { statusCode: 401, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Contraseña incorrecta" }) };
        }

        return {
            statusCode: 200, headers: CORS,
            body: JSON.stringify({ codigo: 0, descripcion: "Login exitoso", rol: ["rrhh", "auditoria"] })
        };
    }

    // ── CREAR USUARIO ──
    if (accion === "crear_usuario") {
        const { usuario, correo, clave } = body;

        if (!usuario || !correo || !clave) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Faltan campos obligatorios" }) };
        }
        if (clave.length < 6) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "La contraseña debe tener al menos 6 caracteres" }) };
        }

        // Verificar si ya existe
        const existente = await obtenerUsuario(usuario);
        if (existente) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "El usuario ya existe" }) };
        }

        await dynamo.send(new PutItemCommand({
            TableName: "biosecurity-usuarios",
            Item: {
                email:        { S: usuario },
                password:     { S: clave },
                correo_reset: { S: correo },
                rol:          { S: "rrhh,auditoria" },
                created_at:   { S: new Date().toISOString() }
            }
        }));

        // Verificar correo en SES automáticamente
        try {
            await enviarCorreo(correo,
                "🎉 Bienvenido al Sistema Biosecurity UCompensar",
                `
                <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
                    <div style="background:#4B2D8F;padding:20px;border-radius:12px 12px 0 0;text-align:center">
                        <h2 style="color:white;margin:0">🔐 Biosecurity UCompensar</h2>
                    </div>
                    <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee">
                        <p style="color:#333">¡Hola! Tu usuario ha sido creado exitosamente en el Sistema Biosecurity.</p>
                        <div style="background:#EDE9FF;padding:16px;border-radius:8px;margin:16px 0">
                            <p style="color:#4B2D8F;font-weight:700;margin:0 0 8px">Tus credenciales:</p>
                            <p style="color:#333;margin:4px 0">👤 <strong>Usuario:</strong> ${usuario}</p>
                            <p style="color:#333;margin:4px 0">🔑 <strong>Contraseña:</strong> ${clave}</p>
                        </div>
                        <p style="color:#888;font-size:13px">⚠️ Por seguridad, te recomendamos cambiar tu contraseña después de iniciar sesión.</p>
                        <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
                        <p style="color:#bbb;font-size:11px;text-align:center">Sistema Biosecurity · UCompensar · us-east-1</p>
                    </div>
                </div>`
            );
        } catch(e) {
            console.log("Error enviando correo bienvenida:", e.message);
        }

        return {
            statusCode: 200, headers: CORS,
            body: JSON.stringify({ codigo: 0, descripcion: `Usuario ${usuario} creado exitosamente. Se ha enviado un correo de bienvenida.` })
        };
    }

    // ── ELIMINAR USUARIO ──
    if (accion === "eliminar_usuario") {
        const { usuario, usuario_actual } = body;

        if (!usuario) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Falta el usuario a eliminar" }) };
        }
        if (usuario === usuario_actual) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "No puedes eliminar tu propio usuario" }) };
        }
        if (usuario === USUARIO_BASE.email) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "No se puede eliminar el usuario administrador base" }) };
        }

        await dynamo.send(new DeleteItemCommand({
            TableName: "biosecurity-usuarios",
            Key: { email: { S: usuario } }
        }));

        return {
            statusCode: 200, headers: CORS,
            body: JSON.stringify({ codigo: 0, descripcion: `Usuario ${usuario} eliminado exitosamente` })
        };
    }

    // ── LISTAR USUARIOS ──
    if (accion === "listar_usuarios") {
        try {
            const result = await dynamo.send(new ScanCommand({ TableName: "biosecurity-usuarios" }));
            const items = (result.Items || []).map(i => ({
                usuario: i.email?.S,
                correo:  i.correo_reset?.S || "",
                created_at: i.created_at?.S || ""
            }));

            // Agregar usuario base si no está en DynamoDB
            const baseEnLista = items.find(i => i.usuario === USUARIO_BASE.email);
            if (!baseEnLista) {
                items.unshift({ usuario: USUARIO_BASE.email, correo: USUARIO_BASE.correo_reset, created_at: "" });
            }

            return {
                statusCode: 200, headers: CORS,
                body: JSON.stringify({ codigo: 0, items })
            };
        } catch(e) {
            return { statusCode: 500, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Error listando usuarios" }) };
        }
    }

    // ── SOLICITAR CÓDIGO RESET ──
    if (accion === "solicitar") {
        const { email } = body;
        const usuario = await obtenerUsuario(email);

        if (!usuario) {
            return { statusCode: 404, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Usuario no encontrado" }) };
        }

        const correoDestino = usuario.correo_reset;
        if (!correoDestino) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Este usuario no tiene correo de recuperación registrado" }) };
        }

        const code   = Math.floor(100000 + Math.random() * 900000).toString();
        const expira = (Date.now() + 10 * 60 * 1000).toString();

        await dynamo.send(new PutItemCommand({
            TableName: "biosecurity-reset-codes",
            Item: {
                email:  { S: email },
                codigo: { S: code },
                expira: { N: expira }
            }
        }));

        await enviarCorreo(correoDestino,
            "🔐 Código de restablecimiento - Biosecurity UCompensar",
            `
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
                <div style="background:#4B2D8F;padding:20px;border-radius:12px 12px 0 0;text-align:center">
                    <h2 style="color:white;margin:0">🔐 Biosecurity UCompensar</h2>
                </div>
                <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee">
                    <p style="color:#333">Hola, recibiste este correo porque solicitaste restablecer tu contraseña.</p>
                    <p style="color:#333">Tu código de verificación es:</p>
                    <div style="text-align:center;margin:24px 0">
                        <span style="font-size:36px;font-weight:900;letter-spacing:8px;color:#4B2D8F;background:#EDE9FF;padding:16px 24px;border-radius:12px">${code}</span>
                    </div>
                    <p style="color:#888;font-size:13px">⏰ Este código expira en <strong>10 minutos</strong>.</p>
                    <p style="color:#888;font-size:13px">Si no solicitaste este cambio, ignora este correo.</p>
                    <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
                    <p style="color:#bbb;font-size:11px;text-align:center">Sistema Biosecurity · UCompensar · us-east-1</p>
                </div>
            </div>`
        );

        return { statusCode: 200, headers: CORS, body: JSON.stringify({ codigo: 0, descripcion: "Código enviado al correo registrado" }) };
    }

    // ── VERIFICAR CÓDIGO ──
    if (accion === "verificar") {
        const { email, codigo } = body;
        if (!email || !codigo) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Faltan datos" }) };
        }

        const item = await dynamo.send(new GetItemCommand({
            TableName: "biosecurity-reset-codes",
            Key: { email: { S: email } }
        }));

        if (!item.Item) {
            return { statusCode: 404, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "No hay código activo para este usuario" }) };
        }
        if (Date.now() > parseInt(item.Item.expira.N)) {
            await dynamo.send(new DeleteItemCommand({ TableName: "biosecurity-reset-codes", Key: { email: { S: email } } }));
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "El código expiró. Solicita uno nuevo" }) };
        }
        if (item.Item.codigo.S !== codigo) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Código incorrecto" }) };
        }

        return { statusCode: 200, headers: CORS, body: JSON.stringify({ codigo: 0, descripcion: "Código verificado correctamente" }) };
    }

    // ── CAMBIAR CONTRASEÑA ──
    if (accion === "cambiar") {
        const { email, codigo, nueva_clave } = body;
        if (!email || !codigo || !nueva_clave) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Faltan datos" }) };
        }
        if (nueva_clave.length < 6) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "La contraseña debe tener al menos 6 caracteres" }) };
        }

        const item = await dynamo.send(new GetItemCommand({
            TableName: "biosecurity-reset-codes",
            Key: { email: { S: email } }
        }));

        if (!item.Item || item.Item.codigo.S !== codigo || Date.now() > parseInt(item.Item.expira.N)) {
            return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Código inválido o expirado" }) };
        }

        // Obtener datos actuales del usuario para preservar correo_reset
        const usuarioActual = await obtenerUsuario(email);
        const correoReset = usuarioActual?.correo_reset || "";

        await dynamo.send(new PutItemCommand({
            TableName: "biosecurity-usuarios",
            Item: {
                email:        { S: email },
                password:     { S: nueva_clave },
                correo_reset: { S: correoReset },
                updated_at:   { S: new Date().toISOString() }
            }
        }));

        await dynamo.send(new DeleteItemCommand({
            TableName: "biosecurity-reset-codes",
            Key: { email: { S: email } }
        }));

        return { statusCode: 200, headers: CORS, body: JSON.stringify({ codigo: 0, descripcion: "Contraseña actualizada exitosamente" }) };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ codigo: 1, descripcion: "Acción no reconocida" }) };
};
