# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

- **启动服务器**: `npm start` (运行 `node index.js`)
- **开发模式**: `npm run dev` (使用 `nodemon` 运行，支持热重载)
- **安装依赖**: `npm install` 或 `pnpm install`

## 架构与代码结构

**项目概览**
本项目是 vUNO 游戏的多人游戏信令服务器 (Signaling Server)。它基于 Node.js、Express 和 Socket.IO 构建，主要用于协助客户端建立 WebRTC P2P 连接以及管理房间状态。

**核心组件**
- **入口文件** (`index.js`): 初始化 HTTP 服务器和 Socket.IO 实例，配置 CORS。
- **房间管理**: 使用内存中的 `Map` 对象 (`rooms`) 存储活跃的游戏房间信息。
  - **房间结构**: 包含房间 ID (`roomId`)、房主 ID (`hostId`)、玩家列表 (`players`) 和最大人数限制。

**通信机制**
- **Socket.IO 事件**:
  - `create_room`: 创建新房间，生成唯一 ID，将请求者设为房主。
  - `join_room`: 验证房间存在且未满后加入玩家，并向房主发送 `player_joined` 通知以触发 WebRTC 连接流程。
  - `signal`: 转发 WebRTC 信令数据（如 offer, answer, ICE candidate），实现点对点连接握手。
  - `disconnect`: 处理玩家断开连接，从房间移除玩家并通知房间内其他成员 (`player_left`)，若房间为空则销毁。

**技术栈**
- **Runtime**: Node.js
- **Web 框架**: Express
- **实时通信**: Socket.IO (配置了允许所有来源跨域 `origin: "*"`)
