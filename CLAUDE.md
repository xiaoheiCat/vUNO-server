# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

- **启动服务器**: `npm start` (运行 `node index.js`)
- **开发模式**: `npm run dev` (使用 `nodemon` 运行，支持热重载)
- **安装依赖**: `npm install` 或 `pnpm install`

## 架构与代码结构

**项目概览**
本项目是 vUNO 游戏的多人游戏服务器 (Multiplayer Server)。它基于 Node.js、Express 和 Socket.IO 构建。
**关键变更**：为了提高连接稳定性，本项目已从单纯的 WebRTC 信令服务器转型为**游戏数据中继服务器**。它不仅管理房间，还负责转发所有游戏内的操作数据（出牌、同步状态等），不再依赖客户端 P2P 连接。

**核心组件**
- **入口文件** (`index.js`): 初始化 HTTP 服务器和 Socket.IO 实例，配置 CORS。
- **房间管理**: 使用内存中的 `Map` 对象 (`rooms`) 存储活跃的游戏房间信息。
  - **房间结构**: 包含房间 ID (`roomId`)、房主 ID (`hostId`)、玩家列表 (`players`) 和最大人数限制。

**通信机制**
- **基础事件**:
  - `create_room`: 创建新房间，生成唯一 ID，将请求者设为房主。
  - `join_room`: 验证房间存在且未满后加入玩家，通知房间内所有人 (`player_joined`, `player_joined_broadcast`)。
  - `disconnect`: 处理玩家断开连接，从房间移除玩家。**新增**：如果房主断开，自动将房主权限移交给下一位玩家 (`host_changed`)。

- **游戏数据转发 (核心)**:
  - `broadcast_game_event`: 客户端发送此事件，服务器将其广播给房间内除发送者外的所有其他玩家。用于：出牌、摸牌、技能使用、房间状态同步。
  - `send_game_event`: 客户端发送此事件，服务器将其转发给指定的目标玩家 (`targetId`)。用于：点对点私信同步。
  - `game_event`: 客户端监听此事件，接收来自服务器转发的游戏数据。

**技术栈**
- **Runtime**: Node.js
- **Web 框架**: Express
- **实时通信**: Socket.IO (配置了允许所有来源跨域 `origin: "*"`)
