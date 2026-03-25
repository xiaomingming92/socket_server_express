import { Socket as NetSocket } from 'net';
import { EventEmitter } from 'events';
import { ProtocolCodec, Message, MessageType, createDisconnectMessage } from './protocol';

/**
 * BSD Socket 连接类
 * 封装单个 TCP 连接，提供 BSD 风格的 API
 */
export class BSDSocket extends EventEmitter {
  private socket: NetSocket;
  private codec: ProtocolCodec;
  private id: string;
  private connected: boolean = false;
  private user: any = null;
  private lastActivity: number = Date.now();

  constructor(socket: NetSocket) {
    super();
    this.socket = socket;
    this.codec = new ProtocolCodec();
    this.id = `${socket.remoteAddress}:${socket.remotePort}-${Date.now()}`;
    this.connected = true;

    this.setupEventHandlers();
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    // 数据接收
    this.socket.on('data', (data: Buffer) => {
      this.lastActivity = Date.now();
      this.codec.append(data);
      
      // 解码所有可用的消息
      const messages = this.codec.decodeAll();
      for (const message of messages) {
        this.emit('message', message);
      }
    });

    // 连接关闭
    this.socket.on('close', (hadError: boolean) => {
      this.connected = false;
      this.emit('close', hadError);
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
   * 发送数据 (BSD 风格 API)
   * @param data 要发送的数据 (Buffer 或 string)
   */
  send(data: Buffer | string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.connected || this.socket.destroyed) {
        reject(new Error('Socket 未连接'));
        return;
      }

      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
      
      this.socket.write(buffer, (err) => {
        if (err) {
          reject(err);
        } else {
          this.lastActivity = Date.now();
          resolve();
        }
      });
    });
  }

  /**
   * 发送消息对象
   * @param message 消息对象
   */
  sendMessage(message: Buffer): Promise<void> {
    return this.send(message);
  }

  /**
   * 接收数据事件 (BSD 风格 API)
   * 使用 on('message', callback) 替代
   */
  onData(callback: (data: Message) => void): void {
    this.on('message', callback);
  }

  /**
   * 关闭连接 (BSD 风格 API)
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.connected || this.socket.destroyed) {
        resolve();
        return;
      }

      // 发送断开连接消息
      this.send(createDisconnectMessage('客户端主动断开')).catch(() => {});

      this.socket.end(() => {
        this.connected = false;
        resolve();
      });
    });
  }

  /**
   * 强制销毁连接
   */
  destroy(): void {
    this.connected = false;
    this.socket.destroy();
  }

  /**
   * 获取远程地址信息 (BSD 风格 API)
   */
  getRemoteAddress(): { address: string; port: number } {
    return {
      address: this.socket.remoteAddress || '',
      port: this.socket.remotePort || 0
    };
  }

  /**
   * 获取本地地址信息 (BSD 风格 API)
   */
  getLocalAddress(): { address: string; port: number } {
    return {
      address: this.socket.localAddress || '',
      port: this.socket.localPort || 0
    };
  }

  /**
   * 获取 Socket ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected && !this.socket.destroyed;
  }

  /**
   * 设置用户信息
   */
  setUser(user: any): void {
    this.user = user;
  }

  /**
   * 获取用户信息
   */
  getUser(): any {
    return this.user;
  }

  /**
   * 获取最后活动时间
   */
  getLastActivity(): number {
    return this.lastActivity;
  }

  /**
   * 检查是否超时
   * @param timeoutMs 超时时间 (毫秒)
   */
  isTimeout(timeoutMs: number): boolean {
    return Date.now() - this.lastActivity > timeoutMs;
  }

  /**
   * 设置保活
   */
  setKeepAlive(enable: boolean, initialDelay?: number): void {
    this.socket.setKeepAlive(enable, initialDelay);
  }

  /**
   * 设置超时
   */
  setTimeout(timeout: number): void {
    this.socket.setTimeout(timeout);
  }
}
