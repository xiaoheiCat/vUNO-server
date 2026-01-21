# vUNO Signaling Server

这是 [vUNO](https://github.com/xiaoheiCat/vUNO) 游戏的配套多人游戏服务器。

它的主要作用是协助玩家客户端之间建立 WebRTC P2P 连接，并管理多人游戏房间的状态。游戏本身的数据传输主要通过 P2P 进行，服务器仅负责“握手”和基本的房间人员管理。

## ✨ 功能特性

*   **房间管理**：创建房间、加入房间、房间人员状态同步。
*   **信令转发**：在玩家之间转发 WebRTC 的 Offer、Answer 和 ICE Candidates。
*   **跨平台**：支持 Windows、macOS 和 Linux。
*   **轻量级**：基于 Node.js 和 Socket.IO 构建，资源占用低。
*   **便携式**：提供单文件可执行程序，无需配置 Node.js 环境即可运行。

## 🚀 用户使用指南 (如何部署)

如果你希望搭建自己的 vUNO 游戏服务器，或者在局域网内与朋友联机，可以使用以下两种方式：

### 方式一：运行可执行文件 (推荐)

我们利用 Nexe 将服务器打包成了独立的可执行文件，无需安装任何环境。

1.  前往 [Actions](https://github.com/xiaoheiCat/vUNO-server/actions) 页面下载对应系统的最新版本：
    *   Windows: `vuno-server-win-x64.exe`
    *   macOS: `vuno-server-mac-arm64` (Apple Silicon)
    *   Linux: `vuno-server-linux-x64` / `vuno-server-linux-arm64`
2.  直接双击或在终端运行该文件。
3.  看到 `Signaling server running on port 3001` 即表示启动成功。
4.  在 vUNO 游戏客户端中，将服务器地址配置为 `http://你的IP地址:3001`。

### 方式二：源码运行

如果你熟悉 Node.js，也可以通过源码运行：

1.  确保已安装 [Node.js](https://nodejs.org/) (推荐 v16+)。
2.  克隆本仓库或下载源码。
3.  安装依赖：
    ```bash
    npm install
    # 或者
    pnpm install
    ```
4.  启动服务器：
    ```bash
    npm start
    ```

### 配置端口

默认端口为 **3001**。如果需要修改端口，可以设置环境变量 `PORT`。

**Windows (CMD):**
```cmd
set PORT=8080 && vuno-server-win-x64.exe
```

**Linux/macOS:**
```bash
PORT=8080 ./vuno-server-linux-x64
```

## 🛠️ 开发者指南

### 环境搭建

```bash
# 安装依赖
npm install

# 启动开发服务器 (支持热重载)
npm run dev
```

### 构建二进制文件

本项目使用 Nexe 打包。你可以手动构建特定平台的版本：

```bash
# 安装 Nexe (如果你没有全局安装)
npm install -g nexe

# 构建 Windows x64
nexe . -t windows-x64 -o dist/vuno-server-win.exe

# 构建 Linux x64
nexe . -t linux-x64 -o dist/vuno-server-linux
```

或者直接使用我们配置好的 GitHub Actions 工作流，推送到仓库即可自动构建所有平台版本。

### API 文档 (Socket.IO 事件)

服务器监听以下事件：

| 事件名 | 参数 | 描述 |
|--------|------|------|
| `create_room` | `{ playerName, maxPlayers }` | 创建新房间。返回 `{ success, roomId }`。 |
| `join_room` | `{ roomId, playerName }` | 加入现有房间。成功后触发房主端的 `player_joined` 事件。 |
| `signal` | `{ targetId, type, payload }` | 转发 WebRTC 信令数据给目标玩家 `targetId`。 |
| `disconnect` | 无 | 玩家断开连接，服务器会自动清理房间并通知其他玩家。 |

服务器发送给客户端的事件：

| 事件名 | 参数 | 描述 |
|--------|------|------|
| `player_joined` | `{ playerId, playerName }` | 通知房主有新玩家加入，需要发起 WebRTC 连接。 |
| `player_left` | `{ playerId }` | 通知房间内其他玩家有人离开。 |
| `signal` | `{ senderId, type, payload }` | 接收来自其他玩家的 WebRTC 信令数据。 |

## 🤝 贡献

欢迎提交 Issue 或 Pull Request 来改进服务器的稳定性和功能！

## 📄 许可证

MIT License
