const enviados = [];
module.exports = {
  __enviados: enviados,
  createTransport: () => ({
    sendMail: async (m) => { enviados.push(m); return { messageId: 'doble' }; },
  }),
};
