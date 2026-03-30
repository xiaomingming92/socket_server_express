/**
 * Unix Domain Socket (UDS) 演示
 * 
 * 展示如何使用 UDS 实现宿主 IPC 直通
 * 性能优势：零网络协议开销、无内核态切换、数据零拷贝
 */

import { BSDSocketServer } from '../src/bsd/server';
import { BSDSocketClient } from '../src/bsd/client';
import { MessageType } from '../src/bsd/protocol';

const SOCKET_PATH = '/tmp/bsd_socket_demo.sock';

// ==================== 服务器端 ====================
async function startServer(): Promise<BSDSocketServer> {
  const server = new BSDSocketServer({
    unixPath: SOCKET_PATH,
    heartbeatInterval: 30000,
    heartbeatTimeout: 60000,
    maxConnections: 100,
    socketMode: 0o666  // 确保其他进程可访问
  });

  // 监听连接事件
  server.on('connection', (socket) => {
    console.log(`[Server] 新连接: ${socket.getId()}`);
    console.log(`[Server] 远程地址:`, socket.getRemoteAddress());
    
    // 监听消息
    socket.onData((message) => {
      console.log(`[Server] 收到消息:`, message);
      
      // 回显消息
      if (message.type === MessageType.CHAT) {
        socket.sendMessage(Buffer.from(JSON.stringify({
          type: MessageType.CHAT,
          body: { 
            from: 'server', 
            content: `Echo: ${message.body.content}`,
            timestamp: Date.now()
          }
        }))).catch(console.error);
      }
    });

    // 监听断开
    socket.on('close', (hadError) => {
      console.log(`[Server] 连接断开: ${socket.getId()}, 错误: ${hadError}`);
    });
  });

  // 监听服务器事件
  server.on('listening', (info) => {
    console.log('[Server] Unix Domain Socket 服务器已启动');
    console.log('[Server] Socket 路径:', info.unixPath);
    console.log('[Server] 权限模式:', info.socketMode?.toString(8));
    console.log('[Server] 模式:', info.mode);
  });

  server.on('ready', () => {
    console.log('[Server] 服务器就绪，等待连接...\n');
  });

  // 启动服务器
  await server.createAndBind();
  await server.listen();

  return server;
}

// ==================== 客户端 ====================
async function startClient(): Promise<BSDSocketClient> {
  const client = new BSDSocketClient({
    unixPath: SOCKET_PATH,
    reconnect: true,
    reconnectInterval: 3000,
    maxReconnectAttempts: 3,
    heartbeatInterval: 30000
  });

  // 监听连接事件
  client.on('connect', () => {
    console.log('[Client] 已连接到 UDS 服务器');
    console.log('[Client] 本地地址:', client.getLocalAddress());
    console.log('[Client] 远程地址:', client.getRemoteAddress());
  });

  // 监听消息
  client.on('message', (message) => {
    console.log('[Client] 收到消息:', message);
  });

  client.on('chat', (body) => {
    console.log('[Client] 收到聊天消息:', body);
  });

  // 监听断开
  client.on('close', (hadError) => {
    console.log('[Client] 连接断开, 错误:', hadError);
  });

  // 连接到服务器
  await client.connect();

  return client;
}

// ==================== 性能测试 ====================
async function benchmark(client: BSDSocketClient): Promise<void> {
  console.log('\n========== 性能测试 ==========');
  
  const messageCount = 10000;
  const message = { content: 'Hello UDS!'.repeat(10) }; // 100 bytes
  
  // 准备消息缓冲区
  const messageBuffer = Buffer.from(JSON.stringify({
    type: MessageType.CHAT,
    body: { ...message, timestamp: Date.now() }
  }));

  // 预热
  for (let i = 0; i < 100; i++) {
    await client.sendMessage(messageBuffer);
  }

  // 正式测试
  const startTime = process.hrtime.bigint();
  
  for (let i = 0; i < messageCount; i++) {
    await client.sendMessage(messageBuffer);
  }
  
  const endTime = process.hrtime.bigint();
  const durationMs = Number(endTime - startTime) / 1_000_000;
  
  console.log(`发送消息数: ${messageCount}`);
  console.log(`总耗时: ${durationMs.toFixed(2)} ms`);
  console.log(`平均延迟: ${(durationMs / messageCount).toFixed(3)} ms`);
  console.log(`吞吐量: ${(messageCount / (durationMs / 1000)).toFixed(0)} msg/s`);
  console.log(`==============================\n');
}

// ==================== 主程序 ====================
async function main(): Promise<void> {
  console.log('=== Unix Domain Socket (UDS) 演示 ===\n');
  
  let server: BSDSocketServer | null = null;
  let client: BSDSocketClient | null = null;

  try {
    // 启动服务器
    server = await startServer();
    
    // 等待服务器就绪
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 启动客户端
    client = await startClient();
    
    // 等待连接建立
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 发送测试消息
    console.log('[Client] 发送测试消息...');
    await client.sendChatMessage('Hello from UDS client!', undefined);
    
    // 等待响应
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 性能测试
    await benchmark(client);
    
    // 保持连接一段时间
    console.log('[Main] 保持连接 3 秒...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
  } catch (error) {
    console.error('[Main] 错误:', error);
  } finally {
    // 清理
    console.log('\n[Main] 清理资源...');
    
    if (client) {
      await client.close();
      console.log('[Main] 客户端已关闭');
    }
    
    if (server) {
      await server.close();
      console.log('[Main] 服务器已关闭');
    }
    
    // 清理 socket 文件
    try {
      const fs = require('fs');
      if (fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
        console.log('[Main] Socket 文件已清理');
      }
    } catch (e) {
      // ignore
    }
    
    console.log('[Main] 演示结束');
    process.exit(0);
  }
}

// 运行
main();
