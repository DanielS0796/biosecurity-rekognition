const tablas = {};
const estado = { tablas, llamadas: [] };
class Cmd { constructor(i){ this.input = i; this.tipo = this.constructor.name; } }
class PutItemCommand extends Cmd {}
class GetItemCommand extends Cmd {}
class UpdateItemCommand extends Cmd {}
class QueryCommand extends Cmd {}
function clave(item) { return item.session_id?.S || item.identificacion?.S || item.id_acceso?.S; }
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
    if (cmd.tipo === 'QueryCommand') return { Items: [] };
    return {};
  }
}
module.exports = { DynamoDBClient, PutItemCommand, GetItemCommand,
  UpdateItemCommand, QueryCommand, __estado: estado };
