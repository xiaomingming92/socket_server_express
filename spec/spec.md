# BSD Socket API 实现规格文档

## 1. 项目概述

### 1.1 目标
手动实现 BSD 风格的 Socket API，不依赖 Socket.IO 或 ws 等高级库，直接使用 Node.js 的 `net` 模块实现底层的 TCP Socket 通信。

### 1.2 BSD Socket API 核心概念
BSD Socket API 是 Unix/Linux 系统中标准的网络编程接口，核心函数包括：
- `socket()` - 创建套接字
- `bind()` - 绑定地址和端口
- `listen()` - 监听连接
- `accept()` - 接受连接
- `connect()` - 发起连接
- `send()` / `recv()` - 发送/接收数据
- `close()` - 关闭套接字

## 2. 技术方案

### 2.1 使用 Node.js net 模块
Node.js 的 `net` 模块提供了底层的 TCP Socket 功能，我们将基于它封装 BSD 风格的 API。

### 2.2 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      Application Layer                       │
│         (Chat Handler / Auth Handler / User Handler)         │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    BSD Socket Wrapper                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │
│  │ socket()│  │ bind()  │  │listen() │  │   accept()      │ │
│  └─────────┘  └─────────┘  └─────────┘  └─────────────────┘ │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │
│  │connect()│  │ send()  │  │ recv()  │  │    close()      │ │
│  └─────────┘  └─────────┘  └─────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    Node.js net Module                        │
│              (createServer / createConnection)               │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                      TCP/IP Stack                            │
└─────────────────────────────────────────────────────────────┘
```

## 3. 接口规格

### 3.1 服务器端 API

```typescript
// 创建 BSD Socket 服务器
class BSDSocketServer {
  constructor(options: ServerOptions);
  
  // 创建套接字并绑定端口 (合并 socket + bind)
  createAndBind(port: number, host?: string): Promise<void>;
  
  // 监听连接
  listen(backlog?: number): Promise<void>;
  
  // 接受连接 (事件驱动)
  onConnection(callback: (socket: BSDSocket) => void): void;
  
  // 关闭服务器
  close(): Promise<void>;
}

// 单个连接套接字
class BSDSocket {
  // 发送数据
  send(data: Buffer | string): Promise<void>;
  
  // 接收数据 (事件驱动)
  onData(callback: (data: Buffer) => void): void;
  
  // 关闭连接
  close(): Promise<void>;
  
  // 获取远程地址信息
  getRemoteAddress(): { address: string; port: number };
  
  // 获取本地地址信息
  getLocalAddress(): { address: string; port: number };
}
```

### 3.2 客户端 API

```typescript
// BSD Socket 客户端
class BSDSocketClient {
  constructor();
  
  // 创建套接字并连接到服务器 (合并 socket + connect)
  connect(port: number, host?: string): Promise<void>;
  
  // 发送数据
  send(data: Buffer | string): Promise<void>;
  
  // 接收数据 (事件驱动)
  onData(callback: (data: Buffer) => void): void;
  
  // 关闭连接
  close(): Promise<void>;
}
```

## 4. 协议设计

### 4.1 消息格式
为了实现完整的聊天功能，需要定义应用层协议：

```
┌─────────────┬─────────────┬─────────────┬─────────────────┐
│  消息类型    │  消息长度    │  保留字段    │     消息体       │
│  (1 byte)   │  (4 bytes)  │  (3 bytes)  │  (变长, JSON)   │
└─────────────┴─────────────┴─────────────┴─────────────────┘
```

消息类型枚举：
- `0x01` - 连接请求
- `0x02` - 连接响应
- `0x03` - 聊天消息
- `0x04` - 心跳包
- `0x05` - 断开连接

### 4.2 消息体 JSON 格式

```typescript
// 聊天消息
interface ChatMessage {
  type: 'chat';
  from: string;
  content: string;
  timestamp: number;
}

// 认证消息
interface AuthMessage {
  type: 'auth';
  token: string;
}

// 心跳消息
interface HeartbeatMessage {
  type: 'heartbeat';
  timestamp: number;
}
```

## 5. 功能规格

### 5.1 核心功能
1. **TCP 服务器**：监听端口，接受多个客户端连接
2. **连接管理**：维护活跃连接列表，支持连接断开检测
3. **消息广播**：接收消息并广播给所有连接的客户端
4. **心跳机制**：定期发送心跳包检测连接活性
5. **JWT 认证**：连接时进行 Token 认证

### 5.2 性能指标
- 支持至少 1000 个并发连接
- 消息延迟 < 10ms (本地测试)
- 内存占用 < 100MB (1000 连接)

## 6. 文件结构

```
src/
├── bsd/
│   ├── index.ts              # 导出模块
│   ├── server.ts             # BSD Socket 服务器实现
│   ├── socket.ts             # BSD Socket 连接实现
│   ├── client.ts             # BSD Socket 客户端实现
│   └── protocol.ts           # 协议编解码
├── handlers/
│   ├── chat.handler.ts       # 聊天处理器
│   └── connection.handler.ts # 连接管理器
├── types/
│   └── bsd.d.ts              # BSD Socket 类型定义
└── bsd_server.ts             # 服务器入口
```

## 7. 使用示例

### 7.1 服务器端
```typescript
import { BSDSocketServer } from './bsd';

const server = new BSDSocketServer();
await server.createAndBind(3000);
await server.listen();

server.onConnection((socket) => {
  console.log('新连接:', socket.getRemoteAddress());
  
  socket.onData((data) => {
    // 处理消息并广播
    server.broadcast(data);
  });
});
```

### 7.2 客户端
```typescript
import { BSDSocketClient } from './bsd';

const client = new BSDSocketClient();
await client.connect(3000, 'localhost');

client.onData((data) => {
  console.log('收到消息:', data.toString());
});

await client.send('Hello BSD Socket!');
```

## 8. 与 Socket.IO 对比

| 特性 | Socket.IO | BSD Socket 实现 |
|------|-----------|-----------------|
| 传输层 | WebSocket + 降级 | 原生 TCP |
| 协议开销 | 高 (HTTP 握手 + Socket.IO 协议) | 低 (自定义二进制协议) |
| 浏览器支持 | 原生支持 | 需要客户端库 |
| 重连机制 | 内置 | 需手动实现 |
| 房间/命名空间 | 内置 | 需手动实现 |
| 学习价值 | 低 (封装完善) | 高 (底层原理) |

## 9. 风险与注意事项

1. **粘包问题**：TCP 是流式协议，需要设计消息边界处理机制
2. **字节序**：网络字节序采用大端序，需要处理大小端转换
3. **错误处理**：网络异常、连接断开等情况需要完善处理
4. **安全性**：需实现 TLS/SSL 加密传输（可选）
