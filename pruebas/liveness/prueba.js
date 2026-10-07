const rek = require('@aws-sdk/client-rekognition');
const dyn = require('@aws-sdk/client-dynamodb');
process.env.BUCKET_AUDITORIA = '';
const { handler } = require('./liveness.js');

const ev = (ruta, cuerpo) => ({ path: ruta, httpMethod: 'POST', body: JSON.stringify(cuerpo) });
const post = async (ruta, cuerpo) => { const r = await handler(ev(ruta, cuerpo)); return { status: r.statusCode, body: JSON.parse(r.body || '{}') }; };

let pasaron = 0, fallaron = 0;
function check(nombre, cond, detalle='') {
  if (cond) { console.log(`  ✓ ${nombre}`); pasaron++; }
  else { console.log(`  ✗ ${nombre} ${detalle}`); fallaron++; }
}
const reset = () => { rek.__estado.respuestas = {}; rek.__estado.llamadas = []; dyn.__estado.llamadas = []; };

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
r = await post('/liveness-init', { proposito: 'registro', identificacion: '999', nombre: 'Luis Díaz' });
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
r = await post('/liveness-init', { proposito: 'registro', identificacion: '999', nombre: 'Otro' });
check('falla antes de escanear', r.status === 400, `-> ${r.status}`);
check('no pide sesión a Rekognition',
  !rek.__estado.llamadas.some(l => l.tipo === 'CreateFaceLivenessSessionCommand'));

console.log('\n── 8. Registro sin datos ──');
reset();
r = await post('/liveness-init', { proposito: 'registro' });
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
await post('/liveness-init', { proposito: 'registro', identificacion: '777', nombre: 'Marta Ruiz' });
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
  proposito: 'registro', identificacion: '555', nombre: 'Sofía Rojas', sin_destellos: true });
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
await post('/liveness-init', { proposito: 'registro', identificacion: '556', nombre: 'Iván Peña' });
check('sin la bandera, el registro mantiene los destellos',
  tipo === 'FaceMovementAndLightChallenge', `-> ${tipo}`);

console.log(`\n${'─'.repeat(50)}\n${pasaron} pasaron · ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
})();
