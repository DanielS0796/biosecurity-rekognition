require('./preparar.js');
const dyn = require('@aws-sdk/client-dynamodb');
const { handler } = require('./auditoria.actual.js');

let pasaron = 0, fallaron = 0;
function check(nombre, cond, detalle = '') {
  if (cond) { console.log(`  ✓ ${nombre}`); pasaron++; }
  else { console.log(`  ✗ ${nombre} ${detalle}`); fallaron++; }
}

const acceso = (id, nombre, fechaHora, tipo) => ({
  id_acceso: { S: `${id}-${fechaHora}` },
  fecha_hora: { S: fechaHora },
  identificacion: { S: id },
  nombre: { S: nombre },
  resultado: { S: tipo === 'SALIDA' ? 'SALIDA' : 'EXITOSO' },
  tipo_acceso: { S: tipo },
  metodo_validacion: { S: 'liveness' },
});

const pedir = async (q) => {
  const r = await handler({ httpMethod: 'GET', queryStringParameters: q });
  return { status: r.statusCode, body: r.body, json: (() => { try { return JSON.parse(r.body); } catch { return null; } })() };
};

const reset = () => { dyn.__estado.accesos = []; dyn.__estado.empleados = {}; dyn.__estado.retirados = {}; dyn.__estado.scans = []; };

(async () => {

console.log('\n── 1. El turno que cruza la medianoche UTC queda en un solo día ──');
reset();
// Entra 14:00 y sale 20:00 hora Bogotá, el 6 de octubre.
// En UTC eso es 19:00 del 6 y 01:00 del 7.
dyn.__estado.accesos = [
  acceso('100', 'Ana Gómez', '2026-10-06T19:00:00Z', 'ENTRADA'),
  acceso('100', 'Ana Gómez', '2026-10-07T01:00:00Z', 'SALIDA'),
];
let r = await pedir({ format: 'json' });
check('queda un solo registro, no dos', r.json.items.length === 1, `-> ${r.json.items.length}`);
check('con la fecha local del turno', r.json.items[0]?.fecha === '2026-10-06', r.json.items[0]?.fecha);
check('entrada a las 14:00', r.json.items[0]?.hora_entrada === '14:00', r.json.items[0]?.hora_entrada);
check('salida a las 20:00', r.json.items[0]?.hora_salida === '20:00', r.json.items[0]?.hora_salida);

console.log('\n── 2. Buscar por fecha devuelve lo de esa fecha ──');
reset();
dyn.__estado.accesos = [
  acceso('100', 'Ana', '2026-08-15T14:00:00Z', 'ENTRADA'),
  acceso('101', 'Luis', '2026-09-20T14:00:00Z', 'ENTRADA'),
  acceso('102', 'Marta', '2026-10-06T14:00:00Z', 'ENTRADA'),
];
r = await pedir({ format: 'json', desde: '2026-08-01', hasta: '2026-08-31' });
check('solo trae agosto', r.json.items.length === 1, `-> ${r.json.items.length}`);
check('y es el registro correcto', r.json.items[0]?.nombre === 'Ana', r.json.items[0]?.nombre);

console.log('\n── 3. Más de 50 registros: los viejos siguen siendo buscables ──');
reset();
// 60 accesos recientes y uno antiguo. El código anterior recortaba a 50 los
// más nuevos, así que el antiguo era imposible de encontrar.
for (let i = 0; i < 60; i++) {
  const dia = String(10 + (i % 20)).padStart(2, '0');
  dyn.__estado.accesos.push(acceso(`9${i}`, `Empleado ${i}`, `2026-09-${dia}T14:00:00Z`, 'ENTRADA'));
}
dyn.__estado.accesos.push(acceso('777', 'Registro Antiguo', '2026-03-05T14:00:00Z', 'ENTRADA'));
r = await pedir({ format: 'json', desde: '2026-03-01', hasta: '2026-03-31' });
check('encuentra el registro de marzo', r.json.items.length === 1, `-> ${r.json.items.length}`);
check('es el que buscábamos', r.json.items[0]?.nombre === 'Registro Antiguo', r.json.items[0]?.nombre);

reset();
for (let i = 0; i < 60; i++) {
  dyn.__estado.accesos.push(acceso(`8${i}`, `Emp ${i}`, `2026-09-15T14:00:00Z`, 'ENTRADA'));
}
r = await pedir({ format: 'json' });
check('sin filtro ya no recorta a 50', r.json.items.length === 60, `-> ${r.json.items.length}`);

console.log('\n── 4. El CSV usa punto y coma, que es lo que Excel espera acá ──');
reset();
dyn.__estado.accesos = [acceso('100', 'Ana Gómez', '2026-10-06T14:00:00Z', 'ENTRADA')];
r = await pedir({});
const lineas = r.body.replace(/^﻿/, '').split('\r\n');
check('separa con punto y coma', lineas[0].includes(';') && !lineas[0].includes(','), lineas[0]);
check('tiene encabezados', lineas[0].includes('Identificacion'), lineas[0]);
check('y la fila de datos', lineas[1]?.includes('Ana Gómez'), lineas[1]);

console.log('\n── 5. Un nombre con comillas no rompe el CSV ──');
reset();
dyn.__estado.accesos = [acceso('100', 'Ana "La Jefa" Gómez', '2026-10-06T14:00:00Z', 'ENTRADA')];
r = await pedir({});
check('escapa las comillas duplicándolas',
  r.body.includes('"Ana ""La Jefa"" Gómez"'), r.body.split('\r\n')[1]);

console.log('\n── 6. Sin salida se reporta como tal ──');
reset();
dyn.__estado.accesos = [acceso('100', 'Ana', '2026-10-06T14:00:00Z', 'ENTRADA')];
r = await pedir({});
check('dice "Sin salida" en el CSV', r.body.includes('Sin salida'));
r = await pedir({ format: 'json' });
check('y queda vacío en el JSON', r.json.items[0]?.hora_salida === '', JSON.stringify(r.json.items[0]));

console.log('\n── 7. Los rechazados no entran al reporte ──');
reset();
dyn.__estado.accesos = [
  acceso('100', 'Ana', '2026-10-06T14:00:00Z', 'ENTRADA'),
  { ...acceso('DESCONOCIDO', 'DESCONOCIDO', '2026-10-06T15:00:00Z', 'ENTRADA'),
    resultado: { S: 'RECHAZADO' } },
];
r = await pedir({ format: 'json' });
check('solo el acceso válido', r.json.items.length === 1, `-> ${r.json.items.length}`);

console.log('\n── 8. El nombre se completa desde la tabla de empleados ──');
reset();
dyn.__estado.accesos = [acceso('100', '100', '2026-10-06T14:00:00Z', 'ENTRADA')];
dyn.__estado.empleados = { '100': 'Ana Gómez' };
r = await pedir({ format: 'json' });
check('reemplaza la cédula por el nombre', r.json.items[0]?.nombre === 'Ana Gómez', r.json.items[0]?.nombre);

console.log('\n── 9. El Scan pide a DynamoDB solo el rango necesario ──');
reset();
dyn.__estado.accesos = [acceso('100', 'Ana', '2026-10-06T14:00:00Z', 'ENTRADA')];
await pedir({ format: 'json', desde: '2026-10-01', hasta: '2026-10-31' });
const scan = dyn.__estado.scans[0];
check('manda FilterExpression', !!scan.FilterExpression, JSON.stringify(scan.FilterExpression));
check('con margen de un día por lado',
  scan.ExpressionAttributeValues[':ini'].S.startsWith('2026-09-30') &&
  scan.ExpressionAttributeValues[':fin'].S.startsWith('2026-11-01'),
  JSON.stringify(scan.ExpressionAttributeValues));

console.log('\n── 10. Varias entradas en el día: vale la primera y la última salida ──');
reset();
dyn.__estado.accesos = [
  acceso('100', 'Ana', '2026-10-06T13:00:00Z', 'ENTRADA'),
  acceso('100', 'Ana', '2026-10-06T18:00:00Z', 'ENTRADA'),
  acceso('100', 'Ana', '2026-10-06T20:00:00Z', 'SALIDA'),
  acceso('100', 'Ana', '2026-10-06T22:00:00Z', 'SALIDA'),
];
r = await pedir({ format: 'json' });
check('un registro del día', r.json.items.length === 1, `-> ${r.json.items.length}`);
check('primera entrada 08:00', r.json.items[0]?.hora_entrada === '08:00', r.json.items[0]?.hora_entrada);
check('última salida 17:00', r.json.items[0]?.hora_salida === '17:00', r.json.items[0]?.hora_salida);

console.log('\n── 11. Fechas inválidas se ignoran en lugar de romper ──');
reset();
dyn.__estado.accesos = [acceso('100', 'Ana', '2026-10-06T14:00:00Z', 'ENTRADA')];
r = await pedir({ format: 'json', desde: 'no-es-fecha', hasta: '31/12/2026' });
check('responde igual', r.status === 200, `-> ${r.status}`);
check('sin aplicar el filtro corrupto', r.json.items.length === 1, `-> ${r.json.items.length}`);

console.log('\n── El vínculo institucional sale en el reporte ──');
reset();
dyn.__estado.accesos = [
  acceso('200', '200', '2026-10-06T14:00:00Z', 'ENTRADA'),
  acceso('201', '201', '2026-10-06T15:00:00Z', 'ENTRADA'),
  acceso('202', '202', '2026-10-06T16:00:00Z', 'ENTRADA'),
];
dyn.__estado.empleados = {
  '200': { nombre: 'Luz Mena', tipo: 'docente' },
  '202': { nombre: 'Sin categoria', tipo: '' },
};
// Quien ya se retiró sigue apareciendo en el histórico de accesos.
dyn.__estado.retirados = { '201': { nombre: 'Iván Peña', tipo: 'contratista' } };

r = await pedir({ format: 'json' });
const porId = Object.fromEntries(r.json.items.map(i => [i.identificacion, i]));
check('el activo trae su vínculo', porId['200']?.tipo_persona === 'docente',
  JSON.stringify(porId['200']));
check('el retirado también', porId['201']?.tipo_persona === 'contratista',
  JSON.stringify(porId['201']));
check('y su nombre, que antes se perdía', porId['201']?.nombre === 'Iván Peña',
  porId['201']?.nombre);
check('sin categoría queda vacío, no inventado', porId['202']?.tipo_persona === '',
  JSON.stringify(porId['202']?.tipo_persona));

const csv = (await pedir({ format: 'csv' })).body;
check('el CSV lleva la columna', /"Identificacion";"Nombre";"Vinculo";"Fecha"/.test(csv),
  csv.split('\n')[0]);
check('con el valor en su sitio', /"Luz Mena";"docente"/.test(csv),
  csv.split('\n').find(l => l.includes('Luz Mena')));

console.log(`\n${'─'.repeat(50)}\n${pasaron} pasaron · ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
})();
