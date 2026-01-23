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

// Room storage: roomId -> { hostId, players: [ { id, name } ], maxPlayers, gameState }
const rooms = new Map();
// Player mapping: socketId -> roomId
const playerRooms = new Map();

/**
 * 游戏状态结构：
 * {
 *   currentPlayerId: string,  // 当前回合玩家的 socket ID
 *   deck: Array,               // 牌库（洗好的牌）
 *   playerHands: Map,          // 玩家手牌 socketId -> [cards]
 *   topCard: Object,           // 顶牌
 *   discardPile: Array         // 弃牌堆
 * }
 */

// 基于种子的伪随机数生成器（LCG算法，与客户端保持一致）
function seededRandom(seed) {
    seed = (seed * 9301 + 49297) % 233280;
    return { value: seed / 233280, seed };
}

// 生成并洗牌
function generateShuffledDeck(seed) {
    const cardDistribution = [
        // 红色卡牌
        { type: 'red', value: 3, count: 8 },
        { type: 'red', value: 4, count: 6 },
        { type: 'red', value: 5, count: 4 },
        { type: 'red', value: 6, count: 2 },
        // 黄色卡牌
        { type: 'yellow', value: 3, count: 6 },
        { type: 'yellow', value: 4, count: 8 },
        { type: 'yellow', value: 5, count: 5 },
        { type: 'yellow', value: 6, count: 3 },
        // 绿色卡牌
        { type: 'green', value: 3, count: 4 },
        { type: 'green', value: 4, count: 6 },
        { type: 'green', value: 5, count: 8 },
        { type: 'green', value: 6, count: 4 },
        // 灰色卡牌
        { type: 'grey', value: 3, count: 5 },
        { type: 'grey', value: 4, count: 6 },
        { type: 'grey', value: 5, count: 5 },
        { type: 'grey', value: 6, count: 4 },
    ];

    // 创建牌库
    const deck = [];
    cardDistribution.forEach(config => {
        for (let i = 0; i < config.count; i++) {
            deck.push({ type: config.type, value: config.value });
        }
    });

    // Fisher-Yates 洗牌（使用种子）
    let currentSeed = seed;
    for (let i = deck.length - 1; i > 0; i--) {
        const result = seededRandom(currentSeed);
        currentSeed = result.seed;
        const j = Math.floor(result.value * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
}

// 辅助函数：生成随机技能牌ID
function generateRandomSkillId() {
    // 🔧 修复：使用与单人模式一致的技能ID
    // 目前仅开放已实现的技能：HATER (小黑子), STAY_UP (熬夜上分)
    const skills = ['HATER', 'STAY_UP'];
    return skills[Math.floor(Math.random() * skills.length)];
}

io.on('connection', (socket) => {
    // console.log('用户已连接:', socket.id);

    // Create Room
    socket.on('create_room', ({ playerName, maxPlayers, characterId }, callback) => {
        // Generate a short room ID (6 chars)
        const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();

        rooms.set(roomId, {
            id: roomId,
            hostId: socket.id,
            players: [{
                id: socket.id,
                name: playerName,
                characterId: characterId,
                isHost: true // 明确标记房主
            }],
            maxPlayers: maxPlayers || 4
        });

        playerRooms.set(socket.id, roomId);
        socket.join(roomId);

        // console.log(`房间已创建: ${roomId} 房主: ${playerName} (${socket.id}) 角色: ${characterId}`);

        callback({ success: true, roomId, hostId: socket.id });
    });

    // Join Room
    socket.on('join_room', ({ roomId, playerName, characterId }, callback) => {
        // Case insensitive room ID
        const normalizedRoomId = roomId.toUpperCase();
        const room = rooms.get(normalizedRoomId);

        if (!room) {
            return callback({ success: false, error: '房间不存在' });
        }

        // 🔧 修复：阻止在游戏开始后加入房间
        if (room.gameState) {
            return callback({ success: false, error: '游戏已开始，无法加入' });
        }

        if (room.players.length >= room.maxPlayers) {
            return callback({ success: false, error: '房间已满' });
        }

        room.players.push({
            id: socket.id,
            name: playerName,
            characterId: characterId,
            isHost: false // 明确标记非房主
        });
        playerRooms.set(socket.id, normalizedRoomId);
        socket.join(normalizedRoomId);

        // console.log(`玩家 ${playerName} (${socket.id}) 已加入房间 ${normalizedRoomId}，角色: ${characterId}`);

        // Notify Host
        io.to(room.hostId).emit('player_joined', {
            playerId: socket.id,
            playerName,
            characterId,
            isHost: false
        });

        // Broadcast to others in the room
        socket.to(normalizedRoomId).emit('player_joined_broadcast', {
            playerId: socket.id,
            playerName,
            characterId,
            isHost: false
        });

        callback({ success: true, roomId: normalizedRoomId, hostId: room.hostId });
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

    // Start Game (房主触发，服务器统一管理游戏状态)
    socket.on('start_game', (callback) => {
        const roomId = playerRooms.get(socket.id);
        if (!roomId) {
            return callback({ success: false, error: '未加入房间' });
        }

        const room = rooms.get(roomId);
        if (!room) {
            return callback({ success: false, error: '房间不存在' });
        }

        // 只有房主可以开始游戏
        if (socket.id !== room.hostId) {
            return callback({ success: false, error: '只有房主可以开始游戏' });
        }

        // 至少需要2名玩家
        if (room.players.length < 2) {
            return callback({ success: false, error: '至少需要2名玩家' });
        }

        // 生成统一的随机种子
        const deckSeed = Math.floor(Math.random() * 1000000);

        // 服务器生成并洗牌
        const deck = generateShuffledDeck(deckSeed);

        // 给每个玩家发7张牌
        const playerHands = {};
        room.players.forEach(player => {
            playerHands[player.id] = deck.splice(deck.length - 7, 7);
        });

        // 翻开第一张顶牌
        const topCard = deck.pop();
        const discardPile = [topCard];

        // 初始化游戏状态
        room.gameState = {
            currentPlayerId: room.players[0].id, // 第一个玩家开始
            deck: deck,
            playerHands: playerHands,
            topCard: topCard,
            discardPile: discardPile,
            // 🔧 添加玩家状态管理（AP、粉丝数、批发模式等）
            playerStates: {},
            batchPlayMode: false,
            batchColor: null
        };

        // 🔧 初始化每个玩家的状态
        room.players.forEach(player => {
            // 根据角色ID设置初始AP上限
            const maxAP = player.characterId === 4 ? 4 : 3; // 企划大师(ID=4) AP上限为4
            // 聊天达人(ID=3) 初始额外抽牌+1
            const initialExtraDraw = player.characterId === 3 ? 1 : 0;

            room.gameState.playerStates[player.id] = {
                ap: maxAP,
                maxAP: maxAP,
                tempAP: 0,
                nextTurnAPPenalty: 0,
                fans: 0,
                skillCards: {},
                skillUsageThisTurn: {},
                equipment: { red: 0, yellow: 0, green: 0 },
                hasHadFirstTurn: false, // 🔧 标记是否已经历过第一个回合（用于判断是否抽牌）
                maxHandSize: 8, // 🔧 初始手牌上限
                extraDrawCount: initialExtraDraw // 🔧 初始额外抽牌数
            };
        });

        // 🔧 关键修复：标记第一个行动的玩家已经历了第一回合
        // 这样当再次轮到他时（第二回合），hasHadFirstTurn 为 true，就会正常抽牌
        const firstPlayerId = room.gameState.currentPlayerId;
        if (room.gameState.playerStates[firstPlayerId]) {
            room.gameState.playerStates[firstPlayerId].hasHadFirstTurn = true;
            // console.log(`✅ [DEBUG] 游戏开始初始化: 标记首位玩家 ${firstPlayerId} (${room.players.find(p => p.id === firstPlayerId)?.name}) hasHadFirstTurn = true`);
            // console.log(`✅ [DEBUG] 状态检查:`, room.gameState.playerStates[firstPlayerId]);
        } else {
            console.error(`❌ [DEBUG] 找不到首位玩家 ${firstPlayerId} 的状态对象！`);
        }

        // console.log(`游戏开始 - 房间 ${roomId}，玩家:`, room.players);
        // console.log(`牌库种子: ${deckSeed}`);
        // console.log(`当前回合玩家: ${room.gameState.currentPlayerId}`);
        // console.log(`顶牌:`, topCard);

        // 向房间内所有玩家广播游戏开始
        io.in(roomId).emit('game_started', {
            playerList: room.players,
            currentPlayerId: room.gameState.currentPlayerId, // 当前回合玩家ID
            deckSeed: deckSeed,
            topCard: topCard
        });

        // 分别发送每个玩家的手牌（只发给对应玩家）
        room.players.forEach(player => {
            io.to(player.id).emit('receive_hand', {
                hand: playerHands[player.id]
            });
        });

        callback({ success: true });
    });

    // End Turn (玩家结束回合，服务器切换到下一个玩家)
    socket.on('end_turn', (callback) => {
        const roomId = playerRooms.get(socket.id);
        if (!roomId) {
            return callback({ success: false, error: '未加入房间' });
        }

        const room = rooms.get(roomId);
        if (!room || !room.gameState) {
            return callback({ success: false, error: '游戏未开始' });
        }

        // 验证是否是当前回合玩家
        if (room.gameState.currentPlayerId !== socket.id) {
            return callback({ success: false, error: '不是你的回合！' });
        }

        // 找到当前玩家在列表中的索引
        const currentIndex = room.players.findIndex(p => p.id === socket.id);

        // 计算下一个玩家索引（逆时针方向）
        const nextIndex = (currentIndex - 1 + room.players.length) % room.players.length;
        const nextPlayer = room.players[nextIndex];

        // 更新游戏状态
        room.gameState.currentPlayerId = nextPlayer.id;

        // 🔧 回合开始逻辑：为下一个玩家执行回合开始操作
        const nextPlayerState = room.gameState.playerStates[nextPlayer.id];
        if (nextPlayerState) {
            // 1. 处理 AP 惩罚（熬夜上分技能）
            const apPenalty = nextPlayerState.nextTurnAPPenalty || 0;
            nextPlayerState.nextTurnAPPenalty = 0; // 清空惩罚

            // 2. 恢复 AP（扣除惩罚）
            nextPlayerState.ap = Math.max(0, nextPlayerState.maxAP - apPenalty);
            nextPlayerState.tempAP = 0; // 清空临时 AP

            // 3. 抽牌（🔧 使用动态的抽牌数和手牌上限）
            const drawnCards = [];
            if (nextPlayerState.hasHadFirstTurn) {
                // 计算基础抽牌数 + 额外抽牌数
                const baseDraw = 3;
                const extraDraw = nextPlayerState.extraDrawCount || 0;
                const totalDraw = baseDraw + extraDraw;

                // 获取手牌上限
                const maxHandSize = nextPlayerState.maxHandSize || 8;
                const currentHandCount = room.gameState.playerHands[nextPlayer.id].length;

                // 计算实际能抽几张
                const canDraw = Math.min(totalDraw, maxHandSize - currentHandCount);

                for (let i = 0; i < canDraw; i++) {
                    if (room.gameState.deck.length > 0) {
                        const card = room.gameState.deck.pop();
                        room.gameState.playerHands[nextPlayer.id].push(card);
                        drawnCards.push(card);
                    }
                }
            } else {
                // 第一次回合：不抽牌
                nextPlayerState.hasHadFirstTurn = true;
                // console.log(`回合开始 - ${nextPlayer.name}: 第一个回合，不抽牌`);
            }

            // 4. 清空技能使用次数
            nextPlayerState.skillUsageThisTurn = {};

            // 5. 发送抽到的牌给下一个玩家（只发给他自己）
            if (drawnCards.length > 0) {
                io.to(nextPlayer.id).emit('cards_drawn_on_turn_start', {
                    cards: drawnCards
                });

                // 🔧 广播给其他玩家：更新手牌数量
                // 注意：这里发送给房间内所有人（包括 nextPlayer），但客户端会过滤掉自己的 ID
                // 使用 io.in(roomId) 确保包括当前结束回合的玩家（socket）和其他人
                io.in(roomId).emit('opponent_card_drawn', {
                    playerId: nextPlayer.id,
                    handCount: room.gameState.playerHands[nextPlayer.id].length,
                    playerState: {
                        ap: nextPlayerState.ap,
                        tempAP: nextPlayerState.tempAP,
                        maxAP: nextPlayerState.maxAP,
                        fans: nextPlayerState.fans,
                        equipment: nextPlayerState.equipment
                    }
                });
            }

            // 🔧 6. 回合开始技能牌掉落检查 (30% 概率)
            if (Math.random() < 0.3) {
                const skillId = generateRandomSkillId();

                // 更新玩家状态
                if (!nextPlayerState.skillCards[skillId]) {
                    nextPlayerState.skillCards[skillId] = 0;
                }
                nextPlayerState.skillCards[skillId] += 1;

                console.log(`[DEBUG] 回合开始掉落技能牌 - 房间 ${roomId}: 发送给 ${nextPlayer.name} (${nextPlayer.id}) 技能 ${skillId}`);
                console.log(`[DEBUG] 玩家 ${nextPlayer.name} 当前技能牌:`, nextPlayerState.skillCards);

                // 通知玩家
                io.to(nextPlayer.id).emit('skill_card_received', { skillId });
            }
        }

        // console.log(`回合切换 - 房间 ${roomId}: ${socket.id} → ${nextPlayer.id} (${nextPlayer.name})`);

        // 广播回合切换事件（携带最新状态，确保 AP 刷新）
        const nextPlayerStateObj = room.gameState.playerStates[nextPlayer.id];
        io.in(roomId).emit('turn_changed', {
            currentPlayerId: nextPlayer.id,
            playerState: {
                ap: nextPlayerStateObj.ap,
                tempAP: nextPlayerStateObj.tempAP,
                maxAP: nextPlayerStateObj.maxAP,
                fans: nextPlayerStateObj.fans,
                equipment: nextPlayerStateObj.equipment
            }
        });

        callback({ success: true, nextPlayerId: nextPlayer.id });
    });

    // 辅助函数：检查里程碑
    function checkMilestones(room, io) {
        if (!room.gameState.milestones) {
            room.gameState.milestones = { fans50k: false, fans100k: false };
        }

        // 检查所有玩家的粉丝数
        let boostLevel = 0;

        // 检查是否达到 50k
        if (!room.gameState.milestones.fans50k) {
            const has50k = room.players.some(p => {
                const state = room.gameState.playerStates[p.id];
                return state && state.fans >= 50;
            });

            if (has50k) {
                room.gameState.milestones.fans50k = true;
                boostLevel = 1;

                // 应用增益：全场抽牌+1，手牌上限+1
                Object.values(room.gameState.playerStates).forEach(state => {
                    state.extraDrawCount = (state.extraDrawCount || 0) + 1;
                    state.maxHandSize = (state.maxHandSize || 8) + 1;
                });
            }
        }

        // 检查是否达到 100k
        if (!room.gameState.milestones.fans100k) {
            const has100k = room.players.some(p => {
                const state = room.gameState.playerStates[p.id];
                return state && state.fans >= 100;
            });

            if (has100k) {
                room.gameState.milestones.fans100k = true;
                boostLevel = 2;

                // 应用增益：全场 AP+1
                Object.values(room.gameState.playerStates).forEach(state => {
                    state.maxAP += 1;
                    // 可选：立即恢复1点AP？为了平衡，暂时只增加上限，下回合生效
                });
            }
        }

        if (boostLevel > 0) {
            io.in(room.id).emit('milestone_reached', { level: boostLevel });
        }
    }

    // Draw Card (玩家摸牌，服务器从牌库抽牌并发送)
    socket.on('draw_card', (callback) => {
        const roomId = playerRooms.get(socket.id);
        if (!roomId) {
            return callback({ success: false, error: '未加入房间' });
        }

        const room = rooms.get(roomId);
        if (!room || !room.gameState) {
            return callback({ success: false, error: '游戏未开始' });
        }

        // 验证是否是当前回合玩家
        if (room.gameState.currentPlayerId !== socket.id) {
            return callback({ success: false, error: '不是你的回合！' });
        }

        const playerState = room.gameState.playerStates[socket.id];

        // 🔧 修复：检查手牌上限
        const maxHandSize = playerState.maxHandSize || 8;
        const currentHandCount = room.gameState.playerHands[socket.id] ? room.gameState.playerHands[socket.id].length : 0;
        if (currentHandCount >= maxHandSize) {
            return callback({ success: false, error: '手牌已满' });
        }

        if (!playerState) {
            return callback({ success: false, error: '玩家状态未初始化' });
        }

        const totalAP = playerState.ap + (playerState.tempAP || 0);
        if (totalAP < 1) {
            return callback({ success: false, error: '行动点不足' });
        }

        // 检查牌库是否还有牌
        if (room.gameState.deck.length === 0) {
            return callback({ success: false, error: '牌库已空' });
        }

        // 消耗 AP（优先消耗临时 AP）
        if (playerState.tempAP > 0) {
            playerState.tempAP -= 1;
        } else {
            playerState.ap -= 1;
        }

        // 从牌库抽一张牌
        const drawnCard = room.gameState.deck.pop();

        // 将牌添加到玩家手牌
        if (!room.gameState.playerHands[socket.id]) {
            room.gameState.playerHands[socket.id] = [];
        }
        room.gameState.playerHands[socket.id].push(drawnCard);

        // console.log(`玩家摸牌 - 房间 ${roomId}: ${socket.id} 摸了`, drawnCard, `剩余牌库: ${room.gameState.deck.length}, 剩余AP: ${playerState.ap}`);

        // 只发送给当前玩家（包含最新状态）
        io.to(socket.id).emit('card_drawn', {
            card: drawnCard,
            // 🔧 同步最新状态（确保 AP 刷新）
            playerState: {
                ap: playerState.ap,
                tempAP: playerState.tempAP,
                maxAP: playerState.maxAP,
                fans: playerState.fans
            }
        });

        // 广播给其他玩家（仅通知手牌数变化，不发送具体卡牌）
        socket.broadcast.to(roomId).emit('opponent_card_drawn', {
            playerId: socket.id,
            handCount: room.gameState.playerHands[socket.id].length,
            playerState: {
                ap: playerState.ap,
                tempAP: playerState.tempAP,
                maxAP: playerState.maxAP,
                fans: playerState.fans
            }
        });

        // 🔧 技能牌掉落逻辑 (30% 概率)
        if (Math.random() < 0.3) {
            const skillId = generateRandomSkillId();

            // 更新玩家状态
            if (!playerState.skillCards[skillId]) {
                playerState.skillCards[skillId] = 0;
            }
            playerState.skillCards[skillId] += 1;

            console.log(`技能牌掉落 - 房间 ${roomId}: ${socket.id} 获得 ${skillId}`);

            // 通知玩家
            io.to(socket.id).emit('skill_card_received', { skillId });
        }

        callback({ success: true, card: drawnCard });
    });

    // Play Cards (玩家出牌，服务器验证并广播)
    socket.on('play_cards', ({ cardsData }, callback) => {
        // console.log('📨 收到出牌请求:', socket.id, cardsData);

        const roomId = playerRooms.get(socket.id);
        if (!roomId) {
            return callback({ success: false, error: '未加入房间' });
        }

        const room = rooms.get(roomId);
        if (!room || !room.gameState) {
            return callback({ success: false, error: '游戏未开始' });
        }

        // 验证是否是当前回合玩家
        if (room.gameState.currentPlayerId !== socket.id) {
            return callback({ success: false, error: '不是你的回合！' });
        }

        // 获取玩家手牌
        const playerHand = room.gameState.playerHands[socket.id];
        if (!playerHand || playerHand.length === 0) {
            return callback({ success: false, error: '你没有手牌！' });
        }

        // 验证卡牌数据
        if (!cardsData || cardsData.length === 0) {
            return callback({ success: false, error: '请先选择要打出的卡牌！' });
        }

        // 获取玩家状态
        const playerState = room.gameState.playerStates[socket.id];
        if (!playerState) {
            return callback({ success: false, error: '玩家状态未初始化' });
        }

        // 🔧 关键修复：验证并消耗AP
        const totalAP = playerState.ap + (playerState.tempAP || 0);

        // 检查是否需要消耗 AP
        // 1. 如果不在批发模式，需要 AP
        // 2. 如果在批发模式但颜色不匹配（切换颜色），需要 AP
        let needsAP = !room.gameState.batchPlayMode;

        if (room.gameState.batchPlayMode) {
            const firstCardType = cardsData[0].type;
            if (firstCardType !== room.gameState.batchColor) {
                needsAP = true;
            }
        }

        if (needsAP && totalAP < 1) {
            return callback({ success: false, error: '行动点不足' });
        }

        // 🔧 根据卡牌对象（type+value）匹配并删除手牌
        const cardsToPlay = [];
        const handCopy = [...playerHand]; // 复制手牌数组避免修改原数组

        for (const cardData of cardsData) {
            const index = handCopy.findIndex(c => c.type === cardData.type && c.value === cardData.value);
            if (index === -1) {
                return callback({ success: false, error: '你没有这张手牌！' });
            }
            cardsToPlay.push(handCopy[index]);
            handCopy.splice(index, 1); // 从副本中删除，确保不会重复匹配同一张牌
        }

        // 验证出牌规则（第一张牌必须匹配顶牌）
        const firstCard = cardsToPlay[0];
        const topCard = room.gameState.topCard;

        const canPlay = firstCard.type === 'grey' || // 灰色万能牌
                       topCard.type === 'grey' ||    // 顶牌是灰色
                       firstCard.type === topCard.type || // 颜色匹配
                       firstCard.value === topCard.value; // 数字匹配

        if (!canPlay) {
            return callback({ success: false, error: '你只能打出与牌堆最上方的弃牌颜色一样或者数字一样的手牌！' });
        }

        // 🔧 修复：计算粉丝数（应用角色加成和装备加成，与单人模式一致）
        // 获取玩家角色信息
        const playerInfo = room.players.find(p => p.id === socket.id);
        const characterBonuses = {
            1: { red: -1, yellow: 1, green: 0, grey: 0 },   // 歌剧大神
            2: { red: 1, yellow: -1, green: 0, grey: 0 },   // 游戏高手
            3: { red: 0, yellow: 0, green: 1, grey: 0 },    // 聊天达人
            4: { red: 0, yellow: 0, green: 0, grey: 0 },    // 企划大师
            5: { red: 0, yellow: 0, green: 0, grey: 0 }     // 全能偶像
        };

        const bonuses = characterBonuses[playerInfo.characterId] || { red: 0, yellow: 0, green: 0, grey: 0 };
        const equipment = playerState.equipment || { red: 0, yellow: 0, green: 0 };

        const fansGained = cardsToPlay.reduce((sum, card) => {
            // 角色加成应用到卡牌数值（getFansValue逻辑）
            const bonus = bonuses[card.type] || 0;
            const cardValue = Math.ceil(card.value + bonus);

            // 装备加成（灰色牌不享受装备加成）
            const equipBonus = (card.type !== 'grey') ? (equipment[card.type] || 0) : 0;

            return sum + cardValue + equipBonus;
        }, 0);

        // 从实际手牌中删除打出的牌
        for (const cardData of cardsData) {
            const index = playerHand.findIndex(c => c.type === cardData.type && c.value === cardData.value);
            if (index !== -1) {
                playerHand.splice(index, 1);
            }
        }

        // 更新弃牌堆和顶牌
        const newTopCard = cardsToPlay[cardsToPlay.length - 1];
        room.gameState.topCard = newTopCard;
        room.gameState.discardPile.push(...cardsToPlay);

        // 🔧 修复：批发模式和AP消耗逻辑（与单人模式一致）
        const playedColor = newTopCard.type;

        if (!room.gameState.batchPlayMode) {
            // 第一次出牌：进入批发模式，消耗1 AP
            room.gameState.batchPlayMode = true;
            room.gameState.batchColor = playedColor;

            // 消耗AP（优先消耗临时AP）
            if (playerState.tempAP > 0) {
                playerState.tempAP -= 1;
                // console.log(`第一次出牌，消耗临时AP: ${playerState.tempAP + 1} → ${playerState.tempAP}`);
            } else {
                playerState.ap = Math.max(0, playerState.ap - 1);
                // console.log(`第一次出牌，消耗常规AP`);
            }
        } else {
            // 已在批发模式
            if (playedColor === room.gameState.batchColor) {
                // 颜色相同：继续批发模式，不消耗AP
                // console.log(`批发模式继续，颜色相同，不消耗AP`);
            } else {
                // 颜色不同：切换批发模式颜色，消耗1 AP
                // 原逻辑是完全退出，现在改为直接切换到新颜色，这样下一张同色牌就可以免费打出
                room.gameState.batchPlayMode = true;
                room.gameState.batchColor = playedColor;

                // 消耗AP（优先消耗临时AP）
                if (playerState.tempAP > 0) {
                    playerState.tempAP -= 1;
                    // console.log(`颜色不同，切换批发颜色，消耗临时AP: ${playerState.tempAP + 1} → ${playerState.tempAP}`);
                } else {
                    playerState.ap = Math.max(0, playerState.ap - 1);
                    // console.log(`颜色不同，切换批发颜色，消耗常规AP`);
                }
            }
        }

        // 更新玩家粉丝数
        playerState.fans = (playerState.fans || 0) + fansGained;

        // console.log(`出牌成功 - 房间 ${roomId}: ${socket.id} 打出`, cardsToPlay, `获得 ${fansGained}k 粉丝，剩余AP: ${playerState.ap}/${playerState.maxAP}，剩余手牌: ${playerHand.length}`);

        // 广播给房间内所有玩家（包含完整的玩家状态）
        io.in(roomId).emit('cards_played', {
            playerId: socket.id,
            cards: cardsToPlay,
            topCard: newTopCard,
            fansGained: fansGained,
            batchPlayMode: room.gameState.batchPlayMode,
            batchColor: room.gameState.batchColor,
            // 🔧 新增：同步剩余手牌数量
            handCount: playerHand.length,
            // 🔧 关键修复：广播出牌玩家的最新状态（AP、粉丝数等）
            playerState: {
                ap: playerState.ap,
                tempAP: playerState.tempAP,
                maxAP: playerState.maxAP,
                fans: playerState.fans
            }
        });

        // 🔧 检查里程碑（粉丝数变化后）
        checkMilestones(room, io);

        // 🔧 检查胜利条件 (150k 粉丝)
        if (playerState.fans >= 150) {
            console.log(`游戏结束 - 房间 ${roomId}: ${socket.id} (${playerInfo.name}) 获胜！`);
            io.in(roomId).emit('game_over', {
                winnerId: socket.id,
                winnerName: playerInfo.name,
                finalFans: playerState.fans
            });
        }

        callback({ success: true, fansGained });
    });

    // Use Skill Card (玩家使用技能牌，服务器执行效果)
    socket.on('use_skill_card', ({ skillId }, callback) => {
        const roomId = playerRooms.get(socket.id);
        if (!roomId) {
            return callback({ success: false, error: '未加入房间' });
        }

        const room = rooms.get(roomId);
        if (!room || !room.gameState) {
            return callback({ success: false, error: '游戏未开始' });
        }

        // 验证是否是当前回合玩家
        if (room.gameState.currentPlayerId !== socket.id) {
            return callback({ success: false, error: '不是你的回合！' });
        }

        // 初始化玩家状态（如果不存在）
        if (!room.gameState.playerStates) {
            room.gameState.playerStates = {};
        }
        if (!room.gameState.playerStates[socket.id]) {
            room.gameState.playerStates[socket.id] = {
                fans: 0,
                skillCards: {},
                skillUsageThisTurn: {}
            };
        }

        const playerState = room.gameState.playerStates[socket.id];

        // 🔧 修复：检查行动点（所有技能消耗 1 AP）
        const totalAP = playerState.ap + (playerState.tempAP || 0);
        const apCost = 1;
        if (totalAP < apCost) {
            return callback({ success: false, error: '行动点不足' });
        }

        // 🔧 修复：检查是否拥有该技能牌
        if (!playerState.skillCards[skillId] || playerState.skillCards[skillId] <= 0) {
            return callback({ success: false, error: '你没有这张技能牌！' });
        }

        // 🔧 修复：检查每回合使用次数限制（默认1次）
        const usedCount = playerState.skillUsageThisTurn[skillId] || 0;
        const limit = 1; // 目前所有技能限制为每回合1次
        if (usedCount >= limit) {
            return callback({ success: false, error: '该技能牌每回合仅限使用一次！' });
        }

        // 🔧 修复：消耗 AP（优先消耗临时 AP）
        if (playerState.tempAP > 0) {
            const deduction = Math.min(playerState.tempAP, apCost);
            playerState.tempAP -= deduction;
            const remainingCost = apCost - deduction;
            if (remainingCost > 0) {
                playerState.ap = Math.max(0, playerState.ap - remainingCost);
            }
        } else {
            playerState.ap = Math.max(0, playerState.ap - apCost);
        }

        // 🔧 修复：消耗技能牌
        playerState.skillCards[skillId] -= 1;
        if (playerState.skillCards[skillId] <= 0) {
            delete playerState.skillCards[skillId];
        }

        // 🔧 修复：记录本回合使用次数
        playerState.skillUsageThisTurn[skillId] = usedCount + 1;

        // 执行技能效果（服务器端）
        let effectResult = null;
        switch (skillId) {
            case 'HATER':
                // 小黑子：除自己外所有玩家粉丝数削减10%
                effectResult = {
                    type: 'reduce_fans',
                    targets: room.players
                        .filter(p => p.id !== socket.id)
                        .map(p => ({
                            playerId: p.id,
                            reduction: Math.floor((room.gameState.playerStates[p.id]?.fans || 0) * 0.1)
                        }))
                };

                // 应用效果
                effectResult.targets.forEach(({ playerId, reduction }) => {
                    if (room.gameState.playerStates[playerId]) {
                        room.gameState.playerStates[playerId].fans = Math.max(0,
                            (room.gameState.playerStates[playerId].fans || 0) - reduction);
                    }
                });
                break;

            case 'STAY_UP':
                // 熬夜上分：获得3点临时AP，下回合-1 AP
                // 🔧 修复：服务器端实际更新玩家状态
                playerState.tempAP = (playerState.tempAP || 0) + 3;
                playerState.nextTurnAPPenalty = (playerState.nextTurnAPPenalty || 0) + 1;

                effectResult = {
                    type: 'temp_ap',
                    playerId: socket.id,
                    tempAP: 3,
                    nextTurnPenalty: 1
                };
                break;

            default:
                return callback({ success: false, error: '未知的技能牌' });
        }

        // console.log(`技能牌使用 - 房间 ${roomId}: ${socket.id} 使用了 ${skillId}`);

        // 广播技能效果给所有玩家
        io.in(roomId).emit('skill_card_used', {
            playerId: socket.id,
            skillId: skillId,
            effect: effectResult,
            // 🔧 修复：携带最新玩家状态，确保客户端准确同步 AP（包括临时AP）
            playerState: {
                ap: playerState.ap,
                tempAP: playerState.tempAP,
                maxAP: playerState.maxAP,
                fans: playerState.fans,
                nextTurnAPPenalty: playerState.nextTurnAPPenalty
            }
        });

        callback({ success: true, effect: effectResult });
    });

    // Disconnect
    socket.on('disconnect', () => {
        // console.log('用户已断开连接:', socket.id);

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
                        // console.log(`房主已变更 - 房间 ${roomId}，新房主: ${room.hostId}`);
                    } else {
                        // Destroy room
                        rooms.delete(roomId);
                        // console.log(`房间已销毁（无玩家）- ${roomId}`);
                    }
                } else if (room.players.length === 0) {
                    rooms.delete(roomId);
                    // console.log(`房间已销毁（无玩家）- ${roomId}`);
                }
            }
            playerRooms.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`vUNO 多人游戏服务器运行在端口 ${PORT}`);
});
