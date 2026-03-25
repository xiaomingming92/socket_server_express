import { createServer, Server as NetServer, Socket as NetSocket } from 'net';
import { EventEmitter } from 'events';
import { BSDSocket } from './socket';
import { Message, MessageType, createConnectAckMessage, createErrorMessage } from './protocol';

/**
 * BSD Socket 服务器配置选项
 */
export interface ServerOptions {
  port: number;
  host?: string;
  backlog?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  maxConnections?: number;
}

/**
 * BSD Socket 服务器类
 * 实现 BSD 风格的 Socket API: socket() -> bind() -> listen() -> accept()
 */
export class BSDSocketServer extends EventEmitter {
  private server: NetServer | null = null;
  private options: ServerOptions;
  private connections: Map<string, BSDSocket> = new Map();
  private running: boolean = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: ServerOptions) {
    super();
    this.options = {
      host: '0.0.0.0',
      backlog: 511,
      heartbeatInterval: 30000,  // 默认 30 秒心跳
      heartbeatTimeout: 60000,   // 默认 60 秒超时
      maxConnections: 1000,
      ...options
    };
  }

  /**
   * 创建套接字并绑定端口 (BSD 风格 API)
   * 合并 socket() + bind()
   */
  createAndBind(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        reject(new Error('服务器已经创建'));
        return;
      }

      this.server = createServer();

      this.server.on('error', (err: Error) => {
        this.emit('error', err);
        reject(err);
      });

      this.server.listen(this.options.port, this.options.host, () => {
        this.emit('listening', {
          address: this.options.host,
          port: this.options.port
        });
        resolve();
      });
    });
  }

  /**
   * 监听连接 (BSD 风格 API)
   * 对应 listen() + accept()
   */
  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('服务器未创建，请先调用 createAndBind()'));
        return;
      }

      if (this.running) {
        reject(new Error('服务器已经在运行'));
        return;
      }

      // 处理新连接
      this.server.on('connection', (netSocket: NetSocket) => {
        this.handleConnection(netSocket);
      });

      this.running = true;

      // 启动心跳检测
      this.startHeartbeat();

      this.emit('ready');
      resolve();
    });
  }

  /**
   * 处理新连接
   */
  private handleConnection(netSocket: NetSocket): void {
    // 检查最大连接数
    if (this.connections.size >= (this.options.maxConnections || 1000)) {
      netSocket.end(createErrorMessage(503, '服务器连接数已满'));
      netSocket.destroy();
      this.emit('reject', { reason: 'max_connections' });
      return;
    }

    // 创建 BSDSocket 包装
    const socket = new BSDSocket(netSocket);
    const socketId = socket.getId();

    // 存储连接
    this.connections.set(socketId, socket);

    // 发送连接成功响应
    socket.sendMessage(createConnectAckMessage(true, '连接成功')).catch(() => {});

    // 触发连接事件
    this.emit('connection', socket);

    // 监听消息
    socket.onData((message: Message) => {
      this.emit('message', { socket, message });
    });

    // 监听断开
    socket.on('close', (hadError: boolean) => {
      this.connections.delete(socketId);
      this.emit('disconnect', { socketId, hadError });
    });

    // 监听错误
    socket.on('error', (err: Error) => {
      this.emit('socket_error', { socketId, error: err });
    });

    // 设置保活
    socket.setKeepAlive(true, 30000);
  }

  /**
   * 接受连接事件 (BSD 风格 API)
   * 使用 on('connection', callback) 替代
   */
  onConnection(callback: (socket: BSDSocket) => void): void {
    this.on('connection', callback);
  }

  /**
   * 广播消息给所有连接
   */
  broadcast(data: Buffer | string, excludeSocketId?: string): void {
    for (const [id, socket] of this.connections) {
      if (excludeSocketId && id === excludeSocketId) {
        continue;
      }
      if (socket.isConnected()) {
        socket.send(data).catch(() => {});
      }
    }
  }

  /**
   * 广播消息对象给所有连接
   */
  broadcastMessage(message: Buffer, excludeSocketId?: string): void {
    this.broadcast(message, excludeSocketId);
  }

  /**
   * 获取指定连接
   */
  getConnection(socketId: string): BSDSocket | undefined {
    return this.connections.get(socketId);
  }

  /**
   * 获取所有连接
   */
  getAllConnections(): BSDSocket[] {
    return Array.from(this.connections.values());
  }

  /**
   * 获取连接数
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * 关闭服务器 (BSD 风格 API)
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.running = false;

      // 停止心跳检测
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      // 关闭所有连接
      for (const socket of this.connections.values()) {
        socket.close().catch(() => {});
      }
      this.connections.clear();

      // 关闭服务器
      this.server.close(() => {
        this.emit('close');
        resolve();
      });

      // 强制关闭超时
      setTimeout(() => {
        if (this.server) {
          this.server.unref();
        }
        resolve();
      }, 5000);
    });
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeout = this.options.heartbeatTimeout || 60000;

      for (const [id, socket] of this.connections) {
        if (socket.isTimeout(timeout)) {
          // 超时，关闭连接
          socket.close().catch(() => {});
          this.connections.delete(id);
          this.emit('timeout', { socketId: id });
        }
      }
    }, this.options.heartbeatInterval || 30000);
  }

  /**
   * 检查服务器是否运行中
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 获取服务器地址信息
   */
  getAddress(): { address: string; port: number } {
    return {
      address: this.options.host || '0.0.0.0',
      port: this.options.port
    };
  }
}
