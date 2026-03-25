# 📖 使用示例

本文档提供 BSD Socket 实现的详细使用示例。

## 目录

- [快速开始](#快速开始)
- [服务器示例](#服务器示例)
- [客户端示例](#客户端示例)
- [完整聊天示例](#完整聊天示例)
- [测试脚本](#测试脚本)

## 快速开始

### 1. 启动服务器

```bash
# 安装依赖
npm install

# 启动 BSD Socket 服务器
npm run startbsd
```

服务器将在端口 3001 启动，输出如下：

```
============================================================
  BSD Socket Server - 手动实现 BSD 风格 Socket API
============================================================
[Server] 服务器正在监听 0.0.0.0:3001
[Server] 服务器已就绪，等待连接...
------------------------------------------------------------
```

### 2. 运行客户端测试

```bash
# 在另一个终端运行客户端测试
npx ts-node test_bsd_client.ts
```

## 服务器示例

### 基础服务器

```typescript
import { BSDSocketServer } from './src/bsd/server';

async function main() {
  const server = new BSDSocketServer({
    port: 3001,
    host: '0.0.0.0'
  });

  // 监听连接
  server.onConnection((socket) => {
    console.log('新连接:', socket.getRemoteAddress());

    // 监听消息
    socket.onData((message) => {
      console.log('收到消息:', message);
    });

    // 监听断开
    socket.on('close', () => {
      console.log('连接断开');
    });
  });

  // 启动服务器
  await server.createAndBind();
  await server.listen();

  console.log('服务器运行在端口 3001');
}

main();
```

### 带事件处理的服务器

```typescript
import { BSDSocketServer } from './src/bsd/server';
import { createChatMessage } from './src/bsd/protocol';

const server = new BSDSocketServer({
  port: 3001,
  maxConnections: 100
});

// 服务器事件
server.on('listening', ({ address, port }) => {
  console.log(`服务器正在监听 ${address}:${port}`);
});

server.on('ready', () => {
  console.log('服务器已就绪');
});

server.on('connection', (socket) => {
  console.log(`新连接: ${socket.getId()}`);

  socket.onData((message) => {
    // 广播给所有客户端
    server.broadcast(JSON.stringify(message), socket.getId());
  });
});

server.on('disconnect', ({ socketId }) => {
  console.log(`连接断开: ${socketId}`);
});

server.on('error', (err) => {
  console.error('服务器错误:', err);
});

// 启动
await server.createAndBind();
await server.listen();
```

### 完整聊天服务器

```typescript
import { BSDSocketServer } from './src/bsd/server';
import { ConnectionHandler } from './src/handlers/connection.handler';
import { ChatHandler } from './src/handlers/chat.handler';
import { Message, MessageType } from './src/bsd/protocol';

async function main() {
  // 创建组件
  const connectionHandler = new ConnectionHandler();
  const chatHandler = new ChatHandler(connectionHandler);
  const server = new BSDSocketServer({ port: 3001 });

  // 处理连接
  server.onConnection((socket) => {
    const connection = connectionHandler.addConnection(socket);

    // 处理消息
    socket.onData((message: Message) => {
      chatHandler.handleMessage(connection.id, message);
    });

    // 处理断开
    socket.on('close', () => {
      if (connection.user) {
        chatHandler.notifyUserLeft(connection.user.userName);
      }
    });
  });

  // 启动
  connectionHandler.startHeartbeatCheck();
  await server.createAndBind();
  await server.listen();

  console.log('聊天服务器运行在端口 3001');
}

main();
```

## 客户端示例

### 基础客户端

```typescript
import { BSDSocketClient } from './src/bsd/client';

async function main() {
  const client = new BSDSocketClient({
    host: 'localhost',
    port: 3001
  });

  // 监听事件
  client.on('connect', () => {
    console.log('已连接到服务器');
  });

  client.on('message', (message) => {
    console.log('收到消息:', message);
  });

  client.on('close', () => {
    console.log('连接已关闭');
    process.exit(0);
  });

  // 连接
  await client.connect();

  // 发送消息
  await client.send('Hello Server!');

  // 保持连接
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 关闭
  await client.close();
}

main();
```

### 带自动重连的客户端

```typescript
import { BSDSocketClient } from './src/bsd/client';

const client = new BSDSocketClient({
  host: 'localhost',
  port: 3001,
  reconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 10
});

client.on('connect', () => {
  console.log('已连接');
});

client.on('close', () => {
  console.log('连接断开，尝试重连...');
});

await client.connect();
```

### 聊天客户端

```typescript
import { BSDSocketClient } from './src/bsd/client';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const client = new BSDSocketClient({
  host: 'localhost',
  port: 3001
});

// 事件监听
client.on('connect', () => {
  console.log('已连接到聊天服务器');
  console.log('输入消息并按回车发送，输入 /quit 退出');
});

client.on('chat', (body) => {
  console.log(`\n[${body.from}] ${body.content}`);
  rl.prompt();
});

client.on('server_error', (body) => {
  console.error('错误:', body.message);
});

// 连接并认证
await client.connect();
await client.authenticate('your-jwt-token');

// 交互式输入
rl.setPrompt('> ');
rl.prompt();

rl.on('line', async (line) => {
  if (line.trim() === '/quit') {
    await client.close();
    rl.close();
    return;
  }

  await client.sendChatMessage(line.trim());
  rl.prompt();
});
```

## 完整聊天示例

### 服务器代码

```typescript
// chat-server.ts
import { BSDSocketServer } from './src/bsd/server';
import { ConnectionHandler } from './src/handlers/connection.handler';
import { ChatHandler } from './src/handlers/chat.handler';
import { Message, MessageType } from './src/bsd/protocol';

async function main() {
  console.log('启动聊天服务器...');

  const connectionHandler = new ConnectionHandler({
    heartbeatInterval: 30000,
    heartbeatTimeout: 60000
  });

  const chatHandler = new ChatHandler(connectionHandler);

  const server = new BSDSocketServer({
    port: 3001,
    maxConnections: 100
  });

  server.on('connection', (socket) => {
    const addr = socket.getRemoteAddress();
    console.log(`[连接] ${addr.address}:${addr.port}`);

    const connection = connectionHandler.addConnection(socket);

    socket.onData((message: Message) => {
      chatHandler.handleMessage(connection.id, message);
    });

    socket.on('close', () => {
      if (connection.user) {
        chatHandler.notifyUserLeft(connection.user.userName);
      }
      console.log(`[断开] ${connection.id}`);
    });
  });

  connectionHandler.startHeartbeatCheck();
  await server.createAndBind();
  await server.listen();

  console.log('聊天服务器已启动，端口: 3001');
}

main();
```

### 客户端代码

```typescript
// chat-client.ts
import { BSDSocketClient } from './src/bsd/client';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  const client = new BSDSocketClient({
    host: 'localhost',
    port: 3001
  });

  let userName = '';

  client.on('connect', () => {
    console.log('已连接到服务器');
  });

  client.on('connect_ack', (body) => {
    console.log('连接响应:', body.message);
  });

  client.on('auth_ack', (body) => {
    if (body.success) {
      console.log('认证成功!');
      console.log('输入消息聊天，/quit 退出');
      rl.setPrompt('> ');
      rl.prompt();
    } else {
      console.log('认证失败:', body.message);
    }
  });

  client.on('chat', (body) => {
    console.log(`\r\n[${body.from}] ${body.content}`);
    rl.prompt();
  });

  client.on('server_error', (body) => {
    console.error('错误:', body.message);
  });

  // 连接
  await client.connect();

  // 输入用户名和 Token
  userName = await new Promise<string>(resolve => {
    rl.question('请输入用户名: ', resolve);
  });

  const token = 'your-jwt-token'; // 实际应从登录获取
  await client.authenticate(token);

  // 聊天循环
  rl.on('line', async (line) => {
    if (line.trim() === '/quit') {
      await client.close();
      rl.close();
      return;
    }

    if (line.trim()) {
      await client.sendChatMessage(line.trim());
    }
    rl.prompt();
  });

  client.on('close', () => {
    console.log('\n连接已关闭');
    process.exit(0);
  });
}

main();
```

## 测试脚本

### 压力测试

```typescript
// stress-test.ts
import { BSDSocketClient } from './src/bsd/client';

async function stressTest(concurrent: number, messages: number) {
  const clients: BSDSocketClient[] = [];

  // 创建连接
  for (let i = 0; i < concurrent; i++) {
    const client = new BSDSocketClient({
      host: 'localhost',
      port: 3001
    });

    client.on('chat', (body) => {
      // 接收消息
    });

    await client.connect();
    clients.push(client);
  }

  console.log(`${concurrent} 个连接已建立`);

  // 发送消息
  const start = Date.now();

  for (let i = 0; i < messages; i++) {
    const client = clients[i % concurrent];
    await client.sendChatMessage(`消息 ${i}`);
  }

  const duration = Date.now() - start;
  console.log(`发送 ${messages} 条消息耗时: ${duration}ms`);
  console.log(`平均: ${(messages / duration * 1000).toFixed(0)} 消息/秒`);

  // 关闭连接
  for (const client of clients) {
    await client.close();
  }
}

stressTest(10, 1000);
```

### 运行测试

```bash
# 1. 启动服务器
npm run startbsd

# 2. 在另一个终端运行压力测试
npx ts-node stress-test.ts
```

## 环境变量

```bash
# .env 文件
BSD_SOCKET_PORT=3001
BSD_SOCKET_HOST=0.0.0.0
JWT_SECRET=your-secret-key
```

## 调试技巧

### 启用详细日志

```typescript
// 在代码中添加日志
socket.onData((message) => {
  console.log(`[DEBUG] 收到消息:`, JSON.stringify(message, null, 2));
});
```

### 使用 Wireshark 抓包

```bash
# 监听本地 3001 端口
sudo tcpdump -i lo -X -nn port 3001
```

### Node.js 调试

```bash
# 使用 --inspect 启动
npx ts-node --inspect src/bsd_server.ts

# 在 Chrome 中打开 chrome://inspect
```
