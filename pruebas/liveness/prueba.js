const SECRETO = 'secreto-de-prueba-con-mas-de-32-caracteres';
process.env.SESION_SECRETO = SECRETO;
require('./preparar.js');
const rek = require('@aws-sdk/client-rekognition');
const dyn = require('@aws-sdk/client-dynamodb');
const mail = require('nodemailer');
process.env.BUCKET_AUDITORIA = '';
const { handler } = require('./liveness.actual.js');
const firmaSesion = require('./sesion.js');

// Registrar exige sesión de RR. HH.; el rol se lee de la tabla de usuarios.
dyn.__estado.tablas['biosecurity-usuarios'] = {
  jefa: { email: { S: 'jefa' }, rol: { S: 'rrhh' } },
  auditor: { email: { S: 'auditor' }, rol: { S: 'auditoria' } },
};
const TOKEN_RRHH = firmaSesion.emitir('jefa').token;

// post() firma como RR. HH. solo los inicios de registro, que es lo que hace
// el módulo de RR. HH. La validación de la portería va sin sesión, como en
// la realidad. Con un tercer argumento se manda el token que se indique
// (null: ninguno).
const ev = (ruta, cuerpo, token) => ({
  path: ruta, httpMethod: 'POST', body: JSON.stringify(cuerpo),
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const post = async (ruta, cuerpo, ...token) => {
  const t = token.length ? token[0] : (cuerpo?.proposito === 'registro' && ruta.endsWith('/liveness-init') ? TOKEN_RRHH : null);
  const r = await handler(ev(ruta, cuerpo, t));
  return { status: r.statusCode, body: JSON.parse(r.body || '{}') };
};

let pasaron = 0, fallaron = 0;
function check(nombre, cond, detalle='') {
  if (cond) { console.log(`  ✓ ${nombre}`); pasaron++; }
  else { console.log(`  ✗ ${nombre} ${detalle}`); fallaron++; }
}
const reset = () => { rek.__estado.respuestas = {}; rek.__estado.llamadas = []; dyn.__estado.llamadas = []; mail.__enviados.length = 0; };

// Lo que el navegador manda al registrar, ya con el consentimiento dado.
// El Lambda comprueba la versión contra la suya: si no coinciden, la
// persona aceptó un texto que ya no rige.
const AUTORIZA = {
  correo: 'persona@correo.test',
  autorizacion: { autorizado: true, politica_version: '2026-10-v1', canal: 'app-web' },
};

(async () => {
console.log('\n── 1. Una foto no puede pasar: Rekognition reporta FAILED ──');
reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-foto' };
await post('/liveness-init', { proposito: 'validacion' });
rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = { Status: 'FAILED', Confidence: 0 };
let r = await post('/liveness-result', { session_id: 's-foto' });
check('rechaza con 401', r.status === 401, `-> ${r.status}`);
check('no busca el rostro en la colección',
  !rek.__estado.llamadas.some(l => l.tipo === 'SearchFacesByImageCommand'));

console.log('\n── 2. Liveness con confianza baja ──');
reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-baja' };
await post('/liveness-init', { proposito: 'validacion' });
rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = {
  Status: 'SUCCEEDED', Confidence: 60, ReferenceImage: { Bytes: Buffer.from('x') } };
r = await post('/liveness-result', { session_id: 's-baja' });
check('rechaza bajo el umbral de 85', r.status === 401, `-> ${r.status}`);
check('informa la confianza', r.body.confianza_liveness === 60, JSON.stringify(r.body));
check('no indexa ni busca',
  !rek.__estado.llamadas.some(l => ['SearchFacesByImageCommand','IndexFacesCommand'].includes(l.tipo)));

console.log('\n── 3. El endpoint ignora cualquier imagen que mande el cliente ──');
reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-img' };
await post('/liveness-init', { proposito: 'validacion' });
const imagenDeAWS = Buffer.from('IMAGEN-REAL-DE-REKOGNITION');
rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = {
  Status: 'SUCCEEDED', Confidence: 97, ReferenceImage: { Bytes: imagenDeAWS } };
rek.__estado.respuestas.SearchFacesByImageCommand = {
  FaceMatches: [{ Similarity: 99.1, Face: { ExternalImageId: '123', FaceId: 'f1' } }] };
dyn.__estado.tablas['biosecurity-empleados'] = {
  '123': { identificacion: { S: '123' }, nombre: { S: 'Ana Gómez' } } };
r = await post('/liveness-result', {
  session_id: 's-img',
  imgvalidacion: 'data:image/jpeg;base64,Rk9UTy1TVVBMQU5UQURB',
  foto: 'otra-foto-maliciosa' });
const usada = rek.__estado.llamadas.find(l => l.tipo === 'SearchFacesByImageCommand');
check('acepta el acceso', r.status === 200, `-> ${r.status} ${JSON.stringify(r.body)}`);
check('busca con la imagen de AWS, no la del cliente',
  usada && Buffer.compare(Buffer.from(usada.input.Image.Bytes), imagenDeAWS) === 0);
check('identifica a la persona', r.body.nombre === 'Ana Gómez', JSON.stringify(r.body));
check('registra ENTRADA', r.body.tipo_acceso === 'ENTRADA');

console.log('\n── 4. Anti-replay: una sesión no se puede reutilizar ──');
r = await post('/liveness-result', { session_id: 's-img' });
check('la segunda vez devuelve 409', r.status === 409, `-> ${r.status}`);

console.log('\n── 5. Sesión inexistente ──');
reset();
r = await post('/liveness-result', { session_id: 'no-existe' });
check('rechaza con 401', r.status === 401, `-> ${r.status}`);

console.log('\n── 6. Registro: indexa la imagen de AWS ──');
reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-reg' };
r = await post('/liveness-init', { proposito: 'registro', identificacion: '999', nombre: 'Luis Díaz' , ...AUTORIZA });
check('crea la sesión', r.body.session_id === 's-reg', JSON.stringify(r.body));
const imgReg = Buffer.from('REFERENCIA-REGISTRO');
rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = {
  Status: 'SUCCEEDED', Confidence: 96, ReferenceImage: { Bytes: imgReg } };
rek.__estado.respuestas.SearchFacesByImageCommand = { FaceMatches: [] };
rek.__estado.respuestas.IndexFacesCommand = { FaceRecords: [{ Face: { FaceId: 'face-999' } }] };
r = await post('/liveness-result', { session_id: 's-reg' });
check('registra al empleado', r.status === 200 && r.body.codigo === 0, JSON.stringify(r.body));
const idx = rek.__estado.llamadas.find(l => l.tipo === 'IndexFacesCommand');
check('indexa la imagen de AWS',
  idx && Buffer.compare(Buffer.from(idx.input.Image.Bytes), imgReg) === 0);
check('usa la cédula como ExternalImageId', idx && idx.input.ExternalImageId === '999');
const guardado = dyn.__estado.tablas['biosecurity-empleados']?.['999'];
check('queda en DynamoDB con metodo_registro=liveness',
  guardado && guardado.metodo_registro.S === 'liveness');

console.log('\n── 7. Registro con cédula ya tomada ──');
reset();
r = await post('/liveness-init', { proposito: 'registro', identificacion: '999', nombre: 'Otro' , ...AUTORIZA });
check('falla antes de escanear', r.status === 400, `-> ${r.status}`);
check('no pide sesión a Rekognition',
  !rek.__estado.llamadas.some(l => l.tipo === 'CreateFaceLivenessSessionCommand'));

console.log('\n── 8. Registro sin datos ──');
reset();
r = await post('/liveness-init', { proposito: 'registro' , ...AUTORIZA });
check('exige identificación y nombre', r.status === 400, `-> ${r.status}`);

console.log('\n── 9. Persona viva pero no registrada ──');
reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-desc' };
await post('/liveness-init', { proposito: 'validacion' });
rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = {
  Status: 'SUCCEEDED', Confidence: 98, ReferenceImage: { Bytes: Buffer.from('y') } };
rek.__estado.respuestas.SearchFacesByImageCommand = { FaceMatches: [] };
r = await post('/liveness-result', { session_id: 's-desc' });
check('niega el acceso', r.status === 401, `-> ${r.status}`);
check('confirma que el liveness sí pasó', r.body.liveness_verificado === true);
const reg = Object.values(dyn.__estado.tablas['biosecurity-accesos'] || {});
check('deja el intento en auditoría',
  reg.some(i => i.identificacion.S === 'DESCONOCIDO' && i.resultado.S === 'RECHAZADO'));


console.log('\n── 10. Desafío según el propósito ──');
reset();
let pedido = null;
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = (input) => {
  pedido = input?.Settings?.ChallengePreferences?.[0]?.Type;
  return { SessionId: 's-desafio' };
};
await post('/liveness-init', { proposito: 'validacion' });
check('la entrada pide el desafío sin destellos',
  pedido === 'FaceMovementChallenge', `-> ${pedido}`);

reset();
pedido = null;
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = (input) => {
  pedido = input?.Settings?.ChallengePreferences?.[0]?.Type;
  return { SessionId: 's-desafio2' };
};
await post('/liveness-init', { proposito: 'registro', identificacion: '777', nombre: 'Marta Ruiz' , ...AUTORIZA });
check('el registro pide el desafío con destellos',
  pedido === 'FaceMovementAndLightChallenge', `-> ${pedido}`);

console.log('\n── 11. Reserva si el SDK no acepta ChallengePreferences ──');
reset();
let intentos = [];
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = (input) => {
  intentos.push(input?.Settings?.ChallengePreferences ? 'con-preferencia' : 'sin-preferencia');
  if (intentos.length === 1) {
    const e = new Error('Unknown parameter ChallengePreferences');
    e.name = 'ValidationException';
    throw e;
  }
  return { SessionId: 's-reserva' };
};
r = await post('/liveness-init', { proposito: 'validacion' });
check('reintenta sin el parámetro', intentos.join(',') === 'con-preferencia,sin-preferencia', intentos.join(','));
check('la sesión se crea igual', r.body.session_id === 's-reserva', JSON.stringify(r.body));

console.log('\n── 12. Un error que no es de validación sí se propaga ──');
reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = (() => {
  const e = new Error('Rate exceeded'); e.name = 'ThrottlingException'; return e;
})();
r = await post('/liveness-init', { proposito: 'validacion' });
check('devuelve 500 sin reintentar en bucle', r.status === 500, `-> ${r.status}`);


console.log('\n── 13. Vía alternativa para personas fotosensibles ──');
reset();
let tipo = null;
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = (input) => {
  tipo = input?.Settings?.ChallengePreferences?.[0]?.Type;
  return { SessionId: 's-fotosensible' };
};
r = await post('/liveness-init', {
  proposito: 'registro', identificacion: '555', nombre: 'Sofía Rojas', sin_destellos: true, ...AUTORIZA });
check('el registro omite los destellos cuando se pide',
  tipo === 'FaceMovementChallenge', `-> ${tipo}`);
check('informa el desafío usado', r.body.desafio === 'FaceMovementChallenge', JSON.stringify(r.body));
const ses = dyn.__estado.tablas['biosecurity-liveness-sessions']?.['s-fotosensible'];
check('queda registrado en la sesión', ses?.desafio?.S === 'FaceMovementChallenge');

reset();
tipo = null;
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = (input) => {
  tipo = input?.Settings?.ChallengePreferences?.[0]?.Type;
  return { SessionId: 's-normal' };
};
await post('/liveness-init', { proposito: 'registro', identificacion: '556', nombre: 'Iván Peña' , ...AUTORIZA });
check('sin la bandera, el registro mantiene los destellos',
  tipo === 'FaceMovementAndLightChallenge', `-> ${tipo}`);

console.log('\n── Ley 1581: la autorización no se puede saltar ──');
reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-ley' };

r = await post('/liveness-init', { proposito: 'registro', identificacion: '800', nombre: 'Ana Gil', correo: 'a@x.test' });
check('sin autorización no abre sesión', r.status === 400, JSON.stringify(r.body));
check('no llama a Rekognition',
  !rek.__estado.llamadas.some(l => l.tipo === 'CreateFaceLivenessSessionCommand'));

r = await post('/liveness-init', {
  proposito: 'registro', identificacion: '800', nombre: 'Ana Gil', correo: 'a@x.test',
  autorizacion: { autorizado: false, politica_version: '2026-10-v1' } });
check('autorizado:false tampoco pasa', r.status === 400, JSON.stringify(r.body));

r = await post('/liveness-init', {
  proposito: 'registro', identificacion: '800', nombre: 'Ana Gil', correo: 'a@x.test',
  autorizacion: { autorizado: true, politica_version: '2019-vieja' } });
check('una versión vieja de la política se rechaza', r.status === 409, JSON.stringify(r.body));

r = await post('/liveness-init', {
  proposito: 'registro', identificacion: '800', nombre: 'Ana Gil',
  autorizacion: { autorizado: true, politica_version: '2026-10-v1' } });
check('sin correo no hay dónde mandar la constancia', r.status === 400, JSON.stringify(r.body));

// La validación diaria no pide autorización: se dio una vez al registrarse.
r = await post('/liveness-init', { proposito: 'validacion' });
check('validar no exige autorización', r.body.codigo === 0, JSON.stringify(r.body));

console.log('\n── Ley 1581: la constancia queda guardada y se envía ──');
reset();
process.env.SMTP_USUARIO = 'buzon@prueba.test';
process.env.SMTP_CLAVE = 'clave-doble';
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-const' };
r = await post('/liveness-init', { proposito: 'registro', identificacion: '801', nombre: 'Ana Gil', ...AUTORIZA });
check('con autorización sí abre sesión', r.body.codigo === 0, JSON.stringify(r.body));

const sesion = dyn.__estado.tablas['biosecurity-liveness-sessions']?.['s-const'];
check('la sesión guarda que autorizó', sesion?.autorizacion_datos?.BOOL === true);
check('guarda la versión de la política', sesion?.politica_version?.S === '2026-10-v1',
  sesion?.politica_version?.S);
check('guarda el canal', sesion?.autorizacion_canal?.S === 'app-web');
check('la fecha la pone el servidor, no el navegador',
  !!sesion?.autorizacion_fecha?.S && !isNaN(Date.parse(sesion.autorizacion_fecha.S)));

rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = {
  Status: 'SUCCEEDED', Confidence: 95, ReferenceImage: { Bytes: Buffer.from('cara') } };
rek.__estado.respuestas.IndexFacesCommand = { FaceRecords: [{ Face: { FaceId: 'f-801' } }] };
r = await post('/liveness-result', { session_id: 's-const' });
check('el registro se completa', r.body.codigo === 0, JSON.stringify(r.body));

const empleado = dyn.__estado.tablas['biosecurity-empleados']?.['801'];
check('el empleado hereda la constancia', empleado?.autorizacion_datos?.BOOL === true,
  JSON.stringify(empleado));
check('con la misma versión', empleado?.politica_version?.S === '2026-10-v1');
check('y el correo', empleado?.correo?.S === 'persona@correo.test');

check('se envió la constancia', mail.__enviados.length === 1, String(mail.__enviados.length));
const texto = mail.__enviados[0]?.text || '';
check('dice a dónde revocar', /biosecurityucompensar@gmail\.com/.test(texto));
check('explica que no se guarda la foto', /no la\s+fotograf/i.test(texto), texto.slice(0, 200));
check('menciona la ley', /Ley 1581/.test(texto));

console.log('\n── Vínculo con la institución ──');
reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-tipo' };
await post('/liveness-init', {
  proposito: 'registro', identificacion: '900', nombre: 'Luz Mena',
  tipo_persona: 'docente', ...AUTORIZA });
check('la sesión guarda el tipo',
  dyn.__estado.tablas['biosecurity-liveness-sessions']?.['s-tipo']?.tipo_persona?.S === 'docente');

rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = {
  Status: 'SUCCEEDED', Confidence: 95, ReferenceImage: { Bytes: Buffer.from('cara') } };
rek.__estado.respuestas.IndexFacesCommand = { FaceRecords: [{ Face: { FaceId: 'f-900' } }] };
await post('/liveness-result', { session_id: 's-tipo' });
check('y la persona queda con él',
  dyn.__estado.tablas['biosecurity-empleados']?.['900']?.tipo_persona?.S === 'docente',
  JSON.stringify(dyn.__estado.tablas['biosecurity-empleados']?.['900']?.tipo_persona));

reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-raro' };
await post('/liveness-init', {
  proposito: 'registro', identificacion: '901', nombre: 'Otro',
  tipo_persona: 'rector-supremo', ...AUTORIZA });
check('un tipo inventado cae en estudiante',
  dyn.__estado.tablas['biosecurity-liveness-sessions']?.['s-raro']?.tipo_persona?.S === 'estudiante');

reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-vacio' };
await post('/liveness-init', {
  proposito: 'registro', identificacion: '902', nombre: 'Otra', ...AUTORIZA });
check('sin tipo también cae en estudiante',
  dyn.__estado.tablas['biosecurity-liveness-sessions']?.['s-vacio']?.tipo_persona?.S === 'estudiante');

console.log('\n── Entrada y salida se alternan ──');
// Esta lógica nunca se había probado: el doble de DynamoDB contestaba
// { Items: [] } a toda consulta, así que el Lambda siempre creía que no
// había entradas abiertas y toda prueba daba ENTRADA.

// Un escaneo completo de una persona ya registrada, en el momento que se
// le indique. El reloj se finge porque la decisión entrada/salida depende
// de la fecha, y de noche en Bogotá esa fecha no es la que uno cree.
async function escanear(sesion, momentoISO) {
  const Real = Date;
  if (momentoISO) {
    global.Date = class extends Real {
      constructor(...a) { return a.length ? new Real(...a) : new Real(momentoISO); }
      static now() { return new Real(momentoISO).getTime(); }
    };
  }
  try {
    rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: sesion };
    await post('/liveness-init', { proposito: 'validacion' });
    rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = {
      Status: 'SUCCEEDED', Confidence: 97, ReferenceImage: { Bytes: Buffer.from('img') } };
    rek.__estado.respuestas.SearchFacesByImageCommand = {
      FaceMatches: [{ Similarity: 99.1, Face: { ExternalImageId: '123', FaceId: 'f1' } }] };
    return await post('/liveness-result', { session_id: sesion });
  } finally {
    global.Date = Real;
  }
}

const limpiarAccesos = () => { dyn.__estado.tablas['biosecurity-accesos'] = {}; };
const conPersona = () => {
  dyn.__estado.tablas['biosecurity-empleados'] = {
    '123': { identificacion: { S: '123' }, nombre: { S: 'Ana Gómez' } } };
};

reset(); limpiarAccesos(); conPersona();
// 13:00, 14:00 y 15:00 UTC son 08:00, 09:00 y 10:00 en Bogotá.
let e1 = await escanear('s-e1', '2026-10-06T13:00:00Z');
let e2 = await escanear('s-e2', '2026-10-06T14:00:00Z');
let e3 = await escanear('s-e3', '2026-10-06T15:00:00Z');
check('el primero es entrada', e1.body.tipo_acceso === 'ENTRADA', e1.body.tipo_acceso);
check('el segundo es salida', e2.body.tipo_acceso === 'SALIDA', e2.body.tipo_acceso);
check('el tercero vuelve a ser entrada', e3.body.tipo_acceso === 'ENTRADA', e3.body.tipo_acceso);

console.log('\n── Una visita de noche no se parte en dos entradas ──');
// En Bogotá el día UTC cambia a las 7 de la noche. Quien entra a las 6
// y sale a las 8 cruza esa frontera sin salir del mismo día real. La
// consulta filtraba por día UTC, así que la salida no encontraba su
// entrada y quedaba registrada como una segunda entrada.
reset(); limpiarAccesos(); conPersona();
const entrada = await escanear('s-n1', '2026-10-06T23:00:00Z');  // 18:00 Bogotá
const salida  = await escanear('s-n2', '2026-10-07T01:00:00Z');  // 20:00 Bogotá
check('entra', entrada.body.tipo_acceso === 'ENTRADA', entrada.body.tipo_acceso);
check('y sale, no entra otra vez', salida.body.tipo_acceso === 'SALIDA', salida.body.tipo_acceso);

console.log('\n── Una entrada olvidada ayer no se cierra hoy ──');
// Quien no marcó su salida deja una entrada abierta. El escaneo del día
// siguiente es una entrada nueva, no la salida de aquella.
reset(); limpiarAccesos(); conPersona();
await escanear('s-v1', '2026-10-06T13:00:00Z');
const hoy = await escanear('s-v2', '2026-10-08T13:00:00Z');
check('dos días después vuelve a ser entrada', hoy.body.tipo_acceso === 'ENTRADA', hoy.body.tipo_acceso);

console.log('\n── Sesión: registrar una cara exige RR. HH. (R09/R20) ──');
// Antes, cualquiera que conociera la URL podía abrir un registro y dar de
// alta su propia cara con la identidad que quisiera.
reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-sesion-1' };
const pedidoRegistro = { proposito: 'registro', identificacion: '777', nombre: 'Intruso', ...AUTORIZA };
let rs = await post('/liveness-init', pedidoRegistro, null);
check('registro sin token -> 401', rs.status === 401, `-> ${rs.status}`);
check('no abre sesión en Rekognition', !rek.__estado.llamadas.some(l => l.tipo === 'CreateFaceLivenessSessionCommand'));
check('ni la guarda', !dyn.__estado.tablas['biosecurity-liveness-sessions']?.['s-sesion-1']);

rs = await post('/liveness-init', pedidoRegistro, firmaSesion.emitir('auditor').token);
check('registro con sesión de auditoría -> 403', rs.status === 403, `-> ${rs.status}`);

rs = await post('/liveness-init', pedidoRegistro, firmaSesion.emitir('jefa', Date.now() - 9 * 3600 * 1000).token);
check('registro con token vencido -> 401', rs.status === 401, `-> ${rs.status}`);

const [hh, pp] = TOKEN_RRHH.split('.');
rs = await post('/liveness-init', pedidoRegistro, `${hh}.${pp}.alterada`);
check('registro con firma alterada -> 401', rs.status === 401, `-> ${rs.status}`);

rs = await post('/liveness-init', pedidoRegistro, TOKEN_RRHH);
check('con sesión de RR. HH. abre el registro', rs.status === 200 && rs.body.session_id === 's-sesion-1', `-> ${rs.status}`);
check('la sesión guarda quién lo pidió',
  dyn.__estado.tablas['biosecurity-liveness-sessions']?.['s-sesion-1']?.registrado_por?.S === 'jefa');

reset();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-porteria' };
rs = await post('/liveness-init', { proposito: 'validacion' }, null);
check('la validación de la portería sigue sin sesión', rs.status === 200 && rs.body.session_id === 's-porteria', `-> ${rs.status}`);
// Si alguien manda "registro" mal escrito, cae en validación, que no da de
// alta a nadie.
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-raro' };
rs = await post('/liveness-init', { proposito: 'REGISTRO', identificacion: '777', nombre: 'X' }, null);
check('un propósito raro no se vuelve registro',
  rs.body.proposito === 'validacion', JSON.stringify(rs.body));

console.log('\n── Intentos rechazados quedan para auditoría (punto 6) ──');
// Antes solo quedaba constancia de "persona no registrada". Una foto o un
// video frente a la cámara (prueba de vida fallida) no dejaba nada, y era
// justamente el intento que más interesa ver.
const ultimoRechazo = () => Object.values(dyn.__estado.tablas['biosecurity-accesos'] || {})
  .filter(i => i.resultado?.S === 'RECHAZADO')
  .sort((a, b) => a.fecha_hora.S.localeCompare(b.fecha_hora.S)).pop();
async function rechazo(sesionId, resultado, busqueda, proposito = 'validacion') {
  limpiarAccesos();
  rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: sesionId };
  const pedido = proposito === 'registro'
    ? { proposito, identificacion: `r-${sesionId}`, nombre: 'Prueba', ...AUTORIZA }
    : { proposito };
  await post('/liveness-init', pedido);
  rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = resultado;
  rek.__estado.respuestas.SearchFacesByImageCommand = busqueda;
  const r = await post('/liveness-result', { session_id: sesionId });
  return { r, item: ultimoRechazo() };
}

reset();
let rz = await rechazo('s-rz1', { Status: 'FAILED', Confidence: 0 });
check('prueba de vida fallida -> queda con motivo prueba_fallida', rz.item?.motivo?.S === 'prueba_fallida', JSON.stringify(rz.item));
check('sin foto ni nombre', rz.item && !rz.item.imagen && rz.item.nombre.S === 'DESCONOCIDO' && rz.item.identificacion.S === 'DESCONOCIDO');
const ahoraSeg = Math.floor(Date.now() / 1000);
const expira = Number(rz.item?.expira?.N);
check('se borra solo en unos 90 días', expira > ahoraSeg + 89 * 86400 && expira <= ahoraSeg + 91 * 86400, `-> ${expira}`);
check('tipo_acceso INTENTO, no ENTRADA', rz.item?.tipo_acceso?.S === 'INTENTO');
check('la respuesta sigue siendo 401', rz.r.status === 401, `-> ${rz.r.status}`);

reset();
rz = await rechazo('s-rz2', { Status: 'EXPIRED', Confidence: 0 });
check('sesión vencida -> escaneo_incompleto, con el estado', rz.item?.motivo?.S === 'escaneo_incompleto' && rz.item?.detalle?.S === 'EXPIRED', JSON.stringify(rz.item));

reset();
rz = await rechazo('s-rz3', { Status: 'SUCCEEDED', Confidence: 42.5, ReferenceImage: { Bytes: Buffer.from('z') } });
check('confianza baja -> confianza_baja con la confianza', rz.item?.motivo?.S === 'confianza_baja' && rz.item?.liveness_confianza?.N === '42.50', JSON.stringify(rz.item));

reset();
rz = await rechazo('s-rz4', { Status: 'FAILED', Confidence: 0 }, undefined, 'registro');
check('en el registro también queda, marcado como registro', rz.item?.motivo?.S === 'prueba_fallida' && rz.item?.proposito?.S === 'registro', JSON.stringify(rz.item));

reset();
rz = await rechazo('s-rz5', { Status: 'SUCCEEDED', Confidence: 98, ReferenceImage: { Bytes: Buffer.from('y') } }, { FaceMatches: [] });
check('no registrado -> no_registrado', rz.item?.motivo?.S === 'no_registrado', JSON.stringify(rz.item));

reset();
dyn.__estado.tablas['biosecurity-empleados'] = {};
rz = await rechazo('s-rz6', { Status: 'SUCCEEDED', Confidence: 98, ReferenceImage: { Bytes: Buffer.from('y') } },
  { FaceMatches: [{ Similarity: 99.3, Face: { ExternalImageId: '4040', FaceId: 'f-ret' } }] });
check('retirado -> inactivo, con su identificación', rz.item?.motivo?.S === 'inactivo' && rz.item?.identificacion?.S === '4040', JSON.stringify(rz.item));

reset();
rz = await rechazo('s-rz7', { Status: 'SUCCEEDED', Confidence: 98, ReferenceImage: { Bytes: Buffer.from('y') } },
  Object.assign(new Error('There are no faces in the image'), { name: 'InvalidParameterException' }));
check('sin rostro -> sin_rostro', rz.item?.motivo?.S === 'sin_rostro', JSON.stringify(rz.item));

// Un rechazo de alguien que luego vuelve a estar activo no puede tomarse
// como su entrada abierta: el siguiente escaneo tiene que ser ENTRADA.
reset(); limpiarAccesos();
dyn.__estado.tablas['biosecurity-empleados'] = {};
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-rz8' };
await post('/liveness-init', { proposito: 'validacion' });
rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = { Status: 'SUCCEEDED', Confidence: 98, ReferenceImage: { Bytes: Buffer.from('y') } };
rek.__estado.respuestas.SearchFacesByImageCommand = { FaceMatches: [{ Similarity: 99.1, Face: { ExternalImageId: '123', FaceId: 'f1' } }] };
await post('/liveness-result', { session_id: 's-rz8' });
const rechazoGuardado = ultimoRechazo();
conPersona();
const tras = await escanear('s-rz9');
check('tras un rechazo, el escaneo siguiente es ENTRADA', tras.body.tipo_acceso === 'ENTRADA', tras.body.tipo_acceso);
check('y el rechazo no se modificó', rechazoGuardado && !rechazoGuardado.hora_salida);

// Si DynamoDB falla al guardar el rechazo, la persona igual recibe su 401.
reset(); limpiarAccesos();
rek.__estado.respuestas.CreateFaceLivenessSessionCommand = { SessionId: 's-rz10' };
await post('/liveness-init', { proposito: 'validacion' });
rek.__estado.respuestas.GetFaceLivenessSessionResultsCommand = { Status: 'FAILED', Confidence: 0 };
const sendOriginal = dyn.DynamoDBClient.prototype.send;
dyn.DynamoDBClient.prototype.send = async function (cmd) {
  if (cmd.tipo === 'PutItemCommand' && cmd.input.TableName === 'biosecurity-accesos') throw new Error('caída simulada');
  return sendOriginal.call(this, cmd);
};
const rCaida = await post('/liveness-result', { session_id: 's-rz10' });
dyn.DynamoDBClient.prototype.send = sendOriginal;
check('si no se puede guardar el rechazo, igual responde 401', rCaida.status === 401, `-> ${rCaida.status}`);

console.log(`\n${'─'.repeat(50)}\n${pasaron} pasaron · ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
})();
