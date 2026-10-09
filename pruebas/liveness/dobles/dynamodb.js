const tablas = {};
const estado = { tablas, llamadas: [] };
class Cmd { constructor(i){ this.input = i; this.tipo = this.constructor.name; } }
class PutItemCommand extends Cmd {}
class GetItemCommand extends Cmd {}
class UpdateItemCommand extends Cmd {}
class QueryCommand extends Cmd {}
function clave(item) { return item.session_id?.S || item.identificacion?.S || item.id_acceso?.S; }
// El doble viejo devolvía { Items: [] } para toda consulta. Eso dejó sin
// probar la lógica que decide si un escaneo es entrada o salida —siempre
// parecía que no había entradas abiertas— y ahí vivió un bug: la consulta
// filtraba por día UTC, que en Bogotá cambia a las 7 de la noche.
//
// Esto no es DynamoDB: entiende solo las formas que el Lambda usa de
// verdad, y falla con un error claro ante cualquier otra. Un doble que
// contesta "no hay nada" a lo que no entiende es peor que no tenerlo.
function consultar(tabla, input) {
  const v = input.ExpressionAttributeValues || {};
  const clave = input.KeyConditionExpression || '';
  const filtro = input.FilterExpression || '';

  const soportado =
    /^identificacion = :id AND (begins_with\(fecha_hora, :fecha\)|fecha_hora >= :desde)$/
      .test(clave.trim());
  if (!soportado) {
    throw new Error(`El doble no entiende esta KeyConditionExpression: ${clave}`);
  }

  let items = Object.values(tabla || {})
    .filter(i => i.identificacion?.S === v[':id']?.S);

  if (clave.includes('begins_with')) {
    items = items.filter(i => (i.fecha_hora?.S || '').startsWith(v[':fecha'].S));
  } else {
    items = items.filter(i => (i.fecha_hora?.S || '') >= v[':desde'].S);
  }

  for (const parte of filtro.split(' AND ').map(x => x.trim()).filter(Boolean)) {
    if (parte === 'tipo_acceso = :entrada') {
      items = items.filter(i => i.tipo_acceso?.S === v[':entrada'].S);
    } else if (parte === 'attribute_not_exists(hora_salida)') {
      items = items.filter(i => i.hora_salida === undefined);
    } else {
      throw new Error(`El doble no entiende este FilterExpression: ${parte}`);
    }
  }

  items.sort((a, b) => (a.fecha_hora?.S || '').localeCompare(b.fecha_hora?.S || ''));
  if (input.ScanIndexForward === false) items.reverse();

  return { Items: items };
}

class DynamoDBClient {
  async send(cmd) {
    const t = cmd.input.TableName;
    tablas[t] = tablas[t] || {};
    estado.llamadas.push({ tipo: cmd.tipo, tabla: t });
    if (cmd.tipo === 'PutItemCommand') { tablas[t][clave(cmd.input.Item)] = cmd.input.Item; return {}; }
    if (cmd.tipo === 'GetItemCommand') {
      const k = Object.values(cmd.input.Key)[0].S;
      return { Item: tablas[t][k] };
    }
    if (cmd.tipo === 'UpdateItemCommand') {
      const k = Object.values(cmd.input.Key)[0].S;
      const item = tablas[t][k];
      if (cmd.input.ConditionExpression?.includes('estado')) {
        const esperado = cmd.input.ExpressionAttributeValues[':pendiente'].S;
        if (!item || item.estado?.S !== esperado) {
          const e = new Error('condicion fallida'); e.name = 'ConditionalCheckFailedException'; throw e;
        }
      }
      if (item) item.estado = { S: cmd.input.ExpressionAttributeValues[':procesando']?.S
                                  || cmd.input.ExpressionAttributeValues[':estado']?.S };
      return {};
    }
    if (cmd.tipo === 'QueryCommand') return consultar(tablas[t], cmd.input);
    return {};
  }
}
module.exports = { DynamoDBClient, PutItemCommand, GetItemCommand,
  UpdateItemCommand, QueryCommand, __estado: estado };
