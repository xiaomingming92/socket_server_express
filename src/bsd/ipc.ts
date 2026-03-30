/**
 * 自定义 IPC (Inter-Process Communication) 消息收发链路
 * 
 * 设计目标：
 * 1. 替代 EventEmitter，提供更纯粹的消息机制
 * 2. 类型安全，完整的 TypeScript 支持
 * 3. 性能优化，减少不必要的开销
 * 4. 可控性，精确的消息生命周期管理
 * 5. 可观测性，内置统计和调试能力
 * 
 * 与 EventEmitter 的关键差异：
 * - 订阅返回取消函数，便于内存管理
 * - 原生支持异步处理器
 * - 可选的消息队列，防止事件堆积
 * - 精确的错误处理，不依赖全局 error 事件
 */

/**
 * IPC 消息结构
 */
export interface IPCMessage<T = any> {
  /** 消息类型 */
  type: string;
  /** 消息载荷 */
  payload: T;
  /** 时间戳 */
  timestamp: number;
  /** 消息来源标识 */
  source?: string;
}

/**
 * IPC 处理器类型
 */
export type IPCHandler<T = any> = (message: IPCMessage<T>) => void | Promise<void>;

/**
 * 订阅选项
 */
export interface SubscribeOptions {
  /** 是否异步执行 */
  async?: boolean;
  /** 执行优先级（数字越小优先级越高） */
  priority?: number;
  /** 是否只执行一次 */
  once?: boolean;
}

/**
 * IPC 统计信息
 */
export interface IPCStats {
  /** 总发布消息数 */
  totalPublished: number;
  /** 总处理消息数 */
  totalHandled: number;
  /** 处理失败数 */
  totalErrors: number;
  /** 当前订阅数 */
  activeSubscriptions: number;
  /** 各类型订阅详情 */
  subscriptionsByType: Record<string, number>;
  /** 平均处理延迟 (ms) */
  averageLatency: number;
}

/**
 * 订阅者信息
 */
interface Subscriber<T = any> {
  handler: IPCHandler<T>;
  options: Required<SubscribeOptions>;
  createdAt: number;
}

/**
 * IPC 通道配置
 */
export interface IPCChannelOptions {
  /** 是否启用异步队列 */
  enableQueue?: boolean;
  /** 队列最大长度 */
  maxQueueSize?: number;
  /** 是否捕获处理器错误 */
  catchErrors?: boolean;
  /** 错误处理器 */
  onError?: (error: Error, message: IPCMessage) => void;
}

/**
 * 自定义 IPC 通道实现
 * 替代 EventEmitter 的消息收发机制
 */
export class IPCChannel {
  private subscribers: Map<string, Set<Subscriber>> = new Map();
  private messageQueue: IPCMessage[] = [];
  private isProcessingQueue: boolean = false;
  private stats = {
    totalPublished: 0,
    totalHandled: 0,
    totalErrors: 0,
    latencies: [] as number[],
  };
  
  private options: Required<IPCChannelOptions>;

  constructor(options: IPCChannelOptions = {}) {
    this.options = {
      enableQueue: false,
      maxQueueSize: 1000,
      catchErrors: true,
      onError: (err, msg) => console.error(`[IPC] Error handling ${msg.type}:`, err),
      ...options,
    };
  }

  /**
   * 订阅消息
   * @param eventType 消息类型
   * @param handler 处理器函数
   * @param options 订阅选项
   * @returns 取消订阅函数
   */
  subscribe<T>(
    eventType: string,
    handler: IPCHandler<T>,
    options: SubscribeOptions = {}
  ): () => void {
    const subscriber: Subscriber<T> = {
      handler: handler as IPCHandler,
      options: {
        async: options.async ?? false,
        priority: options.priority ?? 0,
        once: options.once ?? false,
      },
      createdAt: Date.now(),
    };

    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }

    this.subscribers.get(eventType)!.add(subscriber);

    // 返回取消订阅函数
    return () => {
      this.subscribers.get(eventType)?.delete(subscriber);
      if (this.subscribers.get(eventType)?.size === 0) {
        this.subscribers.delete(eventType);
      }
    };
  }

  /**
   * 一次性订阅
   * @param eventType 消息类型
   * @param handler 处理器函数
   */
  once<T>(eventType: string, handler: IPCHandler<T>): void {
    const wrappedHandler = async (message: IPCMessage<T>) => {
      try {
        await handler(message);
      } finally {
        // 执行后自动取消订阅
        this.unsubscribe(eventType, wrappedHandler);
      }
    };
    
    this.subscribe(eventType, wrappedHandler, { once: true });
  }

  /**
   * 发布消息
   * @param eventType 消息类型
   * @param payload 消息载荷
   * @param source 消息来源
   */
  publish<T>(eventType: string, payload: T, source?: string): void {
    const message: IPCMessage<T> = {
      type: eventType,
      payload,
      timestamp: Date.now(),
      source,
    };

    this.stats.totalPublished++;

    if (this.options.enableQueue) {
      // 加入队列异步处理
      if (this.messageQueue.length < this.options.maxQueueSize) {
        this.messageQueue.push(message);
        this.processQueue();
      } else {
        this.options.onError?.(
          new Error(`Message queue full (${this.options.maxQueueSize})`),
          message
        );
      }
    } else {
      // 同步处理
      this.handleMessage(message);
    }
  }

  /**
   * 处理消息
   * @param message IPC 消息
   */
  private async handleMessage(message: IPCMessage): Promise<void> {
    const subscribers = this.subscribers.get(message.type);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    // 按优先级排序
    const sortedSubscribers = Array.from(subscribers).sort(
      (a, b) => a.options.priority - b.options.priority
    );

    const startTime = Date.now();

    for (const subscriber of sortedSubscribers) {
      try {
        if (subscriber.options.async) {
          // 异步执行，不阻塞
          this.executeAsync(subscriber.handler, message);
        } else {
          // 同步执行
          await subscriber.handler(message);
        }

        this.stats.totalHandled++;

        // 一次性订阅，执行后移除
        if (subscriber.options.once) {
          subscribers.delete(subscriber);
        }
      } catch (error) {
        this.stats.totalErrors++;
        if (this.options.catchErrors) {
          this.options.onError?.(error as Error, message);
        } else {
          throw error;
        }
      }
    }

    // 记录延迟
    const latency = Date.now() - startTime;
    this.stats.latencies.push(latency);
    // 只保留最近 1000 条记录
    if (this.stats.latencies.length > 1000) {
      this.stats.latencies.shift();
    }
  }

  /**
   * 异步执行处理器
   */
  private executeAsync(handler: IPCHandler, message: IPCMessage): void {
    Promise.resolve().then(() => handler(message)).catch((error) => {
      this.stats.totalErrors++;
      this.options.onError?.(error, message);
    });
  }

  /**
   * 处理消息队列
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      await this.handleMessage(message);
    }

    this.isProcessingQueue = false;
  }

  /**
   * 取消订阅
   * @param eventType 消息类型
   * @param handler 处理器函数（可选，不传则取消该类型所有订阅）
   */
  unsubscribe(eventType: string, handler?: IPCHandler): void {
    if (!handler) {
      // 取消该类型所有订阅
      this.subscribers.delete(eventType);
      return;
    }

    const subscribers = this.subscribers.get(eventType);
    if (!subscribers) return;

    // 查找并移除匹配的处理器
    for (const subscriber of subscribers) {
      if (subscriber.handler === handler) {
        subscribers.delete(subscriber);
        break;
      }
    }

    if (subscribers.size === 0) {
      this.subscribers.delete(eventType);
    }
  }

  /**
   * 取消所有订阅
   */
  unsubscribeAll(): void {
    this.subscribers.clear();
    this.messageQueue = [];
  }

  /**
   * 获取统计信息
   */
  getStats(): IPCStats {
    const latencies = this.stats.latencies;
    const averageLatency =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;

    const subscriptionsByType: Record<string, number> = {};
    for (const [type, subscribers] of this.subscribers) {
      subscriptionsByType[type] = subscribers.size;
    }

    return {
      totalPublished: this.stats.totalPublished,
      totalHandled: this.stats.totalHandled,
      totalErrors: this.stats.totalErrors,
      activeSubscriptions: Array.from(this.subscribers.values()).reduce(
        (sum, set) => sum + set.size,
        0
      ),
      subscriptionsByType,
      averageLatency: Math.round(averageLatency * 100) / 100,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalPublished: 0,
      totalHandled: 0,
      totalErrors: 0,
      latencies: [],
    };
  }

  /**
   * 检查是否有指定类型的订阅
   */
  hasSubscribers(eventType: string): boolean {
    return this.subscribers.has(eventType) && 
           (this.subscribers.get(eventType)?.size ?? 0) > 0;
  }

  /**
   * 获取指定类型的订阅数
   */
  getSubscriberCount(eventType: string): number {
    return this.subscribers.get(eventType)?.size ?? 0;
  }

  /**
   * 销毁通道
   */
  destroy(): void {
    this.unsubscribeAll();
    this.resetStats();
  }
}

/**
 * 创建 IPC 通道的工厂函数
 */
export function createIPCChannel(options?: IPCChannelOptions): IPCChannel {
  return new IPCChannel(options);
}
