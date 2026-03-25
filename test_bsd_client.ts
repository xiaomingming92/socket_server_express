/**
 * BSD Socket 客户端测试脚本
 */
import { BSDSocketClient } from './src/bsd/client';
import { MessageType } from './src/bsd/protocol';

async function main() {
  const client = new BSDSocketClient({
    host: 'localhost',
    port: 3001,
    reconnect: false
  });

  // 监听连接成功
  client.on('connect', () => {
    console.log('[Client] 已连接到服务器');
  });

  // 监听连接响应
  client.on('connect_ack', (body) => {
    console.log('[Client] 连接响应:', body);
  });

  // 监听聊天消息
  client.on('chat', (body) => {
    console.log(`[Client] 收到消息: ${body.from}: ${body.content}`);
  });

  // 监听认证响应
  client.on('auth_ack', (body) => {
    console.log('[Client] 认证响应:', body);
  });

  // 监听心跳
  client.on('heartbeat', () => {
    console.log('[Client] 收到心跳');
  });

  // 监听错误
  client.on('server_error', (body) => {
    console.error('[Client] 服务器错误:', body);
  });

  // 监听断开
  client.on('close', (hadError) => {
    console.log('[Client] 连接已关闭, 错误:', hadError);
    process.exit(0);
  });

  try {
    // 连接到服务器
    await client.connect();

    // 等待连接响应
    await new Promise(resolve => setTimeout(resolve, 500));

    // 发送认证消息 (使用测试 token)
    const testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlck5hbWUiOiJ0ZXN0dXNlciIsImlhdCI6MTcwNDA2MDgwMCwiZXhwIjoxOTAwMDAwMDAwfQ.test';
    await client.authenticate(testToken);

    // 等待认证响应
    await new Promise(resolve => setTimeout(resolve, 500));

    // 发送聊天消息
    await client.sendChatMessage('Hello BSD Socket!');

    // 保持连接一段时间
    console.log('[Client] 保持连接 5 秒...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 关闭连接
    await client.close();

  } catch (err: any) {
    console.error('[Client] 错误:', err.message);
    process.exit(1);
  }
}

main();
