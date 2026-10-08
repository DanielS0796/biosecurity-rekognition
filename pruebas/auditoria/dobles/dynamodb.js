const estado = { accesos: [], empleados: {}, retirados: {}, scans: [] };
class Cmd { constructor(i){ this.input = i; this.tipo = this.constructor.name; } }
class ScanCommand extends Cmd {}
class GetItemCommand extends Cmd {}

/**
 * Convierte el padrón de la prueba en items de DynamoDB.
 * Acepta 'Ana Gómez' o { nombre: 'Ana Gómez', tipo: 'docente' }, para no
 * tener que reescribir las pruebas que solo usaban el nombre.
 */
function comoItems(padron) {
  return Object.entries(padron).map(([id, v]) => {
    const { nombre, tipo } = typeof v === 'string' ? { nombre: v, tipo: '' } : v;
    const item = { identificacion: { S: id } };
    if (nombre) item.nombre = { S: nombre };
    if (tipo) item.tipo_persona = { S: tipo };
    return item;
  });
}

class DynamoDBClient {
  async send(cmd) {
    if (cmd.tipo === 'ScanCommand') {
      estado.scans.push(cmd.input);
      const tabla = cmd.input.TableName || '';

      // El Scan se despacha por tabla: auditoría consulta accesos,
      // empleados y retirados, y devolver siempre los accesos haría que
      // las pruebas pasaran contra datos que no son los que pidió.
      if (tabla.includes('empleados')) return { Items: comoItems(estado.empleados) };
      if (tabla.includes('retirados')) return { Items: comoItems(estado.retirados) };

      let items = estado.accesos;
      // Emula el FilterExpression "fecha_hora BETWEEN :ini AND :fin"
      if (cmd.input.FilterExpression && cmd.input.ExpressionAttributeValues) {
        const ini = cmd.input.ExpressionAttributeValues[':ini']?.S;
        const fin = cmd.input.ExpressionAttributeValues[':fin']?.S;
        items = items.filter(i => {
          const v = i.fecha_hora?.S || '';
          return (!ini || v >= ini) && (!fin || v <= fin);
        });
      }
      return { Items: items };
    }
    if (cmd.tipo === 'GetItemCommand') {
      const id = Object.values(cmd.input.Key)[0].S;
      const v = estado.empleados[id];
      const nombre = typeof v === 'string' ? v : v?.nombre;
      return { Item: nombre ? { identificacion: { S: id }, nombre: { S: nombre } } : undefined };
    }
    return {};
  }
}
module.exports = { DynamoDBClient, ScanCommand, GetItemCommand, __estado: estado };
