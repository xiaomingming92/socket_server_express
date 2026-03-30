# 自定义 IPC 消息收发链路架构设计

## 核心设计理念

> **消息队列不是可选功能，而是消息处理盈余评估的必要机制。**

### 问题洞察

| 框架 | 消息队列策略 | 问题 |
|------|-------------|------|
| **Spring Boot** | 默认无队列，依赖外部 MQ | 生产者-消费者失衡时直接崩溃或 OOM |
| **Node.js EventEmitter** | 无队列，同步执行 | 事件堆积导致内存泄漏，无背压机制 |
| **传统做法** | 队列作为"可选优化" | 无法评估系统真实处理能力 |

### 我们的方案：强制消息队列 + 盈余评估

```
┌─────────────────────────────────────────────────────────────┐
│                    消息处理盈余评估架构                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   生产者 ──► ┌─────────────────────────────────────┐       │
│   (任意速率)  │         强制消息队列                  │       │
│              │  ┌───────────────────────────────┐  │       │
│              │  │  队列状态实时监控              │  │       │
│              │  │  - 当前长度                    │  │       │
│              │  │  - 入队速率 (msg/s)            │  │       │
│              │  │  - 出队速率 (msg/s)            │  │       │
│              │  │  - 平均处理延迟                │  │       │
│              │  │  - 盈余系数 = 出队/入队        │  │       │
│              │  └───────────────────────────────┘  │       │
│              │           ↓                         │       │
│              │  ┌───────────────────────────────┐  │       │
│              │  │  背压策略 (Backpressure)       │  │       │
│              │  │  - 队列满：拒绝新消息          │  │       │
│              │  │  - 盈余 < 0.8：告警            │  │       │
│              │  │  - 盈余 < 0.5：降级处理        │  │       │
│              │  └───────────────────────────────┘  │       │
│              └─────────────────────────────────────┘       │
│                           ↓                                 │
│   消费者 ──► ┌─────────────────────────────────────┐       │
│   (可控速率)  │      自适应消费者线程池              │       │
│              │  - 根据盈余动态调整并发度            │       │
│              │  - 优先队列保证关键消息              │       │
│              └─────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 关键设计决策

### 1. 强制消息队列（非可选）

```typescript
// 错误设计：队列作为可选配置
interface BadOptions {
  enableQueue?: boolean;  // ❌ 可选，导致系统行为不确定
}

// 正确设计：队列是核心机制
interface GoodOptions {
  queueCapacity: number;        // ✅ 必须指定容量
  backpressureStrategy: 'drop' | 'block' | 'error';  // ✅ 必须指定策略
  targetSurplusRatio: number;   // ✅ 目标盈余系数 (默认 1.2)
}
```

### 2. 盈余评估指标

```typescript
interface QueueSurplusMetrics {
  // 实时指标
  queueLength: number;          // 当前队列长度
  queueCapacity: number;        // 队列容量
  
  // 速率指标 (滑动窗口计算)
  enqueueRate: number;          // 入队速率 (msg/s)
  dequeueRate: number;          // 出队速率 (msg/s)
  
  // 盈余评估
  surplusRatio: number;         // 盈余系数 = dequeueRate / enqueueRate
  // surplusRatio > 1: 健康，处理能力富余
  // surplusRatio = 1: 临界，刚好平衡
  // surplusRatio < 1: 危险，消息堆积
  
  // 预测指标
  estimatedFullTime: number;    // 预计队列满的时间 (ms)
  estimatedEmptyTime: number;   // 预计队列空的时间 (ms)
}
```

### 3. 自适应处理策略

```typescript
enum ProcessingStrategy {
  // 盈余 > 1.2: 正常处理
  NORMAL = 'normal',
  
  // 盈余 0.8-1.2: 轻度压力，启用批处理
  BATCHING = 'batching',
  
  // 盈余 0.5-0.8: 中度压力，降级非关键消息
  DEGRADED = 'degraded',
  
  // 盈余 < 0.5: 严重压力，只处理关键消息
  CRITICAL = 'critical',
  
  // 队列满: 拒绝新消息
  REJECTING = 'rejecting'
}
```

## 与传统方案的对比

### Spring Boot 的盲区

```java
// Spring Boot 典型做法：直接处理，无队列
@EventListener
public void handleEvent(MyEvent event) {
    // 直接处理，如果处理慢，事件堆积在内存
    // 无监控，无背压，直到 OOM
    process(event);
}
```

**问题**：
- 无消息队列，无法评估处理能力
- 生产者-消费者速率不匹配时直接崩溃
- 无降级策略，要么全处理，要么全拒绝

### Node.js EventEmitter 的盲区

```javascript
// EventEmitter：同步执行，无队列
emitter.on('event', (data) => {
    // 同步执行，如果处理慢，阻塞事件循环
    // 或者异步处理，但无队列管理，无背压
    process(data);
});
```

**问题**：
- 无内置队列，事件堆积导致内存泄漏
- 无背压机制，生产者不知道消费者跟不上
- 无优先级，关键消息可能被非关键消息淹没

### 我们的解决方案

```typescript
// 强制队列 + 盈余评估
const channel = createIPCChannel({
  queueCapacity: 10000,           // 必须指定
  targetSurplusRatio: 1.2,        // 目标盈余 20%
  backpressureStrategy: 'block',  // 背压策略
  
  // 自适应处理策略
  onSurplusChange: (metrics) => {
    if (metrics.surplusRatio < 0.5) {
      // 盈余不足，启动降级
      enableDegradedMode();
    }
  },
  
  // 消息优先级
  priorityLevels: 5,  // 0-4，0 最高优先级
});

// 发布消息时指定优先级
channel.publish('metrics', data, { priority: 4 });  // 低优先级，可丢弃
channel.publish('alarm', data, { priority: 0 });    // 高优先级，必须处理
```

## 架构优势

### 1. 可观测性

```
传统方案：黑盒，不知道系统负载
我们的方案：白盒，实时监控盈余系数

监控面板：
┌─────────────────────────────────────┐
│  消息队列状态                        │
│  ┌─────────────────────────────┐   │
│  │ 队列占用: ████████░░ 80%    │   │
│  │ 盈余系数: 0.85 ⚠️           │   │
│  │ 入队速率: 10,000 msg/s      │   │
│  │ 出队速率: 8,500 msg/s       │   │
│  │ 预计满队: 5.2 秒            │   │
│  └─────────────────────────────┘   │
│  策略: DEGRADED (降级模式)          │
└─────────────────────────────────────┘
```

### 2. 弹性伸缩

```typescript
// 根据盈余自动调整消费者数量
if (surplusRatio < 0.8) {
  // 处理能力不足，增加消费者
  await scaleUpConsumers();
} else if (surplusRatio > 2.0) {
  // 处理能力过剩，减少消费者
  await scaleDownConsumers();
}
```

### 3. 优雅降级

```typescript
// 根据盈余自动降级非关键消息
channel.setDegradationRules([
  { 
    condition: (metrics) => metrics.surplusRatio < 0.5,
    action: 'DROP_PRIORITY_ABOVE',
    threshold: 2  // 丢弃优先级 > 2 的消息
  },
  {
    condition: (metrics) => metrics.surplusRatio < 0.3,
    action: 'ONLY_PRIORITY_0'  // 只处理最高优先级
  }
]);
```

## 实现要点

### 核心类设计

```typescript
class MessageQueue<T> {
  private queue: PriorityQueue<T>;
  private metrics: QueueSurplusMetrics;
  private processor: MessageProcessor<T>;
  
  // 强制入队，触发背压检查
  enqueue(message: T, priority: number): boolean {
    if (this.isFull()) {
      return this.handleBackpressure(message);
    }
    
    this.queue.push(message, priority);
    this.updateMetrics();
    return true;
  }
  
  // 自适应出队
  async dequeue(): Promise<T | null> {
    const message = this.queue.pop();
    if (message) {
      await this.processor.process(message);
      this.updateMetrics();
    }
    return message;
  }
  
  // 实时盈余评估
  private updateMetrics(): void {
    this.metrics.enqueueRate = this.calculateEnqueueRate();
    this.metrics.dequeueRate = this.calculateDequeueRate();
    this.metrics.surplusRatio = 
      this.metrics.dequeueRate / this.metrics.enqueueRate;
    
    // 触发策略调整
    this.adjustStrategy();
  }
}
```

### 背压策略

```typescript
enum BackpressureStrategy {
  // 阻塞生产者（同步）
  BLOCK = 'block',
  
  // 丢弃新消息
  DROP = 'drop',
  
  // 抛出错误
  ERROR = 'error',
  
  // 丢弃低优先级消息
  DROP_LOW_PRIORITY = 'drop_low_priority',
  
  // 压缩合并消息
  COMPRESS = 'compress'
}
```

## 总结

| 维度 | Spring Boot | Node.js EventEmitter | 我们的方案 |
|------|-------------|---------------------|-----------|
| **消息队列** | ❌ 外部依赖 | ❌ 无 | ✅ **强制核心** |
| **盈余评估** | ❌ 无 | ❌ 无 | ✅ **实时监控** |
| **背压机制** | ⚠️ 需配置 | ❌ 无 | ✅ **内置策略** |
| **自适应处理** | ❌ 无 | ❌ 无 | ✅ **自动降级** |
| **优先级** | ⚠️ 需外部 MQ | ❌ 无 | ✅ **原生支持** |
| **可观测性** | ⚠️ 需额外工具 | ❌ 无 | ✅ **内置指标** |

**核心洞察**：

> 消息队列不是优化手段，而是**系统稳定性的必要基础设施**。
> 
> 没有队列，就无法评估生产者-消费者的速率匹配；
> 没有盈余评估，就无法预测系统何时会崩溃；
> 没有背压机制，就无法优雅地处理过载。
> 
> 这是 Spring Boot 和 Node.js 生态的共同盲区，
> 也是我们这个自定义 IPC 架构的核心价值所在。
