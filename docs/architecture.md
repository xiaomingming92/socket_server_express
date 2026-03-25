# 📐 架构设计

本文档描述 BSD Socket 实现的系统架构设计。

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Application Layer                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │   Chat      │  │    Auth     │  │   User      │  │   Connection    │ │
│  │   Handler   │  │   Handler   │  │   Handler   │  │    Handler      │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
└─────────┼────────────────┼────────────────┼──────────────────┼──────────┘
          │                │                │                  │
          └────────────────┴────────────────┴──────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                         BSD Socket Wrapper                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │   socket()  │  │   bind()    │  │  listen()   │  │    accept()     │ │
│  │  (create)   │  │   (port)    │  │  (backlog)  │  │  (connection)   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  connect()  │  │   send()    │  │   recv()    │  │    close()      │ │
│  │  (client)   │  │   (write)   │  │   (read)    │  │   (destroy)     │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                         Protocol Layer                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │   encode    │  │   decode    │  │   codec     │  │    message      │ │
│  │  (pack)     │  │  (unpack)   │  │  (sticky)   │  │   (types)       │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                      Node.js net Module                                  │
│              createServer / createConnection / Socket                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                         TCP/IP Stack                                     │
│                    TCP / IP / Ethernet / Physical                        │
└─────────────────────────────────────────────────────────────────────────┘
```

## 分层架构

### 1. 应用层 (Application Layer)

业务逻辑处理层，包含具体的业务处理器：

- **ChatHandler**: 处理聊天消息、广播、私聊
- **ConnectionHandler**: 管理连接生命周期、心跳检测
- **AuthHandler**: JWT 认证、权限验证

### 2. BSD Socket 包装层

封装 BSD 风格的 Socket API：

- **BSDSocketServer**: 服务器端 API (socket, bind, listen, accept)
- **BSDSocket**: 连接对象 (send, recv, close, getAddress)
- **BSDSocketClient**: 客户端 API (connect, send, recv, close)

### 3. 协议层 (Protocol Layer)

自定义应用层协议：

- **ProtocolCodec**: 消息编解码器，处理粘包
- **Message Types**: 消息类型定义
- **Header Format**: 8字节消息头格式

### 4. 传输层 (Transport Layer)

Node.js 原生网络模块：

- **net.createServer**: 创建 TCP 服务器
- **net.createConnection**: 创建 TCP 连接
- **Socket**: 双工流接口

## 数据流

### 服务器端数据流

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Client │────▶│    TCP      │────▶│   Protocol  │────▶│    BSD      │
│  Data   │     │   Socket    │     │    Codec    │     │   Socket    │
└─────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                 │
┌─────────┐     ┌─────────────┐     ┌─────────────┐           │
│  Client │◀────│    TCP      │◀────│   Protocol  │◀──────────┘
│  Data   │     │   Socket    │     │   Encoder   │
└─────────┘     └─────────────┘     └─────────────┘
```

### 客户端数据流

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────┐
│  Application│────▶│    BSD      │────▶│   Protocol  │────▶│   TCP   │
│    Data     │     │   Socket    │     │   Encoder   │     │  Socket │
└─────────────┘     └─────────────┘     └─────────────┘     └────┬────┘
                                                                  │
┌─────────────┐     ┌─────────────┐     ┌─────────────┐          │
│  Application│◀────│    BSD      │◀────│   Protocol  │◀─────────┘
│    Data     │     │   Socket    │     │    Codec    │
└─────────────┘     └─────────────┘     └─────────────┘
```

## 模块依赖关系

```
                    ┌─────────────────┐
                    │   bsd_server    │
                    │   (entry)       │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  ChatHandler  │    │ConnectionHandler│   │  BSDSocketServer│
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    BSDSocket    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  ProtocolCodec  │
                    │  (protocol.ts)  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   Node.js net   │
                    └─────────────────┘
```

## 设计模式

### 1. 观察者模式 (Observer)

使用 EventEmitter 实现事件驱动：

```typescript
// 服务器事件
server.on('connection', (socket) => { ... });
server.on('message', ({ socket, message }) => { ... });
server.on('disconnect', ({ socketId }) => { ... });

// Socket 事件
socket.onData((message) => { ... });
socket.on('close', () => { ... });
socket.on('error', (err) => { ... });
```

### 2. 策略模式 (Strategy)

消息处理使用策略模式：

```typescript
switch (message.type) {
  case MessageType.CHAT:
    return this.handleChat(connection, message);
  case MessageType.AUTH:
    return this.handleAuth(connection, message);
  case MessageType.HEARTBEAT:
    return this.handleHeartbeat(connection, message);
}
```

### 3. 工厂模式 (Factory)

消息创建使用工厂函数：

```typescript
const chatMsg = createChatMessage(from, content, to);
const authMsg = createAuthMessage(token);
const heartbeatMsg = createHeartbeatMessage();
```

## 状态管理

### 连接状态

```
┌─────────┐    connect     ┌─────────┐    auth      ┌─────────┐
│  IDLE   │ ─────────────▶ │ CONNECTED│ ──────────▶ │AUTHENTICATED│
└─────────┘                └─────────┘              └─────────┘
     │                          │                        │
     │                          │                        │
     │                    close │                   close │
     │                          ▼                        ▼
     │                     ┌─────────┐              ┌─────────┐
     └────────────────────▶│  CLOSED │◀─────────────│  CLOSED │
                           └─────────┘              └─────────┘
```

## 扩展性设计

### 1. 中间件机制 (预留)

```typescript
server.use((socket, next) => {
  // 前置处理
  next();
});
```

### 2. 插件系统 (预留)

```typescript
interface Plugin {
  name: string;
  install(server: BSDSocketServer): void;
}

server.use(plugin);
```

### 3. 集群支持 (预留)

```typescript
// 使用 Node.js cluster 模块
if (cluster.isPrimary) {
  // 主进程 fork 工作进程
} else {
  // 工作进程启动服务器
}
```

## 安全设计

### 1. 连接限制

- 最大连接数限制 (maxConnections)
- 单 IP 连接数限制
- 连接速率限制

### 2. 认证机制

- JWT Token 验证
- Token 过期处理
- 认证失败断开连接

### 3. 数据验证

- 消息长度限制 (10MB)
- JSON 格式验证
- 特殊字符过滤

## 监控设计

### 1. 指标收集

- 连接数统计
- 消息吞吐量
- 错误率统计
- 延迟统计

### 2. 日志记录

```typescript
console.log(`[Server] 新连接: ${socketId}`);
console.log(`[Chat] 收到消息: ${from}: ${content}`);
console.error(`[Error] 处理失败: ${error.message}`);
```
