// Los dobles del SDK viven en dobles/ para que queden versionados, y de ahí
// se copian a node_modules, que es donde require() los busca. node_modules
// está en .gitignore, así que este paso hace las pruebas reproducibles
// después de un clon.
const fs = require('fs');
const path = require('path');

const pares = [
  ['rekognition.js', '@aws-sdk/client-rekognition'],
  ['dynamodb.js', '@aws-sdk/client-dynamodb'],
];

for (const [origen, paquete] of pares) {
  const destino = path.join(__dirname, 'node_modules', paquete);
  fs.mkdirSync(destino, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'dobles', origen), path.join(destino, 'index.js'));
  fs.writeFileSync(
    path.join(destino, 'package.json'),
    JSON.stringify({ name: paquete, version: '0.0.0-doble', main: 'index.js' }, null, 2)
  );
}

// Node resuelve los require() desde la ubicación del archivo que los hace, así
// que para que el Lambda vea los dobles tiene que ejecutarse desde acá. Se
// copia en cada corrida para que las pruebas nunca pasen contra código viejo.
fs.copyFileSync(
  path.join(__dirname, '..', '..', 'lambda', 'liveness.js'),
  path.join(__dirname, 'liveness.actual.js')
);
