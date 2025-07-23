// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // 100MB buffer for large files
});

// Store active rooms and their participants
const activeRooms = new Map();
const fileChunks = new Map(); // Store file chunks temporarily
const hostGracePeriod = new Map(); // Track host reconnection grace periods

// Generate unique room codes
function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Serve static files
app.use(express.static(__dirname));

// Handle room code routes
app.get('/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode;
  
  // Validate room code format (6 characters, alphanumeric)
  if (/^[A-Fa-f0-9]{6}$/.test(roomCode)) {
    // Serve the main index.html file for valid room codes
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    // Invalid room code format, return 404
    res.status(404).send('Invalid room code format');
  }
});

// Handle root route explicitly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  //console.log('User connected:', socket.id);

  // Create a new sharing room
  socket.on('create-room', () => {
    const roomCode = generateRoomCode();
    socket.join(roomCode);
    
    if (!activeRooms.has(roomCode)) {
      activeRooms.set(roomCode, {
        host: socket.id,
        participants: new Set([socket.id]),
        files: new Map(),
        createdAt: Date.now()
      });
    }
    
    socket.emit('room-created', { 
      roomCode, 
      isHost: true,
      participantCount: 1
    });
//console.log(`Room ${roomCode} created by ${socket.id}`);
  });

  // Join an existing room
  socket.on('join-room', (roomCode) => {
    const room = activeRooms.get(roomCode);
    
    if (room) {
      socket.join(roomCode);
      room.participants.add(socket.id);
      
      // Clear any existing grace period for this room
      if (hostGracePeriod.has(roomCode)) {
        clearTimeout(hostGracePeriod.get(roomCode));
        hostGracePeriod.delete(roomCode);
      }
      
      // Send current file list to new participant
      const fileList = Array.from(room.files.values()).map(file => ({
        id: file.id,
        name: file.name,
        size: file.size,
        type: file.type,
        senderId: file.senderId,
        totalChunks: file.totalChunks,
        createdAt: file.createdAt
      }));
      
      const isHost = room.host === socket.id;
      
      socket.emit('room-joined', { 
        roomCode, 
        files: fileList, 
        isHost: isHost,
        participantCount: room.participants.size
      });
      
      // Notify ALL participants (including new one) about updated count
      io.to(roomCode).emit('participant-count-updated', {
        count: room.participants.size
      });
      
      // Notify OTHER participants about new joiner (only if not host rejoining)
      if (!isHost) {
        socket.to(roomCode).emit('participant-joined', socket.id);
        socket.to(roomCode).emit('status-message', {
          message: 'A new participant joined the room.',
          type: 'info'
        });
      }
      
  //console.log(`${socket.id} joined room ${roomCode}. Total participants: ${room.participants.size}. IsHost: ${isHost}`);
    } else {
      socket.emit('room-not-found');
    }
  });

  // Validate room existence
  socket.on('validate-room', (roomCode) => {
    const room = activeRooms.get(roomCode);
    
    if (room) {
      // Room exists, let them join
      socket.emit('join-room', roomCode);
    } else {
      // Room doesn't exist
      socket.emit('room-invalid');
    }
  });

  // Handle host leaving with confirmation
  socket.on('host-leave-request', (roomCode) => {
    const room = activeRooms.get(roomCode);
    
    if (room && room.host === socket.id) {
      // Send confirmation request to host
      socket.emit('host-leave-confirmation', {
        message: 'Are you sure you want to leave? This will close the room for all participants.',
        participantCount: room.participants.size - 1 // Exclude host
      });
    }
  });

  // Handle confirmed host leave
  socket.on('host-leave-confirmed', (roomCode) => {
    const room = activeRooms.get(roomCode);
    
    if (room && room.host === socket.id) {
  //console.log(`Host ${socket.id} confirmed leaving room ${roomCode}`);
      
      // Notify all other participants that room is closing
      socket.to(roomCode).emit('room-closed-by-host');
      
      // Clean up the room
      activeRooms.delete(roomCode);
      
      // Clear any grace period timers
      if (hostGracePeriod.has(roomCode)) {
        clearTimeout(hostGracePeriod.get(roomCode));
        hostGracePeriod.delete(roomCode);
      }
      
  //console.log(`Room ${roomCode} closed by host`);
    }
  });

  // Leave room voluntarily (for non-hosts)
  socket.on('leave-room', (roomCode) => {
    const room = activeRooms.get(roomCode);
    
    if (room && room.participants.has(socket.id)) {
      // Check if this is the host
      if (room.host === socket.id) {
        // Host is trying to leave - send confirmation request
        socket.emit('host-leave-confirmation', {
          message: 'Are you sure you want to leave? This will close the room for all participants.',
          participantCount: room.participants.size - 1
        });
        return;
      }
      
      // Regular participant leaving
      room.participants.delete(socket.id);
      socket.leave(roomCode);
      
  //console.log(`${socket.id} left room ${roomCode} voluntarily. Remaining: ${room.participants.size}`);
      
      // Update participant count for remaining users
      if (room.participants.size > 0) {
        socket.to(roomCode).emit('participant-count-updated', {
          count: room.participants.size
        });
        socket.to(roomCode).emit('participant-left', socket.id);
        socket.to(roomCode).emit('status-message', {
          message: 'A participant left the room.',
          type: 'info'
        });
      }
      
      // If no participants left, clean up room
      if (room.participants.size === 0) {
        activeRooms.delete(roomCode);
    //console.log(`Room ${roomCode} deleted - no participants remaining`);
      }
    }
  });

  // Handle file metadata sharing
  socket.on('share-file', (data) => {
    const { roomCode, fileInfo } = data;
    const room = activeRooms.get(roomCode);
    
    if (room) {
      const fileData = {
        id: fileInfo.id,
        name: fileInfo.name,
        size: fileInfo.size,
        type: fileInfo.type,
        senderId: socket.id,
        chunks: new Map(),
        totalChunks: Math.ceil(fileInfo.size / (1024 * 1024)), // 1MB chunks
        receivedChunks: 0,
        createdAt: Date.now()
      };
      
      room.files.set(fileInfo.id, fileData);
      
      // Broadcast file availability to all participants
      io.to(roomCode).emit('file-available', {
        id: fileData.id,
        name: fileData.name,
        size: fileData.size,
        type: fileData.type,
        senderId: fileData.senderId,
        totalChunks: fileData.totalChunks,
        createdAt: fileData.createdAt
      });
    }
  });

  // Handle file chunk transfer
  socket.on('file-chunk', (data) => {
    const { roomCode, fileId, chunkIndex, chunkData, isLast } = data;
    const room = activeRooms.get(roomCode);
    
    if (room && room.files.has(fileId)) {
      const fileData = room.files.get(fileId);
      
      // Store chunk temporarily
      const chunkKey = `${fileId}-${chunkIndex}`;
      fileChunks.set(chunkKey, {
        data: chunkData,
        timestamp: Date.now(),
        fileId,
        chunkIndex
      });
      
      fileData.chunks.set(chunkIndex, chunkKey);
      fileData.receivedChunks++;
      
      // Broadcast chunk availability to other participants
      socket.to(roomCode).emit('chunk-available', {
        fileId,
        chunkIndex,
        isLast,
        progress: fileData.receivedChunks / fileData.totalChunks
      });
      
      // Clean up completed file chunks after 5 minutes
      if (isLast) {
        setTimeout(() => {
          for (let [key, chunk] of fileChunks.entries()) {
            if (chunk.fileId === fileId) {
              fileChunks.delete(key);
            }
          }
        }, 5 * 60 * 1000);
      }
    }
  });

  // Handle file info requests
  socket.on('request-file-info', (data) => {
    const { roomCode, fileId } = data;
    const room = activeRooms.get(roomCode);
    
    if (room && room.files.has(fileId)) {
      const fileData = room.files.get(fileId);
      socket.emit('file-info', {
        fileId: fileId,
        totalChunks: fileData.totalChunks,
        name: fileData.name,
        size: fileData.size
      });
    }
  });

  // Handle chunk requests
  socket.on('request-chunk', (data) => {
    const { roomCode, fileId, chunkIndex } = data;
    const chunkKey = `${fileId}-${chunkIndex}`;
    
    if (fileChunks.has(chunkKey)) {
      const chunkData = fileChunks.get(chunkKey);
      socket.emit('chunk-data', {
        fileId,
        chunkIndex,
        data: chunkData.data
      });
    }
  });

  // Handle disconnection with grace period for hosts
  socket.on('disconnect', (reason) => {
//console.log(`User disconnected: ${socket.id}, Reason: ${reason}`);
    
    // Clean up rooms and update participant counts
    for (let [roomCode, room] of activeRooms.entries()) {
      if (room.host === socket.id) {
    //console.log(`Host ${socket.id} disconnected from room ${roomCode}. Starting grace period...`);
        
        // Remove host from participants temporarily
        //room.participants.delete(socket.id);
        
        // Update participant count for remaining users
        if (room.participants.size > 0) {
          socket.to(roomCode).emit('participant-count-updated', {
            count: room.participants.size
          });
          socket.to(roomCode).emit('status-message', {
            message: 'Host temporarily disconnected. Waiting for reconnection...',
            type: 'warning'
          });
        }
        
        // Give host a brief moment to reconnect (in case of refresh)
        const gracePeriodTimer = setTimeout(() => {
          // Check if host reconnected within grace period
          const currentRoom = activeRooms.get(roomCode);
          if (currentRoom && !currentRoom.participants.has(socket.id)) {
            // Host didn't reconnect - close the room
            // io.to(roomCode).emit('room-closed-by-host');
            // activeRooms.delete(roomCode);
            // hostGracePeriod.delete(roomCode);
            //console.log(`Room ${roomCode} closed - host disconnected permanently`);
          }
        }, 5000); // 5 second grace period for refresh
        
        hostGracePeriod.set(roomCode, gracePeriodTimer);
        
      } else if (room.participants.has(socket.id)) {
        // Regular participant left - update count immediately
        room.participants.delete(socket.id);
        
        socket.to(roomCode).emit('participant-count-updated', {
          count: room.participants.size
        });
        socket.to(roomCode).emit('participant-left', socket.id);
        socket.to(roomCode).emit('status-message', {
          message: 'A participant left the room.',
          type: 'info'
        });
        
        //console.log(`${socket.id} left room ${roomCode}. Remaining participants: ${room.participants.size}`);
        
        if (room.participants.size === 0) {
          activeRooms.delete(roomCode);
          //console.log(`Room ${roomCode} deleted - no participants remaining`);
        }
      }
    }
  });
});

// Clean up old chunks every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (let [key, chunk] of fileChunks.entries()) {
    if (now - chunk.timestamp > 10 * 60 * 1000) { // 10 minutes
      fileChunks.delete(key);
    }
  }
}, 10 * 60 * 1000);

// Clean up empty rooms every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (let [roomCode, room] of activeRooms.entries()) {
    // Clean up rooms older than 2 hours with no participants
    if (room.participants.size === 0 && (now - room.createdAt > 2 * 60 * 60 * 1000)) {
      activeRooms.delete(roomCode);
      //console.log(`Cleaned up empty room: ${roomCode}`);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} and hello Hi`);
});
