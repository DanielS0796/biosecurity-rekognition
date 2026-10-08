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

(async () => {

console.log('\n── 1. Contraseñas guardadas hasheadas, nunca en claro ──');
reset();
let r = await pedir({ accion: 'crear_usuario', usuario: 'ana', correo: 'ana@x.test', rol: 'rrhh' });
check('crea el usuario', r.body.codigo === 0, JSON.stringify(r.body));
const guardada = dyn.__estado.usuarios['ana'].password.S;
check('lo guardado es un hash scrypt', guardada.startsWith('scrypt$'), guardada.slice(0, 20));
const temporal = r.body.clave_temporal;
check('devuelve la temporal una sola vez', typeof temporal === 'string' && temporal.length >= 12);
check('la temporal no está en el registro', !JSON.stringify(dyn.__estado.usuarios['ana']).includes(temporal));

console.log('\n── 2. El correo de bienvenida ya no lleva la contraseña ──');
check('se envió el correo', mail.__enviados.length === 1);
check('no contiene la temporal', !mail.__enviados[0].html.includes(temporal));
check('explica que la entrega el administrador', /no se envía por correo/i.test(mail.__enviados[0].html));

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

console.log(`\n${'─'.repeat(52)}\n${pasaron} pasaron · ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
})();
