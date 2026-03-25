import { createConnection, Socket as NetSocket } from 'net';
import { EventEmitter } from 'events';
import { ProtocolCodec, Message, MessageType, createConnectMessage, createChatMessage, createAuthMessage, createHeartbeatMessage, createDisconnectMessage } from './protocol';

/**
 * BSD Socket 客户端配置选项
 */
export interface ClientOptions {
  host: string;
  port: number;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

/**
 * BSD Socket 客户端类
 * 实现 BSD 风格的 Socket API: socket() -> connect() -> send() -> recv() -> close()
 */
export class BSDSocketClient extends EventEmitter {
  private socket: NetSocket | null = null;
  private codec: ProtocolCodec;
  private options: ClientOptions;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: ClientOptions) {
    super();
    this.options = {
      reconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      heartbeatInterval: 30000,
      ...options
    };
    this.codec = new ProtocolCodec();
  }

  /**
   * 创建套接字并连接到服务器 (BSD 风格 API)
   * 合并 socket() + connect()
   */
  connect(token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected || this.socket) {
        reject(new Error('客户端已经连接'));
        return;
      }

      this.socket = createConnection({
        host: this.options.host,
        port: this.options.port
      });

      // 连接成功
      this.socket.on('connect', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.setupEventHandlers();
        this.startHeartbeat();

        // 发送连接消息
        this.sendMessage(createConnectMessage(token)).catch(() => {});

        this.emit('connect');
        resolve();
      });

      // 连接错误
      this.socket.on('error', (err: Error) => {
        if (!this.connected) {
          reject(err);
        } else {
          this.emit('error', err);
        }
      });

      // 连接超时
      this.socket.setTimeout(10000, () => {
        if (!this.connected) {
          this.socket?.destroy();
          reject(new Error('连接超时'));
        }
      });
    });
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    // 数据接收
    this.socket.on('data', (data: Buffer) => {
      this.codec.append(data);

      // 解码所有可用的消息
      const messages = this.codec.decodeAll();
      for (const message of messages) {
        this.handleMessage(message);
      }
    });

    // 连接关闭
    this.socket.on('close', (hadError: boolean) => {
      this.connected = false;
      this.stopHeartbeat();
      this.emit('close', hadError);

      // 尝试重连
      if (this.options.reconnect && this.reconnectAttempts < (this.options.maxReconnectAttempts || 5)) {
        this.scheduleReconnect();
      }
    });

    // 连接错误
    this.socket.on('error', (err: Error) => {
      this.emit('error', err);
    });

    // 连接结束
    this.socket.on('end', () => {
      this.emit('end');
    });
  }

  /**
   * 处理消息
   */
  private handleMessage(message: Message): void {
    this.emit('message', message);

    // 根据消息类型触发不同事件
    switch (message.type) {
      case MessageType.CONNECT_ACK:
        this.emit('connect_ack', message.body);
        break;
      case MessageType.CHAT:
        this.emit('chat', message.body);
        break;
      case MessageType.AUTH_ACK:
        this.emit('auth_ack', message.body);
        break;
      case MessageType.HEARTBEAT:
        this.emit('heartbeat', message.body);
        break;
      case MessageType.ERROR:
        this.emit('server_error', message.body);
        break;
      case MessageType.DISCONNECT:
        this.emit('disconnect_notice', message.body);
        break;
    }
  }

  /**
   * 发送数据 (BSD 风格 API)
   */
  send(data: Buffer | string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket || this.socket.destroyed) {
        reject(new Error('客户端未连接'));
        return;
      }

      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');

      this.socket.write(buffer, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 发送消息对象
   */
  sendMessage(message: Buffer): Promise<void> {
    return this.send(message);
  }

  /**
   * 发送聊天消息
   */
  sendChatMessage(content: string, to?: string): Promise<void> {
    return this.sendMessage(createChatMessage('', content, to));
  }

  /**
   * 发送认证消息
   */
  authenticate(token: string): Promise<void> {
    return this.sendMessage(createAuthMessage(token));
  }

  /**
   * 接收数据事件 (BSD 风格 API)
   */
  onData(callback: (data: Message) => void): void {
    this.on('message', callback);
  }

  /**
   * 关闭连接 (BSD 风格 API)
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.connected || !this.socket) {
        resolve();
        return;
      }

      // 禁用重连
      this.options.reconnect = false;

      // 清除重连定时器
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // 发送断开连接消息
      this.sendMessage(createDisconnectMessage('客户端主动断开')).catch(() => {});

      this.socket.end(() => {
        this.connected = false;
        this.stopHeartbeat();
        resolve();
      });
    });
  }

  /**
   * 强制销毁连接
   */
  destroy(): void {
    this.options.reconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();
    this.socket?.destroy();
    this.connected = false;
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.connected) {
        this.sendMessage(createHeartbeatMessage()).catch(() => {});
      }
    }, this.options.heartbeatInterval || 30000);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 计划重连
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.options.reconnectInterval || 5000;

    console.log(`[BSDSocketClient] ${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[BSDSocketClient] 重连失败:', err.message);
      });
    }, delay);
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected && !!this.socket && !this.socket.destroyed;
  }

  /**
   * 获取服务器地址信息
   */
  getRemoteAddress(): { address: string; port: number } {
    return {
      address: this.socket?.remoteAddress || '',
      port: this.socket?.remotePort || 0
    };
  }

  /**
   * 获取本地地址信息
   */
  getLocalAddress(): { address: string; port: number } {
    return {
      address: this.socket?.localAddress || '',
      port: this.socket?.localPort || 0
    };
  }
}
