/**
 * BSD Socket 服务器 - 自定义 IPC 版本
 * 
 * 使用 IPCChannel 替代 EventEmitter
 * 实现更纯粹、更可控的消息收发机制
 */

import { createServer, Server as NetServer, Socket as NetSocket } from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { BSDSocket } from './socket';
import { Message, MessageType, createConnectAckMessage, createErrorMessage } from './protocol';
import { IPCChannel, IPCMessage, createIPCChannel } from './ipc';

/**
 * BSD Socket 服务器配置选项
 */
export interface ServerOptions {
  port?: number;
  unixPath?: string;
  host?: string;
  backlog?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  maxConnections?: number;
  socketMode?: number;
}

/**
 * 服务器事件类型
 */
export type ServerEventType = 
  | 'listening' 
  | 'ready' 
  | 'connection' 
  | 'message' 
  | 'disconnect' 
  | 'timeout' 
  | 'reject' 
  | 'error' 
  | 'socket_error' 
  | 'close';

/**
 * 服务器事件载荷类型
 */
export interface ServerEventMap {
  listening: { address?: string; port?: number; unixPath?: string; mode: string; socketMode?: number };
  ready: void;
  connection: BSDSocket;
  message: { socket: BSDSocket; message: Message };
  disconnect: { socketId: string; hadError: boolean };
  timeout: { socketId: string };
  reject: { reason: string };
  error: Error;
  socket_error: { socketId: string; error: Error };
  close: void;
}

/**
 * BSD Socket 服务器类 - IPC 版本
 * 使用自定义 IPCChannel 替代 EventEmitter
 */
export class BSDSocketServerIPC {
  private server: NetServer | null = null;
  private options: ServerOptions;
  private connections: Map<string, BSDSocket> = new Map();
  private running: boolean = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  
  // 使用自定义 IPCChannel 替代 EventEmitter
  private ipcChannel: IPCChannel;

  constructor(options: ServerOptions) {
    this.options = {
      host: '0.0.0.0',
      backlog: 511,
      heartbeatInterval: 30000,
      heartbeatTimeout: 60000,
      maxConnections: 1000,
      socketMode: 0o666,
      ...options,
    };
    
    // 初始化 IPC 通道
    this.ipcChannel = createIPCChannel({
      catchErrors: true,
      onError: (error, message) => {
        console.error(`[BSDSocketServerIPC] IPC Error:`, error, message);
      },
    });
  }

  /**
   * 订阅服务器事件
   * @param event 事件类型
   * @param handler 事件处理器
   * @returns 取消订阅函数
   */
  on<T extends ServerEventType>(
    event: T,
    handler: (payload: ServerEventMap[T]) => void | Promise<void>
  ): () => void {
    return this.ipcChannel.subscribe(event, handler as any);
  }

  /**
   * 一次性订阅事件
   */
  once<T extends ServerEventType>(
    event: T,
    handler: (payload: ServerEventMap[T]) => void | Promise<void>
  ): void {
    this.ipcChannel.once(event, handler as any);
  }

  /**
   * 发布事件（内部使用）
   */
  private emit<T extends ServerEventType>(
    event: T,
    payload: ServerEventMap[T]
  ): void {
    this.ipcChannel.publish(event, payload, 'BSDSocketServerIPC');
  }

  /**
   * 创建套接字并绑定
   */
  createAndBind(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        reject(new Error('服务器已经创建'));
        return;
      }

      if (!this.options.port && !this.options.unixPath) {
        reject(new Error('必须指定 port 或 unixPath'));
        return;
      }

      this.server = createServer();

      this.server.on('error', (err: Error) => {
        this.emit('error', err);
        reject(err);
      });

      if (this.options.unixPath) {
        this.createUnixSocket(resolve, reject);
      } else {
        this.createTcpSocket(resolve, reject);
      }
    });
  }

  /**
   * 创建 TCP Socket
   */
  private createTcpSocket(resolve: () => void, reject: (err: Error) => void): void {
    this.server!.listen(
      this.options.port,
      this.options.host,
      this.options.backlog || 511,
      () => {
        this.emit('listening', {
          address: this.options.host,
          port: this.options.port,
          mode: 'tcp',
        });
        resolve();
      }
    );
  }

  /**
   * 创建 Unix Domain Socket
   */
  private createUnixSocket(resolve: () => void, reject: (err: Error) => void): void {
    const unixPath = this.options.unixPath!;

    const dir = path.dirname(unixPath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        reject(new Error(`创建目录失败: ${dir}, ${err}`));
        return;
      }
    }

    if (fs.existsSync(unixPath)) {
      try {
        fs.unlinkSync(unixPath);
      } catch (err) {
        reject(new Error(`清理旧 socket 文件失败: ${unixPath}, ${err}`));
        return;
      }
    }

    this.server!.listen(unixPath, () => {
      const mode = this.options.socketMode || 0o666;
      try {
        fs.chmodSync(unixPath, mode);
      } catch (err) {
        console.warn(`设置 socket 权限失败: ${unixPath}`);
      }

      this.emit('listening', {
        unixPath: unixPath,
        mode: 'unix',
        socketMode: mode,
      });
      resolve();
    });
  }

  /**
   * 监听连接
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

      this.server.on('connection', (netSocket: NetSocket) => {
        this.handleConnection(netSocket);
      });

      this.running = true;
      this.startHeartbeat();
      this.emit('ready', undefined);
      resolve();
    });
  }

  /**
   * 处理新连接
   */
  private handleConnection(netSocket: NetSocket): void {
    if (this.connections.size >= (this.options.maxConnections || 1000)) {
      netSocket.end(createErrorMessage(503, '服务器连接数已满'));
      netSocket.destroy();
      this.emit('reject', { reason: 'max_connections' });
      return;
    }

    const socket = new BSDSocket(netSocket);
    const socketId = socket.getId();

    this.connections.set(socketId, socket);
    socket.sendMessage(createConnectAckMessage(true, '连接成功')).catch(() => {});

    // 使用 IPC 发布连接事件
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

    socket.setKeepAlive(true, 30000);
  }

  /**
   * 接受连接事件
   */
  onConnection(callback: (socket: BSDSocket) => void): () => void {
    return this.on('connection', callback);
  }

  /**
   * 广播消息
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
   * 广播消息对象
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
   * 关闭服务器
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.running = false;

      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      for (const socket of this.connections.values()) {
        socket.close().catch(() => {});
      }
      this.connections.clear();

      this.server.close(() => {
        this.emit('close', undefined);
        resolve();
      });

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
  getAddress(): { address: string; port: number; unixPath?: string } {
    return {
      address: this.options.host || '0.0.0.0',
      port: this.options.port || 0,
      unixPath: this.options.unixPath,
    };
  }

  /**
   * 判断是否为 Unix Domain Socket 模式
   */
  isUnixSocket(): boolean {
    return !!this.options.unixPath;
  }

  /**
   * 获取 IPC 统计信息
   */
  getIPCStats() {
    return this.ipcChannel.getStats();
  }

  /**
   * 销毁服务器
   */
  destroy(): void {
    this.ipcChannel.destroy();
  }
}
