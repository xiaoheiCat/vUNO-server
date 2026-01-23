# vUNO Multiplayer Server

这是 [vUNO](https://github.com/xiaoheiCat/vUNO) 游戏的配套多人游戏服务器。

它负责管理多人游戏房间状态，并作为**中心节点转发所有游戏数据**。为了保证连接的稳定性和穿透性，我们已从纯 P2P 架构迁移为 **Socket.IO 服务器转发架构**。

## ✨ 功能特性

*   **房间管理**：创建房间、加入房间、房间人员状态同步。
*   **数据中继**：实时转发玩家的出牌、摸牌、技能使用等游戏操作。
*   **房主迁移**：房主断线后，自动将房主权限移交给下一位玩家，确保游戏继续。
*   **跨平台**：支持 Windows、macOS 和 Linux。
*   **轻量级**：基于 Node.js 和 Socket.IO 构建。
*   **便携式**：提供单文件可执行程序，无需配置 Node.js 环境即可运行。

## 🌍 公共服务器

如果你只是普通玩家，没有能力搭建自己的 vUNO 游戏服务器，也可以使用我们或者其他人提供的公共服务器。

**请注意:** 我们不对公共服务器的可靠性和安全性负责。如果您有能力，强烈建议搭建自己的服务器。

### 公共服务器列表

| 提供方 | 服务器地址 | 端口 | 使用 SSL? | 描述 |
| --- | --- | --- | --- | --- | 
| vUNO 项目开发组 | `vuno-public.preview.huawei-zeabur.cn` | `443` | ✓ | 来自 vUNO 项目开发组提供的公共服务器，用爱发电，随时可能停止服务。 |


## 🚀 用户使用指南 (如何部署)

如果你希望搭建自己的 vUNO 游戏服务器，或者在局域网内与朋友联机，可以使用以下两种方式：

### 方式一：运行可执行文件 (推荐)

我们利用 Pkg 将服务器打包成了独立的可执行文件，无需安装任何环境。

1.  使用 [Nightly.link](https://nightly.link/xiaoheiCat/vUNO-server/workflows/nexe-build/main/vuno-server-binaries.zip) 下载并解压对应系统的最新构建版本：
    *   Windows: `vuno-server-win-x64.exe`
    *   macOS: `vuno-server-mac-arm64` (仅 Apple Silicon 可用)
    *   Linux: `vuno-server-linux-x64` / `vuno-server-linux-arm64`
2.  直接双击或在终端运行该文件。
3.  看到 `vUNO 多人游戏服务器运行在端口 3001` 即表示启动成功。
4.  在 vUNO 游戏客户端中，点击「服务器设置」，填入服务器地址（例如局域网 IP `http://192.168.x.x` 端口 `3001`）。

### 方式二：源码运行

如果你熟悉 Node.js，也可以通过源码运行：

1.  确保已安装 [Node.js](https://nodejs.org/) (推荐 v16+)。
2.  克隆本仓库或下载源码。
3.  进入 `server` 目录并安装依赖：
    ```bash
    cd server
    pnpm install  # 我们使用 pnpm 作为包管理器，如果您没有，请先执行 npm i -g pnpm 安装它。
    ```
4.  启动服务器：
    ```bash
    pnpm start
    ```

### 方式三：Docker 部署 (容器化)

如果你习惯使用 Docker，我们也提供了容器化部署支持：

**使用 Docker Compose (推荐)**

1.  确保已安装 [Docker](https://www.docker.com/) 和 Docker Compose。
2.  下载本仓库中的 `docker-compose.yml`。
3.  运行启动命令：
    ```bash
    docker-compose up -d
    ```

**使用 Docker Build**

1.  构建镜像：
    ```bash
    docker build -t vuno-server .
    ```
2.  运行容器：
    ```bash
    docker run -d -p 3001:3001 --name vuno-server vuno-server
    ```

### 配置端口

默认端口为 **3001**。如果需要修改端口，可以设置环境变量 `PORT`。

**Windows (CMD):**
```cmd
set PORT=8080 && npm start
```

**Linux/macOS:**
```bash
PORT=8080 npm start
```

## 🛠️ 开发者指南

### 核心事件 (Socket.IO)

服务器监听以下事件：

| 事件名 | 参数 | 描述 |
|--------|------|------|
| `create_room` | `{ playerName, maxPlayers }` | 创建新房间。返回 `{ success, roomId }`。 |
| `join_room` | `{ roomId, playerName }` | 加入现有房间。成功后触发广播。 |
| `broadcast_game_event` | `data` | 向房间内除发送者外的所有人广播游戏数据。 |
| `send_game_event` | `{ targetId, data }` | 向指定玩家发送游戏数据（如私信）。 |
| `disconnect` | 无 | 玩家断开连接，服务器会自动清理并处理房主迁移。 |

服务器发送给客户端的事件：

| 事件名 | 参数 | 描述 |
|--------|------|------|
| `player_joined` | `{ playerId, playerName }` | 通知房主有新玩家加入。 |
| `player_joined_broadcast` | `{ playerId, playerName }` | 通知房间内其他玩家有新玩家加入。 |
| `game_event` | `{ senderId, payload }` | 接收来自其他玩家的游戏数据（操作、状态同步等）。 |
| `player_left` | `{ playerId }` | 通知房间内其他玩家有人离开。 |
| `you_are_host` | 无 | 通知当前玩家已成为新房主。 |
| `host_changed` | `{ newHostId }` | 通知房间内所有玩家房主已变更。 |

## 🤝 贡献

欢迎提交 Issue 或 Pull Request 来改进服务器的稳定性和功能！

## 📄 许可证

MIT License
