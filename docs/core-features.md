# ⚙️ 核心功能

本文档详细描述 BSD Socket 实现的核心功能模块。

## 目录

- [协议层 (Protocol Layer)](#协议层-protocol-layer)
- [Socket 连接 (BSDSocket)](#socket-连接-bsdsocket)
- [服务器 (BSDSocketServer)](#服务器-bsdsocketserver)
- [客户端 (BSDSocketClient)](#客户端-bsdsocketclient)
- [连接管理 (ConnectionHandler)](#连接管理-connectionhandler)
- [聊天处理 (ChatHandler)](#聊天处理-chathandler)

## 协议层 (Protocol Layer)

### 文件位置

`src/bsd/protocol.ts`

### 核心类/函数

#### MessageType 枚举

```typescript
enum MessageType {
  CONNECT = 0x01,      // 连接请求
  CONNECT_ACK = 0x02,  // 连接响应
  CHAT = 0x03,         // 聊天消息
  HEARTBEAT = 0x04,    // 心跳包
  DISCONNECT = 0x05,   // 断开连接
  AUTH = 0x06,         // 认证消息
  AUTH_ACK = 0x07,     // 认证响应
  ERROR = 0x08,        // 错误消息
}
```

#### ProtocolCodec 类

消息编解码器，处理粘包问题。

```typescript
class ProtocolCodec {
  private buffer: Buffer = Buffer.alloc(0);

  // 追加数据到缓冲区
  append(data: Buffer): void

  // 尝试解码一条消息
  decodeOne(): Message | null

  // 解码所有可用的消息
  decodeAll(): Message[]

  // 清空缓冲区
  clear(): void

  // 获取当前缓冲区大小
  getBufferSize(): number
}
```

#### 便捷函数

```typescript
// 创建各类消息
function createConnectMessage(token?: string): Buffer
function createConnectAckMessage(success: boolean, message?: string): Buffer
function createChatMessage(from: string, content: string, to?: string): Buffer
function createHeartbeatMessage(): Buffer
function createDisconnectMessage(reason?: string): Buffer
function createAuthMessage(token: string): Buffer
function createAuthAckMessage(success: boolean, user?: any): Buffer
function createErrorMessage(code: number, message: string): Buffer
```

### 使用示例

```typescript
import { ProtocolCodec, createChatMessage, decodeMessage } from './bsd/protocol';

const codec = new ProtocolCodec();

// 编码消息
const message = createChatMessage('张三', '大家好！');

// 模拟接收数据 (可能包含多个消息)
const receivedData = Buffer.concat([message, message]);

// 解码消息
codec.append(receivedData);
const messages = codec.decodeAll();

messages.forEach(msg => {
  console.log(msg.type);  // MessageType.CHAT
  console.log(msg.body);  // { from: '张三', content: '大家好！', ... }
});
```

## Socket 连接 (BSDSocket)

### 文件位置

`src/bsd/socket.ts`

### 类定义

```typescript
class BSDSocket extends EventEmitter {
  constructor(socket: NetSocket)

  // BSD 风格 API
  send(data: Buffer | string): Promise<void>
  onData(callback: (data: Message) => void): void
  close(): Promise<void>
  getRemoteAddress(): { address: string; port: number }
  getLocalAddress(): { address: string; port: number }

  // 扩展功能
  sendMessage(message: Buffer): Promise<void>
  destroy(): void
  getId(): string
  isConnected(): boolean
  setUser(user: any): void
  getUser(): any
  getLastActivity(): number
  isTimeout(timeoutMs: number): boolean
  setKeepAlive(enable: boolean, initialDelay?: number): void
  setTimeout(timeout: number): void
}
```

### 事件

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `message` | `Message` | 收到消息 |
| `close` | `boolean` | 连接关闭 (hadError) |
| `error` | `Error` | 发生错误 |
| `end` | - | 连接结束 |

### 使用示例

```typescript
import { BSDSocket } from './bsd/socket';

// BSDSocket 通常由 BSDSocketServer 创建
server.onConnection((socket: BSDSocket) => {
  console.log('新连接:', socket.getRemoteAddress());

  // 监听消息
  socket.onData((message) => {
    console.log('收到消息:', message);
  });

  // 监听断开
  socket.on('close', (hadError) => {
    console.log('连接断开:', hadError);
  });

  // 发送消息
  socket.send('Hello Client!').catch(console.error);
});
```

## 服务器 (BSDSocketServer)

### 文件位置

`src/bsd/server.ts`

### 类定义

```typescript
interface ServerOptions {
  port: number;
  host?: string;
  backlog?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  maxConnections?: number;
}

class BSDSocketServer extends EventEmitter {
  constructor(options: ServerOptions)

  // BSD 风格 API
  createAndBind(): Promise<void>
  listen(): Promise<void>
  onConnection(callback: (socket: BSDSocket) => void): void
  close(): Promise<void>

  // 扩展功能
  broadcast(data: Buffer | string, excludeSocketId?: string): void
  broadcastMessage(message: Buffer, excludeSocketId?: string): void
  getConnection(socketId: string): BSDSocket | undefined
  getAllConnections(): BSDSocket[]
  getConnectionCount(): number
  isRunning(): boolean
  getAddress(): { address: string; port: number }
}
```

### 事件

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `listening` | `{ address, port }` | 开始监听 |
| `ready` | - | 服务器就绪 |
| `connection` | `BSDSocket` | 新连接 |
| `message` | `{ socket, message }` | 收到消息 |
| `disconnect` | `{ socketId, hadError }` | 连接断开 |
| `timeout` | `{ socketId }` | 连接超时 |
| `reject` | `{ reason }` | 连接被拒绝 |
| `error` | `Error` | 发生错误 |
| `close` | - | 服务器关闭 |

### 使用示例

```typescript
import { BSDSocketServer } from './bsd/server';

const server = new BSDSocketServer({
  port: 3001,
  host: '0.0.0.0',
  maxConnections: 1000
});

// 监听连接
server.onConnection((socket) => {
  console.log('新连接:', socket.getId());

  socket.onData((message) => {
    // 广播给所有客户端
    server.broadcast(JSON.stringify(message));
  });
});

// 启动服务器
await server.createAndBind();
await server.listen();

console.log('服务器运行在端口 3001');
```

## 客户端 (BSDSocketClient)

### 文件位置

`src/bsd/client.ts`

### 类定义

```typescript
interface ClientOptions {
  host: string;
  port: number;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

class BSDSocketClient extends EventEmitter {
  constructor(options: ClientOptions)

  // BSD 风格 API
  connect(token?: string): Promise<void>
  send(data: Buffer | string): Promise<void>
  onData(callback: (data: Message) => void): void
  close(): Promise<void>

  // 扩展功能
  sendMessage(message: Buffer): Promise<void>
  sendChatMessage(content: string, to?: string): Promise<void>
  authenticate(token: string): Promise<void>
  destroy(): void
  isConnected(): boolean
  getRemoteAddress(): { address: string; port: number }
  getLocalAddress(): { address: string; port: number }
}
```

### 事件

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `connect` | - | 连接成功 |
| `connect_ack` | `any` | 收到连接响应 |
| `message` | `Message` | 收到消息 |
| `chat` | `any` | 收到聊天消息 |
| `auth_ack` | `any` | 收到认证响应 |
| `heartbeat` | `any` | 收到心跳 |
| `server_error` | `any` | 收到服务器错误 |
| `disconnect_notice` | `any` | 收到断开通知 |
| `close` | `boolean` | 连接关闭 |
| `error` | `Error` | 发生错误 |
| `end` | - | 连接结束 |

### 使用示例

```typescript
import { BSDSocketClient } from './bsd/client';

const client = new BSDSocketClient({
  host: 'localhost',
  port: 3001,
  reconnect: true
});

// 监听事件
client.on('connect', () => {
  console.log('已连接到服务器');
});

client.on('chat', (body) => {
  console.log(`${body.from}: ${body.content}`);
});

// 连接并认证
await client.connect();
await client.authenticate('your-jwt-token');

// 发送消息
await client.sendChatMessage('Hello everyone!');
```

## 连接管理 (ConnectionHandler)

### 文件位置

`src/handlers/connection.handler.ts`

### 类定义

```typescript
interface ConnectionInfo {
  socket: BSDSocket;
  id: string;
  connectedAt: number;
  lastHeartbeat: number;
  user: any | null;
  isAuthenticated: boolean;
}

class ConnectionHandler {
  constructor(options?: { heartbeatInterval?: number; heartbeatTimeout?: number })

  // 连接管理
  addConnection(socket: BSDSocket): ConnectionInfo
  removeConnection(id: string): boolean
  getConnection(id: string): ConnectionInfo | undefined
  getAllConnections(): ConnectionInfo[]
  getAuthenticatedConnections(): ConnectionInfo[]
  getConnectionCount(): number

  // 广播
  broadcast(data: Buffer | string, excludeConnectionId?: string): void
  broadcastToAuthenticated(data: Buffer | string, excludeConnectionId?: string): void

  // 用户管理
  setUser(connectionId: string, user: any): boolean

  // 心跳检测
  startHeartbeatCheck(): void
  stopHeartbeatCheck(): void
  closeAll(): Promise<void>
}
```

### 使用示例

```typescript
import { ConnectionHandler } from './handlers/connection.handler';

const connectionHandler = new ConnectionHandler({
  heartbeatInterval: 30000,
  heartbeatTimeout: 60000
});

// 添加连接
server.onConnection((socket) => {
  const connectionInfo = connectionHandler.addConnection(socket);
  console.log(`新连接: ${connectionInfo.id}`);
});

// 启动心跳检测
connectionHandler.startHeartbeatCheck();

// 广播给所有已认证用户
connectionHandler.broadcastToAuthenticated(
  createChatMessage('系统', '欢迎消息')
);
```

## 聊天处理 (ChatHandler)

### 文件位置

`src/handlers/chat.handler.ts`

### 类定义

```typescript
interface ChatMessageData {
  from: string;
  content: string;
  to?: string;
  timestamp: number;
}

class ChatHandler {
  constructor(connectionHandler: ConnectionHandler)

  // 消息处理
  handleMessage(connectionId: string, message: Message): void

  // 系统消息
  sendSystemMessage(content: string, toConnectionId?: string): void

  // 用户通知
  notifyUserJoined(userName: string): void
  notifyUserLeft(userName: string): void

  // 在线用户
  getOnlineUsers(): Array<{ id: string; userName: string }>
}
```

### 消息处理流程

```
收到消息
    │
    ▼
┌─────────────────┐
│  handleMessage  │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
  CHAT       AUTH
    │         │
    ▼         ▼
┌─────────┐ ┌─────────┐
│handleChat│ │handleAuth│
└────┬────┘ └────┬────┘
     │           │
     ▼           ▼
  广播消息    验证Token
```

### 使用示例

```typescript
import { ChatHandler } from './handlers/chat.handler';
import { ConnectionHandler } from './handlers/connection.handler';

const connectionHandler = new ConnectionHandler();
const chatHandler = new ChatHandler(connectionHandler);

// 处理消息
socket.onData((message) => {
  chatHandler.handleMessage(connectionInfo.id, message);
});

// 用户加入通知
chatHandler.notifyUserJoined('张三');

// 获取在线用户列表
const onlineUsers = chatHandler.getOnlineUsers();
console.log('在线用户:', onlineUsers);
```

## 功能对比表

| 功能 | Socket.IO | BSD Socket 实现 |
|------|-----------|-----------------|
| 自动重连 | ✅ 内置 | ✅ 客户端支持 |
| 心跳检测 | ✅ 内置 | ✅ 双方支持 |
| 房间/命名空间 | ✅ 内置 | ❌ 需手动实现 |
| 广播 | ✅ 内置 | ✅ 服务器支持 |
| 私聊 | ❌ 需实现 | ✅ 支持 |
| 二进制消息 | ✅ 支持 | ✅ 原生支持 |
| 压缩 | ✅ 支持 | ❌ 需手动添加 |
| 多节点 | ✅ 支持 | ❌ 需手动实现 |
| 学习价值 | 低 | **高** |
| 可控性 | 低 | **高** |
