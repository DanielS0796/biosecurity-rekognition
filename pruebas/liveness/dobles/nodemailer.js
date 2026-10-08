// El Lambda manda la constancia de la autorización por correo. Acá se
// captura para poder comprobar qué dice, sin enviar nada.
const enviados = [];

const transporte = {
  sendMail: async (m) => { enviados.push(m); return { messageId: 'doble' }; },
};

module.exports = {
  __enviados: enviados,
  __transporte: transporte,
  createTransport: () => transporte,
};
