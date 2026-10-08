const enviados = [];

// El transporte se expone para que una prueba pueda hacerlo fallar y
// comprobar qué pasa cuando el correo no sale.
const transporte = {
  sendMail: async (m) => { enviados.push(m); return { messageId: 'doble' }; },
};

module.exports = {
  __enviados: enviados,
  __transporte: transporte,
  createTransport: () => transporte,
};
