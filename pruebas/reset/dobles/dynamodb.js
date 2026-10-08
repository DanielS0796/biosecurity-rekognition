const estado = { usuarios: {}, codigos: {}, llamadas: [] };
class Cmd { constructor(i){ this.input = i; this.tipo = this.constructor.name; } }
class PutItemCommand extends Cmd {}
class GetItemCommand extends Cmd {}
class DeleteItemCommand extends Cmd {}
class UpdateItemCommand extends Cmd {}
class ScanCommand extends Cmd {}

const tabla = (n) => n.includes('codes') ? estado.codigos : estado.usuarios;

class DynamoDBClient {
  async send(cmd) {
    const t = tabla(cmd.input.TableName);
    estado.llamadas.push({ tipo: cmd.tipo, tabla: cmd.input.TableName });

    if (cmd.tipo === 'PutItemCommand') { t[cmd.input.Item.email.S] = cmd.input.Item; return {}; }
    if (cmd.tipo === 'GetItemCommand') { return { Item: t[cmd.input.Key.email.S] }; }
    if (cmd.tipo === 'DeleteItemCommand') { delete t[cmd.input.Key.email.S]; return {}; }
    if (cmd.tipo === 'ScanCommand') { return { Items: Object.values(t) }; }
    if (cmd.tipo === 'UpdateItemCommand') {
      const k = cmd.input.Key.email.S;
      const item = t[k] || { email: { S: k } };
      // Interpreta "SET a = :x, #b = :y" con los valores dados.
      // Los alias #nombre se resuelven por ExpressionAttributeNames igual
      // que en DynamoDB, y un alias sin declarar revienta acá, que es lo
      // que hace el servicio de verdad.
      const nombres = cmd.input.ExpressionAttributeNames || {};
      const expr = cmd.input.UpdateExpression.replace(/^SET\s+/i, '');
      for (const parte of expr.split(',')) {
        const [crudo, ph] = parte.split('=').map(s => s.trim());
        let campo = crudo;
        if (crudo.startsWith('#')) {
          if (!(crudo in nombres)) {
            throw Object.assign(
              new Error(`ExpressionAttributeNames no declara ${crudo}`),
              { name: 'ValidationException' }
            );
          }
          campo = nombres[crudo];
        }
        item[campo] = cmd.input.ExpressionAttributeValues[ph];
      }
      t[k] = item;
      return {};
    }
    return {};
  }
}
module.exports = { DynamoDBClient, PutItemCommand, GetItemCommand,
  DeleteItemCommand, UpdateItemCommand, ScanCommand, __estado: estado };
