const fs = require('fs');
const path = require('path');
const paquetes = [
  ['dynamodb.js', '@aws-sdk/client-dynamodb'],
  ['sentry.js', '@sentry/aws-serverless'],
  ['nodemailer.js', 'nodemailer'],
];
for (const [origen, paquete] of paquetes) {
  const destino = path.join(__dirname, 'node_modules', paquete);
  fs.mkdirSync(destino, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'dobles', origen), path.join(destino, 'index.js'));
  fs.writeFileSync(path.join(destino, 'package.json'),
    JSON.stringify({ name: paquete, version: '0.0.0-doble', main: 'index.js' }, null, 2));
}
fs.copyFileSync(path.join(__dirname, 'dobles', 'instrument.js'), path.join(__dirname, 'instrument.js'));
fs.copyFileSync(path.join(__dirname, '..', '..', 'lambda', 'reset.js'), path.join(__dirname, 'reset.actual.js'));
