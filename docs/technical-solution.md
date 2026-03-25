# 🔧 技术方案

本文档详细描述 BSD Socket 实现的技术方案。

## 目录

- [BSD Socket API 概述](#bsd-socket-api-概述)
- [协议设计](#协议设计)
- [粘包处理方案](#粘包处理方案)
- [心跳机制](#心跳机制)
- [认证方案](#认证方案)

## BSD Socket API 概述

### 什么是 BSD Socket API

BSD Socket API 是 Unix/Linux 系统中标准的网络编程接口，由 Berkeley Software Distribution (BSD) 开发，成为事实上的标准。

### 核心函数映射

| BSD 标准函数 | Node.js net 对应 | 我们的实现 |
|-------------|------------------|-----------|
| `socket()` | `new Socket()` | `new BSDSocket()` |
| `bind()` | `server.listen()` | `server.createAndBind()` |
| `listen()` | `server.listen()` | `server.listen()` |
| `accept()` | `server.on('connection')` | `server.onConnection()` |
| `connect()` | `socket.connect()` | `client.connect()` |
| `send()` | `socket.write()` | `socket.send()` |
| `recv()` | `socket.on('data')` | `socket.onData()` |
| `close()` | `socket.end()` | `socket.close()` |

### 类图

```
┌─────────────────────┐
│   BSDSocketServer   │
├─────────────────────┤
│ - server: NetServer │
│ - connections: Map  │
│ - options: Options  │
├─────────────────────┤
│ + createAndBind()   │
│ + listen()          │
│ + onConnection()    │
│ + broadcast()       │
│ + close()           │
└─────────┬───────────┘
          │ 1:N
          ▼
┌─────────────────────┐
│     BSDSocket       │
├─────────────────────┤
│ - socket: NetSocket │
│ - codec: ProtocolCodec│
│ - id: string        │
│ - user: any         │
├─────────────────────┤
│ + send()            │
│ + onData()          │
│ + close()           │
│ + getRemoteAddress()│
└─────────────────────┘
```

## 协议设计

### 消息格式

采用固定头部 + 变长体的二进制协议：

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
├───────────────────────────────────────────────────────────────┤
│  消息类型 (1B)  │              消息长度 (4B)                   │
├───────────────┼───────────────────────────────────────────────┤
│           消息长度 (续)         │ 保留 (3B) │                   │
├───────────────────────────────┴───────────┴───────────────────┤
│                                                               │
│                         消息体 (JSON)                          │
│                                                               │
└───────────────────────────────────────────────────────────────┘

总头部大小: 8 字节
最大消息体: 10 MB
```

### 字段说明

| 字段 | 长度 | 说明 |
|------|------|------|
| 消息类型 | 1 byte | 枚举值，标识消息类型 |
| 消息长度 | 4 bytes | 消息体长度，大端序 (网络字节序) |
| 保留字段 | 3 bytes | 预留扩展使用 |
| 消息体 | 变长 | JSON 格式字符串 |

### 消息类型枚举

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

### 编码示例

```typescript
// 编码一条聊天消息
function encodeMessage(type: MessageType, body: any): Buffer {
  const bodyStr = JSON.stringify(body);
  const bodyBuffer = Buffer.from(bodyStr, 'utf-8');
  const bodyLength = bodyBuffer.length;

  // 创建 8 字节头部 + 消息体的缓冲区
  const buffer = Buffer.alloc(HEADER_LENGTH + bodyLength);

  // 写入消息类型 (1 byte)
  buffer.writeUInt8(type, 0);

  // 写入消息长度 (4 bytes, 大端序)
  buffer.writeUInt32BE(bodyLength, 1);

  // 保留字段 (3 bytes) - 填充 0
  buffer.writeUInt8(0, 5);
  buffer.writeUInt8(0, 6);
  buffer.writeUInt8(0, 7);

  // 写入消息体
  bodyBuffer.copy(buffer, HEADER_LENGTH);

  return buffer;
}
```

### 解码示例

```typescript
// 解码消息头
function decodeHeader(buffer: Buffer): Header {
  const type = buffer.readUInt8(0) as MessageType;
  const length = buffer.readUInt32BE(1);

  return { type, length, valid: true };
}

// 解码完整消息
function decodeMessage(buffer: Buffer): Message | null {
  const header = decodeHeader(buffer);
  const bodyBuffer = buffer.slice(HEADER_LENGTH, HEADER_LENGTH + header.length);
  const body = JSON.parse(bodyBuffer.toString('utf-8'));

  return { type: header.type, body };
}
```

## 粘包处理方案

### 什么是粘包

TCP 是流式协议，不保证消息边界。可能出现：
- **粘包**: 多个小消息被合并发送
- **拆包**: 一个大消息被拆分成多个包发送

```
发送方: [Msg1][Msg2][Msg3]
接收方可能收到:
  情况1: [Msg1][Msg2][Msg3]           (理想情况)
  情况2: [Msg1Msg2][Msg3]              (粘包)
  情况3: [Msg1][Msg2Msg3]              (粘包)
  情况4: [Msg1Part1][Msg1Part2Msg2]    (拆包+粘包)
```

### 解决方案: 长度字段法

在消息头部包含消息体长度，接收方根据长度字段确定消息边界。

```typescript
class ProtocolCodec {
  private buffer: Buffer = Buffer.alloc(0);

  // 追加接收到的数据
  append(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
  }

  // 尝试解码一条消息
  decodeOne(): Message | null {
    // 1. 检查是否有足够的字节读取头部 (8 bytes)
    if (this.buffer.length < HEADER_LENGTH) {
      return null; // 等待更多数据
    }

    // 2. 读取消息长度
    const length = this.buffer.readUInt32BE(1);
    const totalLength = HEADER_LENGTH + length;

    // 3. 检查是否有完整的消息体
    if (this.buffer.length < totalLength) {
      return null; // 等待更多数据
    }

    // 4. 提取完整消息
    const messageBuffer = this.buffer.slice(0, totalLength);
    this.buffer = this.buffer.slice(totalLength);

    return decodeMessage(messageBuffer);
  }

  // 解码所有可用的消息
  decodeAll(): Message[] {
    const messages: Message[] = [];
    let message: Message | null;

    while ((message = this.decodeOne()) !== null) {
      messages.push(message);
    }

    return messages;
  }
}
```

### 处理流程

```
接收数据
    │
    ▼
┌─────────────────┐
│  append(data)   │  追加到缓冲区
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   decodeAll()   │  尝试解码所有消息
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
 完整消息    不完整
    │         │
    ▼         ▼
 返回消息    保留在缓冲区
 给应用层    等待下次数据
```

## 心跳机制

### 为什么需要心跳

- 检测连接是否存活
- 防止 NAT 超时
- 及时清理死连接

### 心跳方案

#### 服务器端心跳检测

```typescript
class ConnectionHandler {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = 30000;  // 30秒检测一次
  private heartbeatTimeoutMs = 60000;   // 60秒超时

  startHeartbeatCheck(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      for (const [id, connection] of this.connections) {
        // 检查是否超时
        if (now - connection.lastHeartbeat > this.heartbeatTimeoutMs) {
          console.log(`[ConnectionHandler] 连接超时: ${id}`);
          this.removeConnection(id);
        }
      }
    }, this.heartbeatIntervalMs);
  }
}
```

#### 客户端心跳发送

```typescript
class BSDSocketClient {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = 30000;  // 30秒发送一次

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.connected) {
        this.sendMessage(createHeartbeatMessage()).catch(() => {});
      }
    }, this.heartbeatIntervalMs);
  }
}
```

### 心跳时序

```
Client                           Server
  │                                │
  │────────── HEARTBEAT ──────────▶│
  │                                │ (更新 lastHeartbeat)
  │◀───────── HEARTBEAT ──────────│
  │                                │
  │         (30秒后)               │
  │                                │
  │────────── HEARTBEAT ──────────▶│
  │                                │
  │         (60秒后无响应)          │
  │                                │
  │     [Server 判定超时，断开连接]   │
```

## 认证方案

### JWT 认证流程

```
┌─────────┐                              ┌─────────┐
│  Client │                              │  Server │
└────┬────┘                              └────┬────┘
     │                                        │
     │───────────── connect() ───────────────▶│
     │                                        │
     │◀────────── CONNECT_ACK ────────────────│
     │                                        │
     │                                        │
     │────────── AUTH (token) ───────────────▶│
     │                                        │
     │                              ┌─────────┴─────────┐
     │                              │  verifyToken()    │
     │                              │  - 验证签名       │
     │                              │  - 检查过期时间   │
     │                              └─────────┬─────────┘
     │                                        │
     │◀────────── AUTH_ACK ───────────────────│
     │     (success: true/false)              │
     │                                        │
     │────────── CHAT (需要认证) ────────────▶│
     │                                        │
```

### 认证实现

```typescript
class ChatHandler {
  private handleAuth(connection: ConnectionInfo, message: Message): void {
    const { token } = message.body || {};

    if (!token) {
      connection.socket.sendMessage(
        createErrorMessage(401, '缺少认证令牌')
      );
      return;
    }

    try {
      // 验证 JWT Token
      const user = verifyTokenAndGetUser(token);

      if (!user) {
        connection.socket.sendMessage(
          createErrorMessage(401, '无效的认证令牌')
        );
        return;
      }

      // 设置用户信息
      this.connectionHandler.setUser(connection.id, user);

      // 发送认证成功响应
      connection.socket.sendMessage(
        createAuthAckMessage(true, { id: user.id, userName: user.userName })
      );

    } catch (err: any) {
      connection.socket.sendMessage(
        createErrorMessage(401, `认证失败: ${err.message}`)
      );
    }
  }
}
```

### 认证状态管理

```typescript
interface ConnectionInfo {
  socket: BSDSocket;
  id: string;
  user: any | null;
  isAuthenticated: boolean;  // 认证状态
  connectedAt: number;
  lastHeartbeat: number;
}
```

### 认证拦截

```typescript
private handleChatMessage(connection: ConnectionInfo, message: Message): void {
  // 检查是否已认证
  if (!connection.isAuthenticated) {
    connection.socket.sendMessage(
      createErrorMessage(401, '未认证，无法发送消息')
    );
    return;
  }

  // 处理聊天消息...
}
```

## 性能优化

### 1. 缓冲区管理

- 使用 Buffer 池减少内存分配
- 及时清理已处理的数据

### 2. 事件驱动

- 使用 EventEmitter 避免轮询
- 异步处理消息，不阻塞事件循环

### 3. 连接管理

- 限制最大连接数
- 及时清理无效连接
- 使用 Map 存储连接，O(1) 查找

### 4. 序列化优化

- 使用二进制协议而非文本
- JSON 序列化/反序列化是主要开销
- 考虑使用 Protocol Buffers (预留)

## 错误处理

### 网络错误

```typescript
socket.on('error', (err: Error) => {
  console.error(`[Socket] 错误: ${err.message}`);
  // 清理资源
  this.connections.delete(socketId);
});
```

### 协议错误

```typescript
decodeOne(): Message | null {
  const header = decodeHeader(this.buffer);

  if (!header.valid) {
    // 无效头部，丢弃一个字节继续尝试
    this.buffer = this.buffer.slice(1);
    return this.decodeOne();
  }
}
```

### 应用错误

```typescript
try {
  const body = JSON.parse(bodyStr);
} catch (err) {
  // JSON 解析失败，返回 null
  return null;
}
```
