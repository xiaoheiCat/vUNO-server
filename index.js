const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Room storage: roomId -> { hostId, players: [ { id, name } ], maxPlayers }
const rooms = new Map();
// Player mapping: socketId -> roomId
const playerRooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Create Room
    socket.on('create_room', ({ playerName, maxPlayers, characterId }, callback) => {
        // Generate a short room ID (6 chars)
        const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();

        rooms.set(roomId, {
            id: roomId,
            hostId: socket.id,
            players: [{ id: socket.id, name: playerName, characterId: characterId }],
            maxPlayers: maxPlayers || 10
        });

        playerRooms.set(socket.id, roomId);
        socket.join(roomId);

        console.log(`Room created: ${roomId} by ${playerName} (${socket.id}) with char ${characterId}`);

        callback({ success: true, roomId });
    });

    // Join Room
    socket.on('join_room', ({ roomId, playerName, characterId }, callback) => {
        // Case insensitive room ID
        const normalizedRoomId = roomId.toUpperCase();
        const room = rooms.get(normalizedRoomId);

        if (!room) {
            return callback({ success: false, error: '找不到该房间' });
        }

        if (room.players.length >= room.maxPlayers) {
            return callback({ success: false, error: '该房间已满员' });
        }

        room.players.push({ id: socket.id, name: playerName, characterId: characterId });
        playerRooms.set(socket.id, normalizedRoomId);
        socket.join(normalizedRoomId);

        console.log(`Player ${playerName} (${socket.id}) joined room ${normalizedRoomId} with char ${characterId}`);

        // Notify Host
        io.to(room.hostId).emit('player_joined', { playerId: socket.id, playerName, characterId });

        // Broadcast to others in the room
        socket.to(normalizedRoomId).emit('player_joined_broadcast', { playerId: socket.id, playerName, characterId });

        callback({ success: true, roomId: normalizedRoomId });
    });

    // WebRTC Signaling (Keep for P2P audio/video expansion)
    socket.on('signal', ({ targetId, type, payload }) => {
        io.to(targetId).emit('signal', {
            senderId: socket.id,
            type,
            payload
        });
    });

    // === Game Data Forwarding ===

    // Broadcast to room (exclude sender)
    socket.on('broadcast_game_event', (data) => {
        const roomId = playerRooms.get(socket.id);
        if (roomId) {
            socket.to(roomId).emit('game_event', {
                senderId: socket.id,
                payload: data
            });
        }
    });

    // Send to specific player
    socket.on('send_game_event', ({ targetId, data }) => {
        io.to(targetId).emit('game_event', {
            senderId: socket.id,
            payload: data
        });
    });

    // Start Game (房主触发，服务器统一广播玩家顺序)
    socket.on('start_game', (callback) => {
        const roomId = playerRooms.get(socket.id);
        if (!roomId) {
            return callback({ success: false, error: '你不在任何房间中' });
        }

        const room = rooms.get(roomId);
        if (!room) {
            return callback({ success: false, error: '找不到该房间' });
        }

        // 只有房主可以开始游戏
        if (socket.id !== room.hostId) {
            return callback({ success: false, error: '只有房主才能开始游戏' });
        }

        // 至少需要2名玩家
        if (room.players.length < 2) {
            return callback({ success: false, error: '至少需要 2 名玩家才能开始游戏' });
        }

        console.log(`Game starting in room ${roomId} with players:`, room.players);

        // 向房间内所有玩家广播游戏开始（包括房主）
        // 关键：所有客户端收到的 playerList 顺序完全一致
        io.in(roomId).emit('game_started', {
            playerList: room.players, // 服务器维护的顺序（按加入时间）
            firstPlayerId: room.players[0].id // 第一个玩家的 ID
        });

        callback({ success: true });
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        const roomId = playerRooms.get(socket.id);
        if (roomId) {
            const room = rooms.get(roomId);
            if (room) {
                // Remove player
                room.players = room.players.filter(p => p.id !== socket.id);

                // Notify others
                socket.to(roomId).emit('player_left', { playerId: socket.id });

                // If host left
                if (socket.id === room.hostId) {
                    if (room.players.length > 0) {
                        // Assign new host
                        room.hostId = room.players[0].id;
                        io.to(room.hostId).emit('you_are_host');
                        // Notify everyone about new host
                        io.in(roomId).emit('host_changed', { newHostId: room.hostId });
                        console.log(`Host changed in room ${roomId} to ${room.hostId}`);
                    } else {
                        // Destroy room
                        rooms.delete(roomId);
                        console.log(`Room ${roomId} destroyed (empty)`);
                    }
                } else if (room.players.length === 0) {
                    rooms.delete(roomId);
                    console.log(`Room ${roomId} destroyed (empty)`);
                }
            }
            playerRooms.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
