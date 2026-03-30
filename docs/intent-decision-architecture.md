# 统一意图决策架构

## 核心设计理念

> **"意图决策不是防御层的组件，而是系统架构的核心中枢。"**

> **"所有系统行为都应该是意图驱动的，通过统一的决策引擎协调。"**

## 架构定位

```
传统架构：                          意图驱动架构：
┌─────────────┐                     ┌─────────────────────────────┐
│   客户端     │                     │           客户端             │
└──────┬──────┘                     └──────────────┬──────────────┘
       │                                          │
       ▼                                          ▼
┌─────────────┐                     ┌─────────────────────────────┐
│  API 网关    │                     │     意图决策引擎（核心）      │
│  （路由）    │                     │  ┌───────────────────────┐  │
└──────┬──────┘                     │  │ 1. 意图识别            │  │
       │                            │  │ 2. 决策路由            │  │
       ▼                            │  │ 3. 策略执行            │  │
┌─────────────┐                     │  │ 4. AI 协同             │  │
│  业务服务    │                     │  └───────────────────────┘  │
│  （处理）    │                     └──────────────┬──────────────┘
└─────────────┘                                    │
                                          ┌────────┴────────┐
                                          ▼                 ▼
                              ┌───────────────┐   ┌───────────────┐
                              │   安全决策域   │   │   业务决策域   │
                              │  • 威胁识别    │   │  • 订单路由    │
                              │  • 访问控制    │   │  • 库存分配    │
                              │  • 蜜罐策略    │   │  • 价格策略    │
                              └───────────────┘   └───────────────┘
                                        │                 │
                              ┌─────────┴─────────┐       │
                              ▼                   ▼       ▼
                    ┌───────────────┐   ┌───────────────┐
                    │   运维决策域   │   │   用户决策域   │
                    │  • 负载均衡    │   │  • 个性化     │
                    │  • 故障转移    │   │  • 推荐       │
                    │  • 弹性伸缩    │   │  • 通知       │
                    └───────────────┘   └───────────────┘
```

## 核心组件

### 1. 意图决策核心 (`IntentDecisionCore`)

**位置**: `src/intent/intent-decision-core.ts`

**职责**:
- 接收所有系统意图（安全、业务、运维、用户）
- 路由到对应决策域
- 协调 AI 建议和人工干预
- 执行决策动作
- 广播决策事件

**关键特性**:
```typescript
// 多域决策协调
async processIntent(intent: Intent): Promise<Decision> {
  // 1. 意图识别
  // 2. 路由到决策域
  // 3. 获取 AI 建议
  // 4. 综合决策
  // 5. 执行决策
  // 6. 反馈结果
}

// AI 协同接口
receiveAIRecommendation(recommendation: AIRecommendation)
receiveHumanOverride(override: HumanOverride)

// IPC 集成
broadcastIntent(intent: Intent)
broadcastDecision(decision: Decision)
```

### 2. 决策域接口 (`DecisionDomain`)

**职责**:
- 实现特定领域的决策逻辑
- 注册到意图决策核心
- 提供域状态信息

**实现示例**:
```typescript
// 安全决策域
class SecurityDecisionDomain implements DecisionDomain {
  name = 'security'
  supportedIntents = ['security:threat_detect', 'security:access_control']
  
  async decide(intent: Intent): Promise<Decision> {
    // 威胁识别、访问控制、蜜罐策略
  }
}

// 业务决策域
class BusinessDecisionDomain implements DecisionDomain {
  name = 'business'
  supportedIntents = ['order:route', 'inventory:allocate', 'pricing:calculate']
  
  async decide(intent: Intent): Promise<Decision> {
    // 订单路由、库存分配、价格策略
  }
}
```

### 3. AI 协同接口

**职责**:
- 暴露意图事件给 AI 后端
- 接收 AI 决策建议
- 支持实时调整策略

**IPC 事件**:
```typescript
// 意图识别事件
intent:recognized → {
  intentId, category, type, confidence, timestamp
}

// 决策结果事件
decision:made → {
  decisionId, intentId, type, strategy, timestamp
}

// AI 建议请求
ai:recommendation:request ← {
  intentId, intent, timestamp
}

// AI 建议响应
ai:recommendation:response → {
  intentId, recommendation
}

// 人工干预
human:override ← {
  decisionId, action, operator, reason
}
```

## 意图类型体系

```
IntentCategory (意图类别)
├── SECURITY (安全意图)
│   ├── threat:detect (威胁检测)
│   ├── access:control (访问控制)
│   ├── fraud:detect (欺诈检测)
│   └── honeypot:engage (蜜罐交互)
│
├── BUSINESS (业务意图)
│   ├── order:route (订单路由)
│   ├── inventory:allocate (库存分配)
│   ├── pricing:calculate (价格计算)
│   ├── payment:process (支付处理)
│   └── recommend:products (商品推荐)
│
├── OPERATIONS (运维意图)
│   ├── scaling:decide (扩缩容决策)
│   ├── failover:execute (故障转移)
│   ├── alert:route (告警路由)
│   └── resource:optimize (资源优化)
│
├── USER (用户意图)
│   ├── personalization:content (个性化内容)
│   ├── notification:send (通知发送)
│   └── preference:learn (偏好学习)
│
└── SYSTEM (系统意图)
    ├── config:update (配置更新)
    ├── migration:plan (迁移规划)
    └── backup:schedule (备份调度)
```

## 决策流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        意图决策流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 意图输入                                                      │
│     ┌─────────────────────────────────────────────────────┐     │
│     │ Intent {                                            │     │
│     │   id: 'intent-123',                                 │     │
│     │   category: 'BUSINESS',                             │     │
│     │   type: 'order:route',                              │     │
│     │   parameters: {...},                                │     │
│     │   context: {...}                                    │     │
│     │ }                                                   │     │
│     └─────────────────────────────────────────────────────┘     │
│                          ↓                                       │
│  2. 意图广播（给 AI 后端）                                         │
│     IPC: intent:recognized → AI 后端实时分析                      │
│                          ↓                                       │
│  3. 决策域路由                                                    │
│     order:route → BusinessDecisionDomain                        │
│                          ↓                                       │
│  4. 域内决策                                                      │
│     ┌─────────────────────────────────────────────────────┐     │
│     │ 订单路由逻辑：                                       │     │
│     │ - 检查库存分布                                       │     │
│     │ - 选择最优仓库                                       │     │
│     │ - 确定处理队列                                       │     │
│     │ - 生成执行动作                                       │     │
│     └─────────────────────────────────────────────────────┘     │
│                          ↓                                       │
│  5. AI 建议（异步）                                               │
│     ← ai:recommendation:request                                  │
│     → ai:recommendation:response (如果置信度 > 0.8)              │
│                          ↓                                       │
│  6. 人工干预检查                                                  │
│     检查是否有待处理的 override 指令                              │
│                          ↓                                       │
│  7. 综合决策                                                      │
│     合并域决策 + AI 建议 + 人工干预                                │
│                          ↓                                       │
│  8. 决策广播                                                      │
│     IPC: decision:made → 各服务订阅处理                          │
│                          ↓                                       │
│  9. 执行决策                                                      │
│     按优先级执行决策动作：                                         │
│     - reserve_inventory (priority: 1)                            │
│     - create_order (priority: 2)                                 │
│     - notify_user (priority: 3)                                  │
│                          ↓                                       │
│  10. 反馈收集                                                     │
│     收集执行结果，用于优化决策策略                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 人机协同机制

### AI 后端集成

```typescript
// AI 后端订阅意图事件
ipcChannel.subscribe('intent:recognized', async (msg) => {
  const intent = msg.payload;
  
  // AI 分析意图
  const analysis = await aiEngine.analyze(intent);
  
  // 生成建议
  const recommendation: AIRecommendation = {
    id: 'ai-rec-123',
    intentId: intent.id,
    type: analysis.risk > 0.7 ? 'reject' : 'approve',
    suggestion: analysis.explanation,
    confidence: analysis.confidence,
    reasons: analysis.reasons,
    proposedDecision: {
      type: analysis.risk > 0.7 ? 'deny' : 'allow',
      strategy: 'ai_assisted'
    }
  };
  
  // 发送建议给意图决策核心
  ipcChannel.publish('ai:recommendation', recommendation);
});
```

### 人工控制台

```typescript
// 人工干预示例
const override: HumanOverride = {
  id: 'override-123',
  decisionId: 'decision-456',
  action: 'reject',
  params: { reason: 'Suspicious pattern detected' },
  operator: 'security-admin',
  reason: 'Manual review required',
  timestamp: Date.now()
};

// 发送给意图决策核心
intentDecisionCore.receiveHumanOverride(override);
```

## 业务决策示例

### 订单路由决策

```typescript
// 意图定义
const orderRouteIntent: OrderRouteIntent = {
  id: 'intent-order-123',
  category: IntentCategory.BUSINESS,
  type: 'order:route',
  name: 'Order Routing',
  confidence: 0.95,
  parameters: {
    orderId: 'ORD-2024-001',
    userId: 'user-123',
    amount: 999.99,
    region: 'east',
    priority: 'high',
    items: [
      { sku: 'SKU-001', quantity: 2 },
      { sku: 'SKU-002', quantity: 1 }
    ]
  },
  constraints: [
    {
      type: 'business_rule',
      description: 'High priority orders must be processed within 1 hour',
      check: (ctx) => ctx.business?.priority === 'high',
      onViolation: 'escalate'
    }
  ],
  priority: 90,
  timestamp: Date.now(),
  source: 'order-service',
  context: {
    request: { ... },
    user: { tier: 'registered', reputation: 95 },
    business: { businessType: 'ecommerce' },
    system: { load: 0.3, health: 'healthy' }
  }
};

// 决策结果
const decision: Decision = {
  id: 'decision-456',
  intentId: 'intent-order-123',
  type: 'allow',
  reasons: [
    'Selected warehouse: warehouse-east based on region east',
    'Routed to priority-queue due to high priority'
  ],
  strategy: 'optimal_warehouse_selection',
  actions: [
    {
      type: 'reserve_inventory',
      target: 'inventory-service',
      params: { orderId: 'ORD-2024-001', items: [...], warehouse: 'warehouse-east' },
      priority: 1
    },
    {
      type: 'create_order',
      target: 'order-service',
      params: { orderId: 'ORD-2024-001', queue: 'priority-queue' },
      priority: 2
    },
    {
      type: 'notify_user',
      target: 'notification-service',
      params: { userId: 'user-123', message: 'Order created...' },
      priority: 3
    }
  ],
  metadata: {
    latency: 15,
    confidence: 0.95,
    aiAssisted: false,
    humanOverride: false
  },
  timestamp: Date.now()
};
```

## 安全与业务的统一

```
传统分离：                          意图统一：
┌─────────────┐                     ┌─────────────────────────────┐
│  安全层      │                     │      意图决策引擎            │
│  （拦截）    │                     │  ┌───────────────────────┐  │
└──────┬──────┘                     │  │ 安全意图 → 安全决策    │  │
       │                            │  │   • 威胁识别           │  │
       │ 拦截/放行                   │  │   • 访问控制           │  │
       ▼                            │  │   • 蜜罐策略           │  │
┌─────────────┐                     │  └───────────────────────┘  │
│  业务层      │                     │  ┌───────────────────────┐  │
│  （处理）    │                     │  │ 业务意图 → 业务决策    │  │
└─────────────┘                     │  │   • 订单路由           │  │
                                    │  │   • 库存分配           │  │
                                    │  │   • 价格策略           │  │
                                    │  └───────────────────────┘  │
                                    │                              │
                                    │  统一决策、统一执行、统一反馈  │
                                    └─────────────────────────────┘

优势：
1. 安全决策可以影响业务决策（如：风险高的订单延迟处理）
2. 业务上下文可以辅助安全决策（如：VIP 用户降低风控阈值）
3. 统一的可观测性（完整的意图-决策-执行链路）
4. 统一的 AI 协同（一个 AI 后端处理所有决策）
```

## 性能优化

| 优化点 | 策略 | 效果 |
|--------|------|------|
| 决策缓存 | 缓存高频意图的决策结果 | 减少重复计算 |
| 异步 AI | AI 建议异步获取，不阻塞主流程 | 降低延迟 |
| 批量处理 | 批量执行决策动作 | 提高吞吐量 |
| 采样分析 | 只对部分意图进行 AI 分析 | 降低 AI 负载 |
| 本地决策 | 简单意图本地快速决策 | 减少 IPC 开销 |

## 总结

```
意图决策架构的核心价值：

1. 统一抽象
   - 所有系统行为抽象为"意图"
   - 统一的决策接口
   - 统一的执行框架

2. 智能协同
   - AI 后端实时分析
   - 人工干预随时介入
   - 决策策略持续优化

3. 灵活扩展
   - 新决策域即插即用
   - 新业务意图快速支持
   - 新 AI 模型无缝集成

4. 可观测性
   - 完整的意图链路追踪
   - 决策效果量化评估
   - 系统行为透明可控

这是系统架构的范式升级：
从"功能驱动"到"意图驱动"
从"分散决策"到"统一决策"
从"静态规则"到"智能协同"
```
