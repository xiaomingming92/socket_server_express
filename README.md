# Socket Server Express

这个项目由浅入深，从基础的 Socket.IO npm 库的使用，逐步过渡到手动实现 BSD 风格的 Socket API。

## 项目分支

| 分支 | 描述 | 技术栈 |
|------|------|--------|
| `main` | 基础版本，商用标准的 Socket 服务 | Express + Socket.IO + Prisma |
| `feature/websocket-v1` | 改用 ws 库实现 WebSocket 通信 | Express + ws + Prisma |
| `feature/bsd-socket-v1` | **手动实现 BSD 风格 Socket API** | Express + 原生 TCP (net) + Prisma |

## 快速开始

### 安装依赖
```bash
npm install
```

### 启动服务

```bash
# 启动 HTTP API 服务器 (端口 1992)
npm run starthttp

# 启动 Socket.IO 服务器 (端口 3000)
npm run startsocket

# 启动 BSD Socket 服务器 (端口 3001)
npm run startbsd
```

## 文档导航

- [📐 架构设计](./docs/architecture.md) - 系统整体架构设计
- [🔧 技术方案](./docs/technical-solution.md) - BSD Socket 技术实现方案
- [⚙️ 核心功能](./docs/core-features.md) - 核心功能模块详解
- [📖 使用示例](./docs/examples.md) - 代码使用示例
- [🔌 BSD Socket API](./docs/bsd-socket-api.md) - BSD 风格 API 文档

## 项目结构

```
socket_server_express/
├── docs/                       # 文档目录
│   ├── architecture.md         # 架构设计
│   ├── technical-solution.md   # 技术方案
│   ├── core-features.md        # 核心功能
│   ├── examples.md             # 使用示例
│   └── bsd-socket-api.md       # BSD Socket API 文档
├── spec/                       # 规格文档 (Spec 模式)
│   ├── spec.md
│   ├── tasks.md
│   └── checklist.md
├── src/
│   ├── bsd/                    # BSD Socket 实现
│   │   ├── protocol.ts         # 协议层 (编解码)
│   │   ├── socket.ts           # Socket 连接类
│   │   ├── server.ts           # Socket 服务器
│   │   ├── client.ts           # Socket 客户端
│   │   └── index.ts            # 模块导出
│   ├── handlers/               # 业务处理器
│   │   ├── connection.handler.ts
│   │   └── chat.handler.ts
│   ├── sockets/                # Socket.IO 处理器 (main 分支)
│   ├── routes/                 # HTTP 路由
│   ├── controllers/            # 控制器
│   ├── services/               # 业务逻辑
│   ├── middlewares/            # 中间件
│   ├── utils/                  # 工具函数
│   ├── bsd_server.ts           # BSD Socket 入口
│   ├── socket_server.ts        # Socket.IO 入口
│   └── server.ts               # HTTP 服务器入口
├── prisma/
│   └── schema.prisma           # 数据库模型
└── package.json
```

## BSD Socket 实现亮点

### 🎯 核心特性
- **零依赖**: 仅使用 Node.js 原生 `net` 模块
- **自定义协议**: 二进制消息格式 (8字节头 + JSON 体)
- **粘包处理**: 基于长度字段的粘包解决方案
- **心跳机制**: 自动检测连接活性
- **JWT 认证**: 完整的用户认证流程
- **广播/私聊**: 支持群聊和点对点消息

### 📊 性能对比

| 指标 | Socket.IO | BSD Socket |
|------|-----------|------------|
| 协议开销 | 高 (HTTP + WebSocket) | 低 (8字节 + JSON) |
| 依赖数量 | 多 | 零 (仅 net) |
| 学习价值 | 低 | **高** |
| 可控性 | 低 | **高** |

## 技术栈

- **Runtime**: Node.js + TypeScript
- **Web Framework**: Express 5.x
- **Socket (main)**: Socket.IO 4.x
- **Socket (bsd)**: 原生 TCP (net)
- **ORM**: Prisma 6.x
- **Database**: PostgreSQL
- **Auth**: JWT

## 开发规范

- 代码风格参照 **Java Spring Boot** 分层架构
- Controller → Service → Repository 分层清晰
- 完整的 TypeScript 类型定义
- 统一的错误处理和日志记录

## 许可证

ISC
