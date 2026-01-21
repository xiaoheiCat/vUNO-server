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

const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 创建房间
    socket.on('create_room', ({ playerName, maxPlayers }, callback) => {
        const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        rooms.set(roomId, {
            id: roomId,
            hostId: socket.id,
            players: [{
                id: socket.id,
                name: playerName,
                isHost: true
            }],
            maxPlayers: maxPlayers || 10
        });

        socket.join(roomId);
        callback({ success: true, roomId });
        console.log(`Room created: ${roomId} by ${playerName} (${socket.id})`);
    });

    // 加入房间
    socket.on('join_room', ({ roomId, playerName }, callback) => {
        const room = rooms.get(roomId);

        if (!room) {
            return callback({ success: false, error: '房间不存在' });
        }

        if (room.players.length >= room.maxPlayers) {
            return callback({ success: false, error: '房间已满' });
        }

        room.players.push({
            id: socket.id,
            name: playerName,
            isHost: false
        });

        socket.join(roomId);

        // 关键逻辑：通知房主发起连接
        // 房主收到 player_joined 后，会创建 WebRTC Offer 发送给这个新玩家
        io.to(room.hostId).emit('player_joined', {
            playerId: socket.id,
            playerName: playerName
        });

        callback({ success: true, roomId });
        console.log(`${playerName} (${socket.id}) joined room ${roomId}`);
    });

    // WebRTC 信令转发
    socket.on('signal', ({ targetId, type, payload }) => {
        io.to(targetId).emit('signal', {
            senderId: socket.id,
            type,
            payload
        });
    });

    // 断开连接处理
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // 简单处理：如果是房主离开，理论上应该解散房间或转移房主
        // 这里暂时只处理清理
        for (const [roomId, room] of rooms.entries()) {
            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                // 通知房间内其他人
                io.to(roomId).emit('player_left', { playerId: socket.id });

                if (room.players.length === 0) {
                    rooms.delete(roomId);
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
