import { BSDSocket } from '../bsd/socket';
import { Message, MessageType, createHeartbeatMessage } from '../bsd/protocol';

/**
 * 连接信息接口
 */
export interface ConnectionInfo {
  socket: BSDSocket;
  id: string;
  connectedAt: number;
  lastHeartbeat: number;
  user: any | null;
  isAuthenticated: boolean;
}

/**
 * 连接管理器
 * 管理所有活跃的 BSD Socket 连接
 */
export class ConnectionHandler {
  private connections: Map<string, ConnectionInfo> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs: number;
  private heartbeatTimeoutMs: number;

  constructor(options: { heartbeatInterval?: number; heartbeatTimeout?: number } = {}) {
    this.heartbeatIntervalMs = options.heartbeatInterval || 30000;
    this.heartbeatTimeoutMs = options.heartbeatTimeout || 60000;
  }

  /**
   * 添加新连接
   */
  addConnection(socket: BSDSocket): ConnectionInfo {
    const id = socket.getId();
    const now = Date.now();

    const connectionInfo: ConnectionInfo = {
      socket,
      id,
      connectedAt: now,
      lastHeartbeat: now,
      user: null,
      isAuthenticated: false
    };

    this.connections.set(id, connectionInfo);

    // 设置消息监听
    socket.onData((message: Message) => {
      this.handleMessage(id, message);
    });

    // 设置断开监听
    socket.on('close', () => {
      this.removeConnection(id);
    });

    console.log(`[ConnectionHandler] 新连接: ${id}, 当前连接数: ${this.getConnectionCount()}`);

    return connectionInfo;
  }

  /**
   * 移除连接
   */
  removeConnection(id: string): boolean {
    const connection = this.connections.get(id);
    if (!connection) {
      return false;
    }

    // 关闭 socket
    if (connection.socket.isConnected()) {
      connection.socket.close().catch(() => {});
    }

    this.connections.delete(id);
    console.log(`[ConnectionHandler] 连接断开: ${id}, 当前连接数: ${this.getConnectionCount()}`);

    return true;
  }

  /**
   * 处理消息
   */
  private handleMessage(connectionId: string, message: Message): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    // 更新最后活动时间
    connection.lastHeartbeat = Date.now();

    switch (message.type) {
      case MessageType.HEARTBEAT:
        this.handleHeartbeat(connectionId, message);
        break;
      case MessageType.AUTH:
        this.handleAuth(connectionId, message);
        break;
      case MessageType.DISCONNECT:
        this.handleDisconnect(connectionId, message);
        break;
      default:
        // 其他消息类型由上层处理器处理
        break;
    }
  }

  /**
   * 处理心跳
   */
  private handleHeartbeat(connectionId: string, message: Message): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    connection.lastHeartbeat = Date.now();

    // 回复心跳
    connection.socket.sendMessage(createHeartbeatMessage()).catch(() => {});

    console.log(`[ConnectionHandler] 收到心跳: ${connectionId}`);
  }

  /**
   * 处理认证
   */
  private handleAuth(connectionId: string, message: Message): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    // TODO: 验证 JWT Token
    // 这里简化处理，实际应该调用 verifyTokenAndGetUser
    const { token } = message.body || {};

    if (token) {
      connection.isAuthenticated = true;
      connection.user = { id: 'user_' + Date.now(), token };
      console.log(`[ConnectionHandler] 认证成功: ${connectionId}`);
    } else {
      console.log(`[ConnectionHandler] 认证失败: ${connectionId}`);
    }
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(connectionId: string, message: Message): void {
    const { reason } = message.body || {};
    console.log(`[ConnectionHandler] 收到断开请求: ${connectionId}, 原因: ${reason || '未知'}`);
    this.removeConnection(connectionId);
  }

  /**
   * 设置用户信息
   */
  setUser(connectionId: string, user: any): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return false;
    }

    connection.user = user;
    connection.isAuthenticated = true;
    connection.socket.setUser(user);

    return true;
  }

  /**
   * 获取连接信息
   */
  getConnection(id: string): ConnectionInfo | undefined {
    return this.connections.get(id);
  }

  /**
   * 获取所有连接
   */
  getAllConnections(): ConnectionInfo[] {
    return Array.from(this.connections.values());
  }

  /**
   * 获取所有已认证连接
   */
  getAuthenticatedConnections(): ConnectionInfo[] {
    return this.getAllConnections().filter(conn => conn.isAuthenticated);
  }

  /**
   * 获取连接数
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * 广播消息给所有连接
   */
  broadcast(data: Buffer | string, excludeConnectionId?: string): void {
    for (const [id, connection] of this.connections) {
      if (excludeConnectionId && id === excludeConnectionId) {
        continue;
      }
      if (connection.socket.isConnected()) {
        connection.socket.send(data).catch(() => {});
      }
    }
  }

  /**
   * 广播消息给已认证用户
   */
  broadcastToAuthenticated(data: Buffer | string, excludeConnectionId?: string): void {
    for (const [id, connection] of this.connections) {
      if (excludeConnectionId && id === excludeConnectionId) {
        continue;
      }
      if (connection.isAuthenticated && connection.socket.isConnected()) {
        connection.socket.send(data).catch(() => {});
      }
    }
  }

  /**
   * 启动心跳检测
   */
  startHeartbeatCheck(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      for (const [id, connection] of this.connections) {
        if (now - connection.lastHeartbeat > this.heartbeatTimeoutMs) {
          console.log(`[ConnectionHandler] 连接超时: ${id}`);
          this.removeConnection(id);
        }
      }
    }, this.heartbeatIntervalMs);

    console.log('[ConnectionHandler] 心跳检测已启动');
  }

  /**
   * 停止心跳检测
   */
  stopHeartbeatCheck(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('[ConnectionHandler] 心跳检测已停止');
    }
  }

  /**
   * 关闭所有连接
   */
  closeAll(): Promise<void> {
    return new Promise((resolve) => {
      this.stopHeartbeatCheck();

      const promises: Promise<void>[] = [];
      for (const connection of this.connections.values()) {
        if (connection.socket.isConnected()) {
          promises.push(connection.socket.close());
        }
      }

      Promise.all(promises).finally(() => {
        this.connections.clear();
        resolve();
      });
    });
  }
}
