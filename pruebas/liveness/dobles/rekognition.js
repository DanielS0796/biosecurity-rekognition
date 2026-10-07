const estado = { respuestas: {}, llamadas: [] };
class Cmd { constructor(i){ this.input = i; this.tipo = this.constructor.name; } }
class CreateFaceLivenessSessionCommand extends Cmd {}
class GetFaceLivenessSessionResultsCommand extends Cmd {}
class SearchFacesByImageCommand extends Cmd {}
class IndexFacesCommand extends Cmd {}
class DeleteFacesCommand extends Cmd {}
class RekognitionClient {
  async send(cmd) {
    estado.llamadas.push({ tipo: cmd.tipo, input: cmd.input });
    const r = estado.respuestas[cmd.tipo];
    if (typeof r === 'function') return r(cmd.input);
    if (r instanceof Error) throw r;
    return r || {};
  }
}
module.exports = { RekognitionClient, CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand, SearchFacesByImageCommand,
  IndexFacesCommand, DeleteFacesCommand, __estado: estado };
