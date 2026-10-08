// Variables de entorno antes de cargar el Lambda: las lee al importarse.
process.env.SMTP_USUARIO = 'buzon@prueba.test';
process.env.SMTP_CLAVE = 'clave-doble';
process.env.ADMIN_EMERGENCIA_USUARIO = 'rescate';
process.env.ADMIN_EMERGENCIA_CORREO = 'rescate@prueba.test';

require('./preparar.js');
const crypto = require('crypto');

// Hash de la clave de emergencia, igual que lo haría el Lambda
const S = { N: 16384, r: 8, p: 1, keylen: 64 };
function hashear(c) {
  const s = crypto.randomBytes(16);
  const d = crypto.scryptSync(c, s, S.keylen, { N: S.N, r: S.r, p: S.p });
  return `scrypt$${S.N}$${S.r}$${S.p}$${s.toString('hex')}$${d.toString('hex')}`;
}
process.env.ADMIN_EMERGENCIA_HASH = hashear('Rescate2026!Ok');

const dyn = require('@aws-sdk/client-dynamodb');
const mail = require('nodemailer');
const { handler } = require('./reset.actual.js');

let pasaron = 0, fallaron = 0;
const check = (n, c, d = '') => {
  if (c) { console.log(`  ✓ ${n}`); pasaron++; }
  else { console.log(`  ✗ ${n} ${d}`); fallaron++; }
};
const pedir = async (body) => {
  const r = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body || '{}') };
};
const reset = () => {
  dyn.__estado.usuarios = {}; dyn.__estado.codigos = {}; dyn.__estado.llamadas = [];
  mail.__enviados.length = 0;
};
const CLAVE_OK = 'Ucomp2026!Seg';

/**
 * Saca la contraseña temporal del correo. El Lambda ya no la devuelve en
 * la respuesta, así que el correo es el único lugar de donde se puede
 * leer — igual que para la persona que la recibe.
 *
 * Se lee de la parte en texto plano a propósito: el HTML lleva la
 * contraseña escapada, y leer de ahí haría que una contraseña con "&"
 * pasara la prueba sin pasar en la realidad.
 */
function extraerTemporal(correo) {
  const texto = typeof correo === 'string' ? correo : correo.text;
  const m = texto.match(/Contraseña temporal: (.+)/);
  return m ? m[1].trim() : null;
}

(async () => {

console.log('\n── 1. Contraseñas guardadas hasheadas, nunca en claro ──');
reset();
let r = await pedir({ accion: 'crear_usuario', usuario: 'ana', correo: 'ana@x.test', rol: 'rrhh' });
check('crea el usuario', r.body.codigo === 0, JSON.stringify(r.body));
const guardada = dyn.__estado.usuarios['ana'].password.S;
check('lo guardado es un hash scrypt', guardada.startsWith('scrypt$'), guardada.slice(0, 20));
check('la respuesta no trae la contraseña', !JSON.stringify(r.body).match(/clave_temporal/));
check('confirma el correo enmascarado', r.body.correo_enmascarado === 'an*@x.test',
  r.body.correo_enmascarado);

console.log('\n── 2. La temporal viaja por correo y solo por ahí ──');
check('se envió un correo', mail.__enviados.length === 1);
check('fue al correo del usuario', mail.__enviados[0].to === 'ana@x.test');
// La temporal se recupera del correo, que es el único lugar donde está.
const temporal = extraerTemporal(mail.__enviados[0]);
check('el correo lleva una temporal', typeof temporal === 'string' && temporal.length >= 12,
  String(temporal));
check('no quedó en claro en el registro',
  !JSON.stringify(dyn.__estado.usuarios['ana']).includes(temporal));
check('el correo avisa que vence', /vence en \d+ horas/i.test(mail.__enviados[0].html));

console.log('\n── 3. Primer ingreso obliga a cambiar la contraseña ──');
r = await pedir({ accion: 'login', email: 'ana', clave: temporal });
check('entra con la temporal', r.body.codigo === 0, JSON.stringify(r.body));
check('marca que debe cambiarla', r.body.debe_cambiar_clave === true);
check('devuelve solo el rol que tiene', JSON.stringify(r.body.rol) === '["rrhh"]', JSON.stringify(r.body.rol));

console.log('\n── 4. El rol no se pierde al cambiar la contraseña ──');
r = await pedir({ accion: 'cambiar_clave', email: 'ana', clave_actual: temporal, nueva_clave: CLAVE_OK });
check('cambia la contraseña', r.body.codigo === 0, JSON.stringify(r.body));
check('el rol sigue en el registro', dyn.__estado.usuarios['ana'].rol?.S === 'rrhh',
  JSON.stringify(dyn.__estado.usuarios['ana'].rol));
check('la fecha de creación sobrevive', !!dyn.__estado.usuarios['ana'].created_at);
r = await pedir({ accion: 'login', email: 'ana', clave: CLAVE_OK });
check('ya no pide cambio', r.body.debe_cambiar_clave === false);

console.log('\n── 5. Política de contraseñas, validada en el servidor ──');
for (const [clave, motivo] of [
  ['corta1!A', 'longitud'], ['todominuscula1!', 'mayúscula'],
  ['TODOMAYUSCULA1!', 'minúscula'], ['SinNumeros!!!', 'número'],
  ['SinSimbolos123', 'símbolo'],
]) {
  const x = await pedir({ accion: 'cambiar_clave', email: 'ana', clave_actual: CLAVE_OK, nueva_clave: clave });
  check(`rechaza por ${motivo}`, x.body.codigo === 1, `"${clave}" -> ${x.body.descripcion}`);
}
r = await pedir({ accion: 'cambiar_clave', email: 'ana', clave_actual: CLAVE_OK, nueva_clave: 'LaClaveDeAna9!' });
check('rechaza si contiene el usuario', r.body.codigo === 1, r.body.descripcion);
r = await pedir({ accion: 'cambiar_clave', email: 'ana', clave_actual: CLAVE_OK, nueva_clave: CLAVE_OK });
check('rechaza repetir la actual', r.body.codigo === 1, r.body.descripcion);

console.log('\n── 6. Migración de contraseñas que estaban en texto plano ──');
reset();
dyn.__estado.usuarios['viejo'] = {
  email: { S: 'viejo' }, password: { S: 'clave123' },
  correo_reset: { S: 'v@x.test' }, rol: { S: 'auditoria' },
  created_at: { S: '2026-01-01' },
};
r = await pedir({ accion: 'login', email: 'viejo', clave: 'clave123' });
check('el usuario antiguo puede entrar', r.body.codigo === 0, JSON.stringify(r.body));
check('su contraseña quedó hasheada', dyn.__estado.usuarios['viejo'].password.S.startsWith('scrypt$'));
check('conserva su rol real', JSON.stringify(r.body.rol) === '["auditoria"]', JSON.stringify(r.body.rol));
r = await pedir({ accion: 'login', email: 'viejo', clave: 'clave123' });
check('sigue entrando tras migrar', r.body.codigo === 0);
r = await pedir({ accion: 'login', email: 'viejo', clave: 'otra' });
check('y la incorrecta falla', r.status === 401);

console.log('\n── 7. El login no revela qué usuarios existen ──');
const noExiste = await pedir({ accion: 'login', email: 'fantasma', clave: 'x' });
const malaClave = await pedir({ accion: 'login', email: 'viejo', clave: 'incorrecta' });
check('mismo mensaje en ambos casos', noExiste.body.descripcion === malaClave.body.descripcion,
  `"${noExiste.body.descripcion}" vs "${malaClave.body.descripcion}"`);
check('mismo código de estado', noExiste.status === malaClave.status);

console.log('\n── 8. El código de reset se bloquea por intentos ──');
reset();
dyn.__estado.usuarios['ana'] = {
  email: { S: 'ana' }, password: { S: hashear(CLAVE_OK) },
  correo_reset: { S: 'ana@x.test' }, rol: { S: 'rrhh' },
};
await pedir({ accion: 'solicitar', email: 'ana' });
const codigoReal = dyn.__estado.codigos['ana'].codigo.S;
check('se emitió un código de 6 dígitos', /^\d{6}$/.test(codigoReal));
let ultima;
for (let i = 0; i < 5; i++) ultima = await pedir({ accion: 'verificar', email: 'ana', codigo: '000000' });
check('tras 5 fallos responde 429', ultima.status === 429, `-> ${ultima.status} ${ultima.body.descripcion}`);
check('y el código se destruyó', !dyn.__estado.codigos['ana']);
r = await pedir({ accion: 'verificar', email: 'ana', codigo: codigoReal });
check('el código correcto ya no sirve', r.body.codigo === 1, r.body.descripcion);

console.log('\n── 9. Restablecer con el código correcto ──');
reset();
dyn.__estado.usuarios['ana'] = {
  email: { S: 'ana' }, password: { S: hashear('Vieja2026!Ab') },
  correo_reset: { S: 'ana@x.test' }, rol: { S: 'rrhh,auditoria' },
  created_at: { S: '2026-01-01' },
};
await pedir({ accion: 'solicitar', email: 'ana' });
const cod = dyn.__estado.codigos['ana'].codigo.S;
r = await pedir({ accion: 'cambiar', email: 'ana', codigo: cod, nueva_clave: 'NuevaClave9!x' });
check('cambia la contraseña', r.body.codigo === 0, JSON.stringify(r.body));
check('el código se consumió', !dyn.__estado.codigos['ana']);
check('los dos roles se conservan', dyn.__estado.usuarios['ana'].rol?.S === 'rrhh,auditoria');
r = await pedir({ accion: 'login', email: 'ana', clave: 'NuevaClave9!x' });
check('entra con la nueva', r.body.codigo === 0);
check('con sus dos roles', JSON.stringify(r.body.rol) === '["rrhh","auditoria"]', JSON.stringify(r.body.rol));

console.log('\n── 10. Solicitar código no revela si el usuario existe ──');
reset();
const a = await pedir({ accion: 'solicitar', email: 'nadie' });
check('responde 200 igual', a.status === 200, `-> ${a.status}`);
check('sin enviar correo', mail.__enviados.length === 0);

console.log('\n── 11. Usuario de emergencia por variables de entorno ──');
reset();
r = await pedir({ accion: 'login', email: 'rescate', clave: 'Rescate2026!Ok' });
check('entra con la clave de la variable', r.body.codigo === 0, JSON.stringify(r.body));
check('con ambos roles', JSON.stringify(r.body.rol) === '["rrhh","auditoria"]');
r = await pedir({ accion: 'login', email: 'rescate', clave: 'clave123' });
check('la clave vieja del código ya no sirve', r.status === 401);
r = await pedir({ accion: 'eliminar_usuario', usuario: 'rescate', usuario_actual: 'ana' });
check('no se puede eliminar', r.body.codigo === 1, r.body.descripcion);

console.log('\n── 12. Roles inválidos no se cuelan ──');
reset();
await pedir({ accion: 'crear_usuario', usuario: 'luis', correo: 'l@x.test', rol: 'superadmin,rrhh' });
check('descarta el rol inventado', dyn.__estado.usuarios['luis'].rol.S === 'rrhh',
  dyn.__estado.usuarios['luis'].rol.S);
await pedir({ accion: 'crear_usuario', usuario: 'eva', correo: 'e@x.test', rol: 'basura' });
check('sin roles válidos cae en el mínimo', dyn.__estado.usuarios['eva'].rol.S === 'rrhh');

console.log('\n── 13. Quien crea el usuario nunca ve la contraseña ──');
reset();
r = await pedir({ accion: 'crear_usuario', usuario: 'sol', correo: 'sol@x.test', rol: 'auditoria' });
const temporalSol = extraerTemporal(mail.__enviados[0]);
const respuesta = JSON.stringify(r.body);
check('la temporal no aparece en la respuesta', !respuesta.includes(temporalSol), respuesta);
// Con la temporal en mano se entra, así que la que llegó por correo es la
// que vale: la prueba anterior no pasa por omisión.
r = await pedir({ accion: 'login', email: 'sol', clave: temporalSol });
check('la del correo sí funciona', r.body.codigo === 0, JSON.stringify(r.body));
check('y pide cambiarla', r.body.debe_cambiar_clave === true);

console.log('\n── 14. La temporal vence sola ──');
reset();
await pedir({ accion: 'crear_usuario', usuario: 'ana', correo: 'ana@x.test', rol: 'rrhh' });
const temporalAna = extraerTemporal(mail.__enviados[0]);
check('se guardó la fecha de vencimiento', !!dyn.__estado.usuarios['ana'].clave_temporal_expira);
// Se mueve el vencimiento al pasado en vez de esperar 72 horas.
dyn.__estado.usuarios['ana'].clave_temporal_expira = { S: new Date(Date.now() - 1000).toISOString() };
r = await pedir({ accion: 'login', email: 'ana', clave: temporalAna });
check('vencida no entra', r.status === 403, JSON.stringify(r.body));
check('y lo dice claro', /venció/i.test(r.body.descripcion), r.body.descripcion);
r = await pedir({ accion: 'cambiar_clave', email: 'ana', clave_actual: temporalAna, nueva_clave: CLAVE_OK });
check('vencida tampoco sirve para cambiarla', r.status === 403, JSON.stringify(r.body));

console.log('\n── 15. Elegir la contraseña propia borra el vencimiento ──');
reset();
await pedir({ accion: 'crear_usuario', usuario: 'ana', correo: 'ana@x.test', rol: 'rrhh' });
const temporalViva = extraerTemporal(mail.__enviados[0]);
r = await pedir({ accion: 'cambiar_clave', email: 'ana', clave_actual: temporalViva, nueva_clave: CLAVE_OK });
check('cambia bien', r.body.codigo === 0, JSON.stringify(r.body));
check('devuelve el rol para entrar directo', JSON.stringify(r.body.rol) === '["rrhh"]',
  JSON.stringify(r.body.rol));
check('se borró el vencimiento', !dyn.__estado.usuarios['ana'].clave_temporal_expira,
  JSON.stringify(dyn.__estado.usuarios['ana'].clave_temporal_expira));
r = await pedir({ accion: 'login', email: 'ana', clave: CLAVE_OK });
check('entra con la propia', r.body.codigo === 0 && r.body.debe_cambiar_clave === false);
r = await pedir({ accion: 'login', email: 'ana', clave: temporalViva });
check('la temporal ya no sirve', r.status === 401);

console.log('\n── 16. Una temporal vencida se recupera sin ayuda de nadie ──');
reset();
await pedir({ accion: 'crear_usuario', usuario: 'ana', correo: 'ana@x.test', rol: 'rrhh' });
const vencida = extraerTemporal(mail.__enviados[0]);
dyn.__estado.usuarios['ana'].clave_temporal_expira = { S: new Date(Date.now() - 1000).toISOString() };
r = await pedir({ accion: 'login', email: 'ana', clave: vencida });
check('vencida no entra', r.status === 403);
check('y señala el camino', /olvidaste tu contraseña/i.test(r.body.descripcion), r.body.descripcion);

// El flujo de recuperación por código es el que reemplaza al reenvío.
r = await pedir({ accion: 'solicitar', email: 'ana' });
check('pide el código', r.body.codigo === 0, JSON.stringify(r.body));
const codigo = dyn.__estado.codigos['ana'].codigo.S;
r = await pedir({ accion: 'cambiar', email: 'ana', codigo, nueva_clave: CLAVE_OK });
check('restablece con el código', r.body.codigo === 0, JSON.stringify(r.body));
r = await pedir({ accion: 'login', email: 'ana', clave: CLAVE_OK });
check('entra con la nueva', r.body.codigo === 0, JSON.stringify(r.body));
check('sin cambio pendiente', r.body.debe_cambiar_clave === false);
check('y sin vencimiento colgando', !dyn.__estado.usuarios['ana'].clave_temporal_expira);
r = await pedir({ accion: 'login', email: 'ana', clave: vencida });
check('la vencida quedó muerta', r.status === 401);

// La acción de reenvío se quitó: no debe quedar como superficie de API.
r = await pedir({ accion: 'reenviar_temporal', usuario: 'ana' });
check('reenviar_temporal ya no existe', r.status === 400, JSON.stringify(r.body));

console.log('\n── 17. Si el correo no sale, el usuario no queda inaccesible ──');
reset();
const enviarOriginal = mail.__transporte.sendMail;
mail.__transporte.sendMail = async () => { throw new Error('SMTP caído'); };
r = await pedir({ accion: 'crear_usuario', usuario: 'nadie', correo: 'n@x.test', rol: 'rrhh' });
check('responde que falló', r.status === 502, JSON.stringify(r.body));
check('y no deja el usuario creado', !dyn.__estado.usuarios['nadie'],
  JSON.stringify(dyn.__estado.usuarios['nadie']));
mail.__transporte.sendMail = enviarOriginal;

console.log('\n── 18. Una contraseña con & sobrevive al correo ──');
// El 23% de las temporales llevan "&". Si va cruda en el HTML puede
// leerse como entidad, y el usuario copiaría algo que no es su
// contraseña. Se crean usuarios hasta dar con una y se prueba entera.
let conAmpersand = null, intentos = 0;
while (!conAmpersand && intentos < 60) {
  reset();
  const nombre = `u${intentos}`;
  await pedir({ accion: 'crear_usuario', usuario: nombre, correo: `${nombre}@x.test`, rol: 'rrhh' });
  const t = extraerTemporal(mail.__enviados[0]);
  if (t && t.includes('&')) conAmpersand = { nombre, temporal: t, correo: mail.__enviados[0] };
  intentos++;
}
check('se encontró una con & para probar', !!conAmpersand, `tras ${intentos} intentos`);
if (conAmpersand) {
  check('el HTML la lleva escapada',
    conAmpersand.correo.html.includes(conAmpersand.temporal.replace(/&/g, '&amp;')),
    'el & viaja crudo en el HTML');
  check('el texto plano la lleva tal cual',
    conAmpersand.correo.text.includes(conAmpersand.temporal));
  r = await pedir({ accion: 'login', email: conAmpersand.nombre, clave: conAmpersand.temporal });
  check('y con ella se entra', r.body.codigo === 0, JSON.stringify(r.body));
}

console.log('\n── 19. Cambiar los roles de un usuario que ya existe ──');
reset();
await pedir({ accion: 'crear_usuario', usuario: 'ana', correo: 'ana@x.test', rol: 'rrhh' });
await pedir({ accion: 'crear_usuario', usuario: 'beto', correo: 'b@x.test', rol: 'rrhh' });
r = await pedir({ accion: 'cambiar_roles', usuario: 'beto', rol: 'rrhh,auditoria', usuario_actual: 'ana' });
check('da los dos roles', r.body.codigo === 0, JSON.stringify(r.body));
check('quedan guardados', dyn.__estado.usuarios['beto'].rol.S === 'rrhh,auditoria',
  dyn.__estado.usuarios['beto'].rol.S);
r = await pedir({ accion: 'login', email: 'beto', clave: 'x' });
r = await pedir({ accion: 'cambiar_roles', usuario: 'beto', rol: 'auditoria', usuario_actual: 'ana' });
check('se le puede dejar solo auditoría', JSON.stringify(r.body.rol) === '["auditoria"]',
  JSON.stringify(r.body.rol));
check('no se pierde el correo', dyn.__estado.usuarios['beto'].correo_reset.S === 'b@x.test');
check('ni la contraseña', dyn.__estado.usuarios['beto'].password.S.startsWith('scrypt$'));

console.log('\n── 20. Las guardas de los roles ──');
r = await pedir({ accion: 'cambiar_roles', usuario: 'beto', rol: 'superadmin', usuario_actual: 'ana' });
check('un rol inventado no pasa como vacío', r.status === 400, JSON.stringify(r.body));
check('y no toca lo guardado', dyn.__estado.usuarios['beto'].rol.S === 'auditoria');

r = await pedir({ accion: 'cambiar_roles', usuario: 'ana', rol: 'auditoria', usuario_actual: 'ana' });
check('no te puedes quitar registro a ti mismo', r.status === 400, r.body.descripcion);

// ana es la única con rrhh (beto quedó en auditoria): quitárselo desde
// otra cuenta dejaría el sistema sin nadie que administre usuarios.
r = await pedir({ accion: 'cambiar_roles', usuario: 'ana', rol: 'auditoria', usuario_actual: 'beto' });
check('tampoco al último con registro', r.status === 400, r.body.descripcion);
check('ana conserva su rol', dyn.__estado.usuarios['ana'].rol.S === 'rrhh');

// Con dos que administren, sí se puede.
await pedir({ accion: 'cambiar_roles', usuario: 'beto', rol: 'rrhh,auditoria', usuario_actual: 'ana' });
r = await pedir({ accion: 'cambiar_roles', usuario: 'ana', rol: 'auditoria', usuario_actual: 'beto' });
check('con otro administrador sí se puede', r.body.codigo === 0, JSON.stringify(r.body));

r = await pedir({ accion: 'cambiar_roles', usuario: 'rescate', rol: 'auditoria', usuario_actual: 'beto' });
check('el admin de emergencia no se toca', r.status === 400, r.body.descripcion);
r = await pedir({ accion: 'cambiar_roles', usuario: 'fantasma', rol: 'rrhh', usuario_actual: 'beto' });
check('ni un usuario que no existe', r.status === 404);

console.log('\n── 21. La lista marca al admin de emergencia ──');
r = await pedir({ accion: 'listar_usuarios' });
const rescate = r.body.items.find(i => i.usuario === 'rescate');
const normal = r.body.items.find(i => i.usuario === 'beto');
check('el de emergencia viene marcado', rescate?.es_emergencia === true);
check('los normales no', normal?.es_emergencia === false);

console.log('\n── 22. Un usuario real con el nombre del admin de emergencia ──');
// Pasó en producción: existía 'rescate' en la base además de en la
// variable de entorno. obtenerUsuario mira DynamoDB primero, así que al
// iniciar sesión manda el de la base — y por tanto tiene que poder
// editarse, aunque se llame igual que el de emergencia.
reset();
await pedir({ accion: 'crear_usuario', usuario: 'otro', correo: 'o@x.test', rol: 'rrhh' });

// Hoy crear_usuario rechaza este nombre, porque obtenerUsuario
// encuentra al de la variable y responde "ya existe". El registro de
// Daniel es anterior a que esa variable existiera, así que se siembra
// directo, que es como llegó a estar ahí.
dyn.__estado.usuarios['rescate'] = {
  email: { S: 'rescate' },
  password: { S: 'scrypt$16384$8$1$aa$bb' },
  correo_reset: { S: 'r@x.test' },
  rol: { S: 'rrhh' },
  debe_cambiar_clave: { BOOL: false },
  created_at: { S: '2026-01-01T00:00:00.000Z' },
};

r = await pedir({ accion: 'crear_usuario', usuario: 'rescate', correo: 'r@x.test', rol: 'rrhh' });
check('no se puede crear uno nuevo con ese nombre', r.status === 400, JSON.stringify(r.body));

r = await pedir({ accion: 'listar_usuarios' });
const fila = r.body.items.find(i => i.usuario === 'rescate');
check('la lista lo trae como usuario normal', fila?.es_emergencia === false,
  JSON.stringify(fila));

r = await pedir({ accion: 'cambiar_roles', usuario: 'rescate', rol: 'rrhh,auditoria', usuario_actual: 'otro' });
check('se le pueden cambiar los permisos', r.body.codigo === 0, r.body.descripcion);
check('y quedan guardados', dyn.__estado.usuarios['rescate'].rol.S === 'rrhh,auditoria');

r = await pedir({ accion: 'eliminar_usuario', usuario: 'rescate', usuario_actual: 'otro' });
check('y se puede eliminar', r.body.codigo === 0, r.body.descripcion);

// Sin registro en la base vuelve a mandar la variable de entorno, y
// entonces sí queda protegido.
r = await pedir({ accion: 'cambiar_roles', usuario: 'rescate', rol: 'auditoria', usuario_actual: 'otro' });
check('ya sin registro, vuelve a estar protegido', r.status === 400, r.body.descripcion);
r = await pedir({ accion: 'eliminar_usuario', usuario: 'rescate', usuario_actual: 'otro' });
check('tampoco se elimina el de la variable', r.status === 400, r.body.descripcion);

console.log(`\n${'─'.repeat(52)}\n${pasaron} pasaron · ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
})();
