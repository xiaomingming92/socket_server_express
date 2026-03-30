/**
 * 消息缓冲池 - 防御性消息处理架构
 * 
 * 核心设计理念：
 * 1. **永不丢弃新消息** - 而是更新缓冲池中的状态
 * 2. **去重即防御** - 重复请求被视为更新，而非攻击
 * 3. **灵活配置** - 可配置为严格队列模式或缓冲池模式
 * 
 * 典型场景：
 * - 高频重复请求（攻击/重试）→ 更新缓冲池，只处理最新状态
 * - 状态同步场景 → 始终处理最新数据，跳过中间状态
 * - 严格顺序场景 → 可配置为传统队列模式
 */

/**
 * 消息唯一标识生成器
 */
export type MessageKeyGenerator<T> = (message: T) => string;

/**
 * 消息合并策略
 */
export enum MergeStrategy {
  /** 替换：新消息完全替换旧消息 */
  REPLACE = 'replace',
  /** 合并：深度合并对象（如 Object.assign） */
  MERGE = 'merge',
  /** 累加：数值累加（如计数器） */
  ACCUMULATE = 'accumulate',
  /** 自定义：使用自定义合并函数 */
  CUSTOM = 'custom',
}

/**
 * 缓冲池配置
 */
export interface BufferPoolOptions<T> {
  /** 缓冲池容量 */
  capacity: number;
  
  /** 
   * 消息唯一键生成函数
   * 用于识别"同一类"消息
   * 例如：`(msg) => msg.userId + ':' + msg.action`
   */
  keyGenerator: MessageKeyGenerator<T>;
  
  /** 合并策略 */
  mergeStrategy?: MergeStrategy;
  
  /** 自定义合并函数（当 strategy 为 CUSTOM 时使用） */
  customMerger?: (oldMsg: T, newMsg: T) => T;
  
  /** 
   * 处理模式
   * - 'buffer': 缓冲池模式（默认），更新而非丢弃
   * - 'strict': 严格队列模式，传统 FIFO
   */
  mode?: 'buffer' | 'strict';
  
  /** 消息过期时间（毫秒），0 表示不过期 */
  ttl?: number;
  
  /** 处理间隔（毫秒），控制消费速率 */
  processInterval?: number;
  
  /** 批处理大小 */
  batchSize?: number;
}

/**
 * 缓冲池条目
 */
interface BufferEntry<T> {
  /** 消息数据 */
  data: T;
  /** 首次入池时间 */
  firstEnqueuedAt: number;
  /** 最后更新时间 */
  lastUpdatedAt: number;
  /** 更新次数 */
  updateCount: number;
  /** 消息键 */
  key: string;
}

/**
 * 缓冲池统计
 */
export interface BufferPoolStats {
  /** 当前缓冲的消息数 */
  size: number;
  /** 容量 */
  capacity: number;
  /** 使用率 */
  usageRate: number;
  /** 总入池次数 */
  totalEnqueued: number;
  /** 总更新次数（去重次数） */
  totalUpdated: number;
  /** 总出池次数 */
  totalDequeued: number;
  /** 去重率 = totalUpdated / totalEnqueued */
  deduplicationRate: number;
  /** 平均在池时间（毫秒） */
  averageBufferTime: number;
  /** 各键的统计 */
  keyStats: Record<string, {
    updateCount: number;
    lastUpdatedAt: number;
  }>;
}

/**
 * 消息缓冲池
 * 
 * 防御性设计：
 * - 攻击者发送 10000 次相同请求 → 缓冲池只保留 1 条最新状态
 * - 消费者只处理 1 次（或按配置处理）
 * - 攻击被转化为"心跳更新"
 */
export class MessageBufferPool<T> {
  private pool: Map<string, BufferEntry<T>> = new Map();
  private options: Required<BufferPoolOptions<T>>;
  private stats = {
    totalEnqueued: 0,
    totalUpdated: 0,
    totalDequeued: 0,
    bufferTimes: [] as number[],
  };
  
  /** 处理中的键集合（防止重复处理） */
  private processingKeys: Set<string> = new Set();
  
  /** 消费者回调 */
  private consumer?: (message: T, metadata: {
    key: string;
    updateCount: number;
    bufferTime: number;
    isRepeated: boolean;
  }) => void | Promise<void>;

  constructor(options: BufferPoolOptions<T>) {
    this.options = {
      capacity: options.capacity,
      keyGenerator: options.keyGenerator,
      mergeStrategy: options.mergeStrategy ?? MergeStrategy.REPLACE,
      customMerger: options.customMerger,
      mode: options.mode ?? 'buffer',
      ttl: options.ttl ?? 0,
      processInterval: options.processInterval ?? 0,
      batchSize: options.batchSize ?? 1,
    };

    // 启动 TTL 清理定时器
    if (this.options.ttl > 0) {
      setInterval(() => this.cleanupExpired(), this.options.ttl);
    }
  }

  /**
   * 入池/更新消息
   * 
   * 核心逻辑：
   * 1. 生成消息键
   * 2. 如果键已存在 → 更新消息（而非丢弃）
   * 3. 如果键不存在 → 新增消息
   * 4. 如果池满 → 移除最旧的消息
   * 
   * @param message 消息数据
   * @returns 是否成功入池
   */
  enqueue(message: T): boolean {
    const key = this.options.keyGenerator(message);
    const now = Date.now();

    this.stats.totalEnqueued++;

    // 严格队列模式：传统 FIFO
    if (this.options.mode === 'strict') {
      if (this.pool.size >= this.options.capacity) {
        return false; // 队列满
      }
      this.pool.set(key, {
        data: message,
        firstEnqueuedAt: now,
        lastUpdatedAt: now,
        updateCount: 1,
        key,
      });
      return true;
    }

    // 缓冲池模式：更新而非丢弃
    const existing = this.pool.get(key);
    
    if (existing) {
      // 更新现有消息（去重）
      existing.data = this.mergeMessage(existing.data, message);
      existing.lastUpdatedAt = now;
      existing.updateCount++;
      this.stats.totalUpdated++;
      
      // 移动到最新（LRU 策略）
      this.pool.delete(key);
      this.pool.set(key, existing);
      
      return true;
    }

    // 检查容量
    if (this.pool.size >= this.options.capacity) {
      // 移除最旧的消息（LRU）
      const oldestKey = this.pool.keys().next().value;
      if (oldestKey) {
        this.pool.delete(oldestKey);
      }
    }

    // 新增消息
    this.pool.set(key, {
      data: message,
      firstEnqueuedAt: now,
      lastUpdatedAt: now,
      updateCount: 1,
      key,
    });

    return true;
  }

  /**
   * 合并消息
   */
  private mergeMessage(oldMsg: T, newMsg: T): T {
    switch (this.options.mergeStrategy) {
      case MergeStrategy.REPLACE:
        return newMsg;
      
      case MergeStrategy.MERGE:
        if (typeof oldMsg === 'object' && typeof newMsg === 'object') {
          return { ...oldMsg, ...newMsg };
        }
        return newMsg;
      
      case MergeStrategy.ACCUMULATE:
        if (typeof oldMsg === 'number' && typeof newMsg === 'number') {
          return (oldMsg + newMsg) as unknown as T;
        }
        return newMsg;
      
      case MergeStrategy.CUSTOM:
        if (this.options.customMerger) {
          return this.options.customMerger(oldMsg, newMsg);
        }
        return newMsg;
      
      default:
        return newMsg;
    }
  }

  /**
   * 出池消息
   * @returns 消息和元数据，如果池空返回 null
   */
  dequeue(): { message: T; metadata: {
    key: string;
    updateCount: number;
    bufferTime: number;
    isRepeated: boolean;
  } } | null {
    // 找到第一个未在处理中的消息
    for (const [key, entry] of this.pool) {
      if (this.processingKeys.has(key)) {
        continue;
      }

      this.pool.delete(key);
      this.processingKeys.add(key);
      
      const now = Date.now();
      const bufferTime = now - entry.firstEnqueuedAt;
      
      this.stats.totalDequeued++;
      this.stats.bufferTimes.push(bufferTime);
      
      // 只保留最近 1000 条记录
      if (this.stats.bufferTimes.length > 1000) {
        this.stats.bufferTimes.shift();
      }

      return {
        message: entry.data,
        metadata: {
          key,
          updateCount: entry.updateCount,
          bufferTime,
          isRepeated: entry.updateCount > 1,
        },
      };
    }

    return null;
  }

  /**
   * 标记消息处理完成
   * @param key 消息键
   */
  complete(key: string): void {
    this.processingKeys.delete(key);
  }

  /**
   * 注册消费者
   * @param consumer 消费回调
   */
  onConsume(consumer: (message: T, metadata: {
    key: string;
    updateCount: number;
    bufferTime: number;
    isRepeated: boolean;
  }) => void | Promise<void>): void {
    this.consumer = consumer;
    
    // 启动消费循环
    if (this.options.processInterval > 0) {
      this.startConsumptionLoop();
    }
  }

  /**
   * 启动消费循环
   */
  private startConsumptionLoop(): void {
    const loop = async () => {
      while (this.consumer) {
        const result = this.dequeue();
        if (result) {
          try {
            await this.consumer(result.message, result.metadata);
          } finally {
            this.complete(result.metadata.key);
          }
        }
        await this.sleep(this.options.processInterval);
      }
    };
    
    loop();
  }

  /**
   * 批量出池
   * @param size 批量大小
   */
  dequeueBatch(size: number): Array<{ message: T; metadata: {
    key: string;
    updateCount: number;
    bufferTime: number;
    isRepeated: boolean;
  } }> {
    const batch: ReturnType<typeof this.dequeue>[] = [];
    
    for (let i = 0; i < size; i++) {
      const item = this.dequeue();
      if (!item) break;
      batch.push(item);
    }
    
    return batch.filter((item): item is NonNullable<typeof item> => item !== null);
  }

  /**
   * 清理过期消息
   */
  private cleanupExpired(): void {
    if (this.options.ttl <= 0) return;
    
    const now = Date.now();
    const expiredKeys: string[] = [];
    
    for (const [key, entry] of this.pool) {
      if (now - entry.lastUpdatedAt > this.options.ttl) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      this.pool.delete(key);
    }
  }

  /**
   * 获取指定键的消息
   */
  get(key: string): T | undefined {
    return this.pool.get(key)?.data;
  }

  /**
   * 检查键是否存在
   */
  has(key: string): boolean {
    return this.pool.has(key);
  }

  /**
   * 手动移除消息
   */
  remove(key: string): boolean {
    return this.pool.delete(key);
  }

  /**
   * 清空缓冲池
   */
  clear(): void {
    this.pool.clear();
    this.processingKeys.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): BufferPoolStats {
    const bufferTimes = this.stats.bufferTimes;
    const averageBufferTime = bufferTimes.length > 0
      ? bufferTimes.reduce((a, b) => a + b, 0) / bufferTimes.length
      : 0;

    const keyStats: Record<string, { updateCount: number; lastUpdatedAt: number }> = {};
    for (const [key, entry] of this.pool) {
      keyStats[key] = {
        updateCount: entry.updateCount,
        lastUpdatedAt: entry.lastUpdatedAt,
      };
    }

    return {
      size: this.pool.size,
      capacity: this.options.capacity,
      usageRate: this.pool.size / this.options.capacity,
      totalEnqueued: this.stats.totalEnqueued,
      totalUpdated: this.stats.totalUpdated,
      totalDequeued: this.stats.totalDequeued,
      deduplicationRate: this.stats.totalEnqueued > 0
        ? this.stats.totalUpdated / this.stats.totalEnqueued
        : 0,
      averageBufferTime: Math.round(averageBufferTime * 100) / 100,
      keyStats,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalEnqueued: 0,
      totalUpdated: 0,
      totalDequeued: 0,
      bufferTimes: [],
    };
  }

  /**
   * 获取当前大小
   */
  get size(): number {
    return this.pool.size;
  }

  /**
   * 是否为空
   */
  get isEmpty(): boolean {
    return this.pool.size === 0;
  }

  /**
   * 是否已满
   */
  get isFull(): boolean {
    return this.pool.size >= this.options.capacity;
  }

  /**
   * 睡眠辅助函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 创建缓冲池的工厂函数
 */
export function createBufferPool<T>(options: BufferPoolOptions<T>): MessageBufferPool<T> {
  return new MessageBufferPool<T>(options);
}
