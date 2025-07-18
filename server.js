const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const rooms = {}; // { roomId: [{ fileName, fileBuffer }] }

app.use(express.static(__dirname));

io.on('connection', (socket) => {
  
  socket.on('multi-file-upload', ({ roomId, files }) => {
    rooms[roomId] = files;  // Store files against room
    io.to(roomId).emit('ready-to-download');  // Notify receiver
  });

  socket.on('join', (roomId) => {
    socket.join(roomId);
    if (rooms[roomId]) {
      socket.emit('ready-to-download');
    }
  });

  socket.on('request-multi-file', (roomId) => {
    const files = rooms[roomId] || [];
    socket.emit('multi-file-data', files);
  });

  

});

http.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
