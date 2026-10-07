const estado = { accesos: [], empleados: {}, scans: [] };
class Cmd { constructor(i){ this.input = i; this.tipo = this.constructor.name; } }
class ScanCommand extends Cmd {}
class GetItemCommand extends Cmd {}
class DynamoDBClient {
  async send(cmd) {
    if (cmd.tipo === 'ScanCommand') {
      estado.scans.push(cmd.input);
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
      const n = estado.empleados[id];
      return { Item: n ? { identificacion: { S: id }, nombre: { S: n } } : undefined };
    }
    return {};
  }
}
module.exports = { DynamoDBClient, ScanCommand, GetItemCommand, __estado: estado };
