import { BSDSocket } from '../bsd/socket';
import { Message, MessageType, createChatMessage, createErrorMessage, createAuthAckMessage } from '../bsd/protocol';
import { ConnectionHandler, ConnectionInfo } from './connection.handler';
import { verifyTokenAndGetUser } from '../utils/verifyToken';

/**
 * 聊天消息接口
 */
export interface ChatMessageData {
  from: string;
  content: string;
  to?: string;
  timestamp: number;
}

/**
 * 聊天处理器
 * 处理聊天相关的业务逻辑
 */
export class ChatHandler {
  private connectionHandler: ConnectionHandler;

  constructor(connectionHandler: ConnectionHandler) {
    this.connectionHandler = connectionHandler;
  }

  /**
   * 处理消息
   */
  handleMessage(connectionId: string, message: Message): void {
    const connection = this.connectionHandler.getConnection(connectionId);
    if (!connection) {
      return;
    }

    switch (message.type) {
      case MessageType.CHAT:
        this.handleChatMessage(connection, message);
        break;
      case MessageType.AUTH:
        this.handleAuth(connection, message);
        break;
      default:
        // 其他消息类型不处理
        break;
    }
  }

  /**
   * 处理聊天消息
   */
  private handleChatMessage(connection: ConnectionInfo, message: Message): void {
    // 检查是否已认证
    if (!connection.isAuthenticated) {
      connection.socket.sendMessage(
        createErrorMessage(401, '未认证，无法发送消息')
      ).catch(() => {});
      return;
    }

    const { content, to } = message.body || {};

    if (!content || typeof content !== 'string') {
      connection.socket.sendMessage(
        createErrorMessage(400, '消息内容不能为空')
      ).catch(() => {});
      return;
    }

    // 构建聊天消息
    const chatData: ChatMessageData = {
      from: connection.user?.userName || connection.user?.id || '匿名用户',
      content: content.trim(),
      to,
      timestamp: Date.now()
    };

    console.log(`[ChatHandler] 收到消息: ${chatData.from}: ${chatData.content}`);

    // 创建消息缓冲区
    const messageBuffer = createChatMessage(
      chatData.from,
      chatData.content,
      chatData.to
    );

    // 广播消息
    if (to) {
      // 私聊
      this.sendPrivateMessage(to, messageBuffer, connection.id);
    } else {
      // 群聊 - 广播给所有已认证用户
      this.broadcastMessage(messageBuffer, connection.id);
    }

    // 发送确认给发送者
    connection.socket.sendMessage(
      createChatMessage('系统', '消息已发送', connection.user?.id)
    ).catch(() => {});
  }

  /**
   * 处理认证
   */
  private handleAuth(connection: ConnectionInfo, message: Message): void {
    const { token } = message.body || {};

    if (!token) {
      connection.socket.sendMessage(
        createErrorMessage(401, '缺少认证令牌')
      ).catch(() => {});
      return;
    }

    try {
      // 验证 JWT Token
      const user = verifyTokenAndGetUser(token);

      if (!user) {
        connection.socket.sendMessage(
          createErrorMessage(401, '无效的认证令牌')
        ).catch(() => {});
        return;
      }

      // 设置用户信息
      this.connectionHandler.setUser(connection.id, user);

      // 发送认证成功响应
      connection.socket.sendMessage(
        createAuthAckMessage(true, { id: user.id, userName: user.userName })
      ).catch(() => {});

      console.log(`[ChatHandler] 用户认证成功: ${user.userName || user.id}`);

    } catch (err: any) {
      connection.socket.sendMessage(
        createErrorMessage(401, `认证失败: ${err.message}`)
      ).catch(() => {});
    }
  }

  /**
   * 广播消息给所有已认证用户
   */
  private broadcastMessage(message: Buffer, excludeConnectionId?: string): void {
    this.connectionHandler.broadcastToAuthenticated(message, excludeConnectionId);
  }

  /**
   * 发送私聊消息
   */
  private sendPrivateMessage(toUserId: string, message: Buffer, fromConnectionId: string): void {
    const connections = this.connectionHandler.getAllConnections();
    let sent = false;

    for (const conn of connections) {
      if (conn.user?.id === toUserId && conn.socket.isConnected()) {
        conn.socket.sendMessage(message).catch(() => {});
        sent = true;
      }
    }

    // 如果未找到目标用户，通知发送者
    if (!sent) {
      const fromConn = this.connectionHandler.getConnection(fromConnectionId);
      if (fromConn) {
        fromConn.socket.sendMessage(
          createErrorMessage(404, `用户 ${toUserId} 不在线`)
        ).catch(() => {});
      }
    }
  }

  /**
   * 发送系统消息
   */
  sendSystemMessage(content: string, toConnectionId?: string): void {
    const message = createChatMessage('系统', content);

    if (toConnectionId) {
      const conn = this.connectionHandler.getConnection(toConnectionId);
      if (conn) {
        conn.socket.sendMessage(message).catch(() => {});
      }
    } else {
      this.connectionHandler.broadcast(message);
    }
  }

  /**
   * 用户加入通知
   */
  notifyUserJoined(userName: string): void {
    const message = createChatMessage('系统', `${userName} 加入了聊天室`);
    this.connectionHandler.broadcastToAuthenticated(message);
  }

  /**
   * 用户离开通知
   */
  notifyUserLeft(userName: string): void {
    const message = createChatMessage('系统', `${userName} 离开了聊天室`);
    this.connectionHandler.broadcastToAuthenticated(message);
  }

  /**
   * 获取在线用户列表
   */
  getOnlineUsers(): Array<{ id: string; userName: string }> {
    const connections = this.connectionHandler.getAuthenticatedConnections();
    return connections.map(conn => ({
      id: conn.user?.id || conn.id,
      userName: conn.user?.userName || '匿名用户'
    }));
  }
}
