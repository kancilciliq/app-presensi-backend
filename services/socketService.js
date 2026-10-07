let io;

module.exports = {
  init: (server) => {
    const { Server } = require('socket.io');
    io = new Server(server, {
      cors: { origin: '*', methods: ['GET', 'POST'] }
    });
    return io;
  },
  getIo: () => {
    if (!io) throw new Error('Socket.io belum diinisialisasi!');
    return io;
  }
};