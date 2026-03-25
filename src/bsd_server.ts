import 'dotenv/config';
import { BSDSocketServer } from './bsd/server';
import { ConnectionHandler } from './handlers/connection.handler';
import { ChatHandler } from './handlers/chat.handler';
import { Message, MessageType } from './bsd/protocol';

/**
 * BSD Socket 服务器入口
 * 手动实现 BSD 风格的 Socket API
 */

const PORT = parseInt(process.env.BSD_SOCKET_PORT || '3001', 10);
const HOST = process.env.BSD_SOCKET_HOST || '0.0.0.0';

async function main() {
  console.log('='.repeat(60));
  console.log('  BSD Socket Server - 手动实现 BSD 风格 Socket API');
  console.log('='.repeat(60));

  // 创建连接管理器
  const connectionHandler = new ConnectionHandler({
    heartbeatInterval: 30000,
    heartbeatTimeout: 60000
  });

  // 创建聊天处理器
  const chatHandler = new ChatHandler(connectionHandler);

  // 创建 BSD Socket 服务器
  const server = new BSDSocketServer({
    port: PORT,
    host: HOST,
    maxConnections: 1000,
    heartbeatInterval: 30000,
    heartbeatTimeout: 60000
  });

  // 监听服务器事件
  server.on('listening', ({ address, port }) => {
    console.log(`[Server] 服务器正在监听 ${address}:${port}`);
  });

  server.on('ready', () => {
    console.log('[Server] 服务器已就绪，等待连接...');
    console.log('-'.repeat(60));
  });

  server.on('connection', (socket) => {
    const remoteAddress = socket.getRemoteAddress();
    console.log(`[Server] 新连接: ${remoteAddress.address}:${remoteAddress.port}`);

    // 添加到连接管理器
    const connectionInfo = connectionHandler.addConnection(socket);

    // 监听消息
    socket.onData((message: Message) => {
      // 聊天消息和认证由 ChatHandler 处理
      chatHandler.handleMessage(connectionInfo.id, message);

      // 其他消息类型可以在这里处理
      if (message.type === MessageType.CONNECT) {
        console.log(`[Server] 收到连接请求: ${connectionInfo.id}`);
      }
    });

    // 监听断开
    socket.on('close', (hadError: boolean) => {
      const user = connectionInfo.user;
      if (user) {
        chatHandler.notifyUserLeft(user.userName || user.id);
      }
      console.log(`[Server] 连接断开: ${connectionInfo.id}, 错误: ${hadError}`);
    });

    // 监听错误
    socket.on('error', (err: Error) => {
      console.error(`[Server] Socket 错误 (${connectionInfo.id}):`, err.message);
    });
  });

  server.on('disconnect', ({ socketId, hadError }) => {
    console.log(`[Server] 连接已移除: ${socketId}, 错误: ${hadError}`);
  });

  server.on('timeout', ({ socketId }) => {
    console.log(`[Server] 连接超时: ${socketId}`);
  });

  server.on('reject', ({ reason }) => {
    console.log(`[Server] 连接被拒绝: ${reason}`);
  });

  server.on('error', (err) => {
    console.error('[Server] 服务器错误:', err.message);
  });

  server.on('close', () => {
    console.log('[Server] 服务器已关闭');
  });

  // 启动心跳检测
  connectionHandler.startHeartbeatCheck();

  // 启动服务器
  try {
    await server.createAndBind();
    await server.listen();
  } catch (err: any) {
    console.error('[Server] 启动失败:', err.message);
    process.exit(1);
  }

  // 优雅关闭
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n[Server] 收到信号: ${signal}`);
    console.log('[Server] 正在优雅关闭...');

    // 停止心跳检测
    connectionHandler.stopHeartbeatCheck();

    // 关闭所有连接
    await connectionHandler.closeAll();

    // 关闭服务器
    await server.close();

    console.log('[Server] 已安全关闭');
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // 未捕获的异常
  process.on('uncaughtException', (err) => {
    console.error('[Server] 未捕获的异常:', err);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Server] 未处理的 Promise 拒绝:', reason);
  });
}

main().catch((err) => {
  console.error('[Server] 启动失败:', err);
  process.exit(1);
});
