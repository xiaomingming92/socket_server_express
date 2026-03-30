# 意图决策架构改造步骤清单

## 概述

本指南描述如何将现有 BSD Socket 服务器逐步改造为**意图驱动的可审计系统**，融合 DSL、嵌入式演化策略和统一意图决策架构。

## 改造原则

1. **嵌入式演化**：不替换系统，改写规则
2. **渐进式迁移**：2.5步法，先命名化，再集中化，最后抽象化
3. **可审计性**：所有决策必须可追溯
4. **人机协同**：暴露接口给 AI 后端

---

## Phase 1: 基础设施准备（Week 1）

### 1.1 集成 IPC 通道

**目标**：替换 EventEmitter，使用自定义 IPCChannel

**文件**：`src/bsd/server.ts`

**步骤**：

```typescript
// 1. 导入 IPCChannel
import { createIPCChannel } from './ipc';

// 2. 修改 BSDSocketServer 类
export class BSDSocketServer {
  // 移除：extends EventEmitter
  // 添加：
  private ipcChannel = createIPCChannel({
    enableQueue: true,
    maxQueueSize: 1000,
    catchErrors: true,
  });
  
  // 3. 替换事件方法
  on(event: string, handler: Function) {
    return this.ipcChannel.subscribe(event, handler);
  }
  
  emit(event: string, payload: any) {
    this.ipcChannel.publish(event, payload);
  }
}
```

**验证**：
- [ ] 所有事件正常触发
- [ ] 取消订阅功能正常
- [ ] 性能无显著下降

### 1.2 集成消息缓冲池

**目标**：为高频消息提供缓冲和去重

**文件**：`src/bsd/socket.ts`

**步骤**：

```typescript
// 1. 导入缓冲池
import { createBufferPool } from './buffer-pool';

// 2. 在 BSDSocket 中添加缓冲池
export class BSDSocket {
  private messageBuffer = createBufferPool<Message>({
    capacity: 1000,
    keyGenerator: (msg) => `${msg.type}:${msg.timestamp}`,
    mergeStrategy: MergeStrategy.REPLACE,
    mode: 'buffer',
  });
  
  // 3. 修改消息处理
  handleMessage(data: Buffer) {
    const message = decodeMessage(data);
    this.messageBuffer.enqueue(message);
    // 异步处理缓冲池消息
    this.processBuffer();
  }
}
```

**验证**：
- [ ] 消息去重正常
- [ ] 缓冲池满时 LRU 淘汰正常
- [ ] 统计信息准确

### 1.3 创建意图类型定义

**目标**：定义系统支持的意图类型

**文件**：`src/intent/types.ts`（新建）

**内容**：

```typescript
// 意图类别
export enum IntentCategory {
  SECURITY = 'security',
  BUSINESS = 'business',
  OPERATIONS = 'operations',
  SYSTEM = 'system',
}

// Socket 相关意图
export enum SocketIntentType {
  CONNECTION_REQUEST = 'socket:connection:request',
  MESSAGE_RECEIVE = 'socket:message:receive',
  DISCONNECT = 'socket:disconnect',
  HEARTBEAT = 'socket:heartbeat',
}

// 安全相关意图
export enum SecurityIntentType {
  AUTHENTICATE = 'security:authenticate',
  AUTHORIZE = 'security:authorize',
  THREAT_DETECT = 'security:threat:detect',
  RATE_LIMIT = 'security:rate:limit',
}
```

**验证**：
- [ ] 类型定义完整
- [ ] 与现有业务匹配

---

## Phase 2: 意图决策核心集成（Week 2）

### 2.1 初始化意图决策核心

**目标**：将 IntentDecisionCore 接入系统

**文件**：`src/app.ts` 或 `src/server.ts`

**步骤**：

```typescript
// 1. 导入意图决策核心
import { intentDecisionCore } from './intent/intent-decision-core';

// 2. 系统启动时初始化
async function bootstrap() {
  // 注册决策域
  const securityDomain = new SecurityDecisionDomain();
  const businessDomain = new BusinessDecisionDomain();
  
  intentDecisionCore.registerDomain(securityDomain);
  intentDecisionCore.registerDomain(businessDomain);
  
  // 启动服务器
  const server = new BSDSocketServer();
  await server.start();
}
```

**验证**：
- [ ] 决策域注册成功
- [ ] 核心状态正常

### 2.2 创建 Socket 决策域

**目标**：将 Socket 事件转化为意图

**文件**：`src/intent/domains/socket-domain.ts`（新建）

**步骤**：

```typescript
export class SocketDecisionDomain implements DecisionDomain {
  name = 'socket';
  supportedIntents = [
    'socket:connection:request',
    'socket:message:receive',
    'socket:disconnect',
  ];
  
  async decide(intent: Intent): Promise<Decision> {
    switch (intent.type) {
      case 'socket:connection:request':
        return this.decideConnection(intent);
      case 'socket:message:receive':
        return this.decideMessageHandling(intent);
      default:
        return this.createDefaultDecision(intent);
    }
  }
  
  private async decideConnection(intent: Intent): Promise<Decision> {
    const { clientIp, headers } = intent.context.request;
    
    // 检查连接限制
    if (this.isConnectionLimitReached(clientIp)) {
      return {
        id: generateId(),
        intentId: intent.id,
        type: 'deny',
        reasons: ['Connection limit reached'],
        strategy: 'rate_limit',
        actions: [],
        metadata: { ... },
        timestamp: Date.now(),
      };
    }
    
    return {
      id: generateId(),
      intentId: intent.id,
      type: 'allow',
      reasons: ['Connection allowed'],
      strategy: 'accept',
      actions: [
        {
          type: 'accept_connection',
          target: 'socket-server',
          params: { clientIp },
          priority: 1,
        }
      ],
      metadata: { ... },
      timestamp: Date.now(),
    };
  }
}
```

**验证**：
- [ ] 意图识别正确
- [ ] 决策结果合理

### 2.3 改造 BSDSocketServer 使用意图

**目标**：将服务器事件转化为意图处理

**文件**：`src/bsd/server.ts`

**步骤**：

```typescript
export class BSDSocketServer {
  private intentCore = intentDecisionCore;
  
  async handleConnection(netSocket: NetSocket) {
    // 1. 创建连接意图
    const intent: Intent = {
      id: generateIntentId(),
      category: IntentCategory.SYSTEM,
      type: SocketIntentType.CONNECTION_REQUEST,
      name: 'Socket Connection Request',
      confidence: 1,
      parameters: {
        clientIp: netSocket.remoteAddress,
        port: netSocket.remotePort,
      },
      constraints: [
        {
          type: 'resource',
          description: 'Max connections limit',
          check: () => this.connections.size < this.options.maxConnections,
          onViolation: 'block',
        }
      ],
      priority: 80,
      timestamp: Date.now(),
      source: 'bsd-socket-server',
      context: {
        request: {
          requestId: generateId(),
          clientIp: netSocket.remoteAddress || 'unknown',
          path: '/socket/connect',
          method: 'CONNECT',
          params: {},
          headers: {},
          timestamp: Date.now(),
        },
        system: {
          serviceName: 'bsd-socket-server',
          instanceId: this.instanceId,
          load: this.getLoad(),
          health: 'healthy',
        }
      }
    };
    
    // 2. 提交意图决策
    const decision = await this.intentCore.processIntent(intent);
    
    // 3. 执行决策
    if (decision.type === 'allow') {
      await this.executeDecision(decision);
    } else {
      this.rejectConnection(netSocket, decision.reasons);
    }
  }
}
```

**验证**：
- [ ] 连接意图正常创建
- [ ] 决策流程完整执行
- [ ] 决策结果正确应用

---

## Phase 3: 安全决策域实现（Week 3）

### 3.1 迁移现有安全逻辑

**目标**：将安全层改造为决策域

**文件**：`src/intent/domains/security-domain.ts`（新建）

**步骤**：

```typescript
export class SecurityDecisionDomain implements DecisionDomain {
  name = 'security';
  supportedIntents = [
    'security:authenticate',
    'security:authorize',
    'security:threat:detect',
  ];
  
  // 复用现有安全组件
  private endpointObfuscator = new EndpointObfuscator();
  private userIdentifier = new UserIdentifier();
  private honeyPotService = new HoneyPotService();
  
  async decide(intent: Intent): Promise<Decision> {
    // 1. 端点混淆检查
    const endpointCheck = this.checkEndpoint(intent);
    if (!endpointCheck.valid) {
      return this.createBlockDecision(intent, ['Invalid endpoint']);
    }
    
    // 2. 用户身份识别
    const userTier = this.userIdentifier.identifyUser(intent.context);
    
    // 3. 意图分析
    const riskScore = this.analyzeRisk(intent, userTier);
    
    // 4. 决策
    if (riskScore > 70) {
      return this.createHoneyPotDecision(intent);
    } else if (riskScore > 40) {
      return this.createChallengeDecision(intent);
    }
    
    return this.createAllowDecision(intent);
  }
}
```

**验证**：
- [ ] 现有安全功能正常
- [ ] 决策结果符合预期

### 3.2 集成蜜罐服务

**目标**：对可疑请求返回虚假数据

**步骤**：

```typescript
private createHoneyPotDecision(intent: Intent): Decision {
  const fakeResponse = this.honeyPotService.getHoneyPotResponse(
    intent.context.request.path,
    intent.parameters
  );
  
  return {
    id: generateId(),
    intentId: intent.id,
    type: 'allow', // 看似允许，实际返回假数据
    reasons: ['HoneyPot engagement'],
    strategy: 'honeypot',
    actions: [
      {
        type: 'return_fake_data',
        target: 'response-handler',
        params: { data: fakeResponse },
        priority: 1,
      },
      {
        type: 'log_honeypot_access',
        target: 'audit-logger',
        params: { intent },
        priority: 2,
      }
    ],
    metadata: {
      latency: 0,
      confidence: 0.9,
      aiAssisted: false,
      humanOverride: false,
      isHoneyPot: true,
    },
    timestamp: Date.now(),
  };
}
```

**验证**：
- [ ] 蜜罐数据返回正常
- [ ] 攻击者无法识别

---

## Phase 4: BSD Socket 服务器改造（Week 4）

### 4.1 意图驱动的连接管理

**目标**：所有连接事件通过意图处理

**文件**：`src/bsd/server.ts`

**完整改造示例**：

```typescript
export class BSDSocketServer {
  private intentCore = intentDecisionCore;
  private ipcChannel = createIPCChannel();
  
  async start() {
    // 注册到意图核心
    this.registerIntentHandlers();
    
    this.server.on('connection', (socket) => {
      this.handleConnectionIntent(socket);
    });
  }
  
  private async handleConnectionIntent(netSocket: NetSocket) {
    const intent = this.createConnectionIntent(netSocket);
    const decision = await this.intentCore.processIntent(intent);
    
    // 广播决策事件（给 AI 后端）
    this.ipcChannel.publish('socket:decision', {
      intentId: intent.id,
      decisionId: decision.id,
      type: decision.type,
    });
    
    await this.executeSocketDecision(decision, netSocket);
  }
  
  private async executeSocketDecision(decision: Decision, netSocket: NetSocket) {
    for (const action of decision.actions) {
      switch (action.type) {
        case 'accept_connection':
          await this.acceptConnection(netSocket, action.params);
          break;
        case 'reject_connection':
          await this.rejectConnection(netSocket, action.params);
          break;
        case 'return_fake_data':
          await this.sendHoneyPotResponse(netSocket, action.params.data);
          break;
      }
    }
  }
}
```

**验证**：
- [ ] 服务器正常启动
- [ ] 连接意图完整处理
- [ ] 决策执行正确

### 4.2 意图驱动的消息处理

**目标**：消息接收通过意图处理

**步骤**：

```typescript
private async handleMessageIntent(socket: BSDSocket, data: Buffer) {
  const intent: Intent = {
    category: IntentCategory.BUSINESS,
    type: 'socket:message:receive',
    parameters: {
      socketId: socket.getId(),
      messageSize: data.length,
      messageType: this.parseMessageType(data),
    },
    context: {
      request: {
        requestId: generateId(),
        clientIp: socket.getRemoteAddress(),
        path: '/socket/message',
        method: 'MESSAGE',
        params: { data: data.toString('base64') },
        headers: {},
        timestamp: Date.now(),
      },
      user: await this.getUserContext(socket),
    }
  };
  
  const decision = await this.intentCore.processIntent(intent);
  
  if (decision.type === 'allow') {
    await this.processMessage(socket, data, decision);
  } else {
    await this.handleRejectedMessage(socket, decision);
  }
}
```

**验证**：
- [ ] 消息意图正常创建
- [ ] 消息处理流程完整

---

## Phase 5: DSL 表达层（Week 5-6）

### 5.1 创建意图 DSL

**目标**：用声明式 DSL 定义意图

**文件**：`config/intents/`（新建目录）

**示例**：`config/intents/socket-intents.yaml`

```yaml
intents:
  - id: socket-connection
    category: system
    type: socket:connection:request
    description: Socket连接请求
    constraints:
      - type: resource
        name: max_connections
        check: connections.count < 1000
        onViolation: block
      - type: permission
        name: ip_reputation
        check: ip.reputation > 50
        onViolation: challenge
    
  - id: message-processing
    category: business
    type: socket:message:receive
    description: 消息接收处理
    constraints:
      - type: resource
        name: message_rate
        check: message.rate < 100/min
        onViolation: throttle
      - type: business_rule
        name: message_size
        check: message.size < 1MB
        onViolation: reject
```

### 5.2 DSL 解析器

**文件**：`src/intent/dsl-parser.ts`（新建）

```typescript
export class IntentDSLParser {
  parseFromYAML(yamlContent: string): IntentDefinition[] {
    const config = yaml.parse(yamlContent);
    return config.intents.map(this.parseIntentDefinition);
  }
  
  private parseIntentDefinition(def: any): IntentDefinition {
    return {
      id: def.id,
      category: def.category,
      type: def.type,
      description: def.description,
      constraints: def.constraints.map(this.parseConstraint),
    };
  }
}
```

---

## Phase 6: 审计日志系统（Week 6）

### 6.1 审计日志记录器

**文件**：`src/audit/audit-logger.ts`（新建）

```typescript
export class AuditLogger {
  private logStream: WriteStream;
  
  recordIntent(intent: Intent) {
    this.log({
      type: 'intent_created',
      intentId: intent.id,
      category: intent.category,
      timestamp: Date.now(),
      context: this.sanitizeContext(intent.context),
    });
  }
  
  recordDecision(decision: Decision) {
    this.log({
      type: 'decision_made',
      decisionId: decision.id,
      intentId: decision.intentId,
      decisionType: decision.type,
      strategy: decision.strategy,
      reasons: decision.reasons,
      timestamp: Date.now(),
    });
  }
  
  recordExecution(decisionId: string, action: DecisionAction, result: any) {
    this.log({
      type: 'action_executed',
      decisionId,
      actionType: action.type,
      target: action.target,
      result,
      timestamp: Date.now(),
    });
  }
}
```

### 6.2 审计查询接口

```typescript
export class AuditQuery {
  async queryIntents(filter: IntentFilter): Promise<Intent[]> {
    // 查询意图历史
  }
  
  async queryDecisions(filter: DecisionFilter): Promise<Decision[]> {
    // 查询决策历史
  }
  
  async getDecisionChain(intentId: string): Promise<DecisionChain> {
    // 获取完整决策链路
  }
}
```

---

## Phase 7: AI 协同接口（Week 7）

### 7.1 暴露 IPC 事件

**目标**：让 AI 后端可以监听和干预

**文件**：`src/intent/ai-bridge.ts`（新建）

```typescript
export class AIBridge {
  private ipc = createIPCChannel();
  
  start() {
    // 广播意图事件给 AI
    intentDecisionCore.on('intent:recognized', (intent) => {
      this.ipc.publish('ai:intent:recognized', {
        intentId: intent.id,
        category: intent.category,
        type: intent.type,
        confidence: intent.confidence,
        timestamp: intent.timestamp,
      });
    });
    
    // 广播决策事件
    intentDecisionCore.on('decision:made', (decision) => {
      this.ipc.publish('ai:decision:made', {
        decisionId: decision.id,
        intentId: decision.intentId,
        type: decision.type,
        strategy: decision.strategy,
        timestamp: decision.timestamp,
      });
    });
    
    // 监听 AI 建议
    this.ipc.subscribe('ai:recommendation', (msg) => {
      intentDecisionCore.receiveAIRecommendation(msg.payload);
    });
    
    // 监听人工干预
    this.ipc.subscribe('human:override', (msg) => {
      intentDecisionCore.receiveHumanOverride(msg.payload);
    });
  }
}
```

### 7.2 AI 反馈循环

```typescript
// 决策效果反馈
intentDecisionCore.on('action:completed', async ({ decision, result }) => {
  const feedback = {
    decisionId: decision.id,
    success: result.success,
    latency: result.latency,
    resourceUsage: result.resourceUsage,
  };
  
  // 发送给 AI 后端用于模型优化
  aiBridge.sendFeedback(feedback);
});
```

---

## Phase 8: 嵌入式演化（持续）

### 8.1 渐进式迁移策略

**阶段 A：命名化（立即开始）**

```typescript
// ❌ 改造前
if (connections.size >= 1000) {
  socket.end();
}

// ✅ 改造后
if (isConnectionLimitReached(socket.remoteAddress)) {
  rejectConnection(socket, 'limit_reached');
}
```

**阶段 B：集中化（Week 2-3）**

```typescript
// 将条件判断集中到决策域
const decision = await securityDomain.decideConnection(intent);
```

**阶段 C：抽象化（Week 4+）**

```typescript
// 完整意图建模
const intent = createIntent('socket:connection:request', context);
const decision = await intentCore.processIntent(intent);
```

### 8.2 功能开关

```typescript
export class IntentFeatureFlags {
  // 渐进式启用意图决策
  static isIntentEnabled(intentType: string): boolean {
    const rollout = this.getRolloutPercentage(intentType);
    return Math.random() < rollout;
  }
  
  private static getRolloutPercentage(intentType: string): number {
    const rollouts: Record<string, number> = {
      'socket:connection:request': 0.1, // 10% 流量
      'socket:message:receive': 0.05,   // 5% 流量
    };
    return rollouts[intentType] || 0;
  }
}
```

---

## 验证清单

### 功能验证
- [ ] 服务器正常启动和运行
- [ ] 连接意图完整处理流程
- [ ] 消息意图完整处理流程
- [ ] 安全决策正常工作
- [ ] 蜜罐服务正常响应
- [ ] 审计日志完整记录
- [ ] IPC 事件正常广播

### 性能验证
- [ ] 决策延迟 < 10ms（P99）
- [ ] 吞吐量不低于改造前
- [ ] 内存使用增长 < 20%

### 可审计性验证
- [ ] 所有意图可追溯
- [ ] 所有决策可查询
- [ ] 完整链路可重建

### AI 协同验证
- [ ] AI 能接收意图事件
- [ ] AI 能发送决策建议
- [ ] 人工能覆盖决策

---

## 回滚策略

如果改造出现问题：

1. **功能开关回滚**：立即关闭意图决策，回退到原始逻辑
2. **版本回滚**：部署上一版本代码
3. **数据修复**：根据审计日志修复数据问题

---

## 总结

通过 8 个阶段的改造，系统将演进为：

```
DSL 声明式意图
    ↓
意图决策核心（可审计）
    ↓
多域决策协调（安全/业务/运维）
    ↓
能力对象输出
    ↓
组件消费执行
    ↓
反馈优化（AI 协同）
```

这是一个**自我演化的、可审计的、人机协同的**下一代软件架构！

---

## Phase 9: IntentDB - 意图数据库（Week 9-12）

### 9.1 为什么需要 IntentDB

**传统数据库的问题**：
- 数据是"死的"（被动查询）
- 无内置意图理解
- 无决策能力
- 无安全策略
- 无学习能力

**IntentDB 的核心创新**：
- 从"数据查询"到"意图理解"
- 从"静态索引"到"意图感知索引"
- 从"权限控制"到"蜜罐欺骗"
- 从"操作日志"到"决策链路"

### 9.2 IntentDB 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     IntentDB（意图数据库）                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Layer 1: 意图接口层                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 自然语言意图解析（NL→Intent）                      │   │
│  │  • 结构化意图定义（YAML/JSON DSL）                    │   │
│  │  • 意图版本管理（兼容性保证）                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  Layer 2: 意图执行引擎                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 意图→查询计划转换（IQL Parser）                    │   │
│  │  • 意图优化器（类似SQL优化器）                        │   │
│  │  • 意图缓存（热点意图预编译）                          │   │
│  │  • 意图→传统SQL/NoSQL查询转换（兼容层）                │   │
│  └─────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  Layer 3: 智能存储层                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 意图感知索引（根据意图模式自动优化）                │   │
│  │  • 自适应压缩（根据访问模式调整）                      │   │
│  │  • 预测性缓存（根据意图预测预加载）                    │   │
│  │  • 意图图谱存储（图数据库能力）                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  Layer 4: 安全存储层                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 蜜罐数据分区（攻击者隔离）                          │   │
│  │  • 审计日志链（不可篡改的决策链路）                    │   │
│  │  • 零知识证明（隐私保护查询）                          │   │
│  │  • 意图级加密（字段级细粒度加密）                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                              ↓                               │
│  Layer 5: 分布式共识层（可选）                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  • 意图共识（而非数据共识）                            │   │
│  │  • 跨节点意图协调                                      │   │
│  │  • 意图冲突解决                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 意图查询语言（IQL）

**文件**：`src/db/iql/`（新建目录）

**IQL 示例**：`examples/intent-queries.yaml`

```yaml
# 不是 SQL，而是业务意图
intent:
  id: user-behavior-analysis
  type: user:behavior:analyze
  description: 分析用户过去30天的行为模式
  parameters:
    userId: "user-123"
    timeframe: "last_30_days"
    focus: 
      - purchase_pattern
      - risk_assessment
      - churn_prediction
  constraints:
    - type: privacy
      level: "anonymized"  # 匿名化处理
    - type: performance
      max_latency: "100ms"
      max_cost: 1000  # 查询成本上限
  output:
    format: "decision_support"  # 决策支持格式
    include:
      - recommendations
      - anomalies
      - predictions
    exclude:
      - raw_data  # 不包含原始数据
```

**IQL Parser 实现**：`src/db/iql/parser.ts`

```typescript
export class IQLParser {
  parse(yamlContent: string): IntentQuery {
    const raw = yaml.parse(yamlContent);
    return this.validateAndTransform(raw);
  }
  
  private validateAndTransform(raw: any): IntentQuery {
    // 验证意图结构
    // 转换为目标查询计划
    return {
      id: raw.intent.id,
      type: raw.intent.type,
      parameters: raw.intent.parameters,
      constraints: this.parseConstraints(raw.intent.constraints),
      output: raw.intent.output,
    };
  }
}
```

### 9.4 意图感知索引

**文件**：`src/db/index/intent-index.ts`（新建）

```typescript
// 传统索引：基于数据值
// CREATE INDEX idx_user_age ON users(age);

// 意图索引：基于意图模式
export class IntentIndexManager {
  createIntentIndex(config: IntentIndexConfig): IntentIndex {
    return {
      name: config.name,
      intentPattern: config.pattern,  // 意图模式匹配
      autoOptimize: true,             // 自动优化
      learningEnabled: true,          // 机器学习优化
      
      // 根据历史意图查询自动调整索引结构
      async optimize(): Promise<void> {
        const patterns = await this.analyzeQueryPatterns();
        await this.rebuildIndex(patterns);
      }
    };
  }
}

// 使用示例
const purchasePredictionIndex = intentDB.createIntentIndex({
  name: 'idx_purchase_prediction',
  pattern: 'user:next_purchase:predict',
  triggeredBy: ['cart:add', 'browse:product', 'search:query'],
  using: 'model:v3',  // 使用机器学习模型
});
```

### 9.5 蜜罐数据分区

**文件**：`src/db/security/honey-pot-partition.ts`（新建）

```typescript
export class HoneyPotPartitionManager {
  constructor(config: HoneyPotConfig) {
    this.detectionEngine = new IntentAnomalyDetection();
    this.fakeDataGenerator = new FakeDataGenerator();
  }
  
  async query(query: DataQuery, context: QueryContext): Promise<DataResult> {
    // 1. 检测查询意图
    const intent = await this.detectQueryIntent(query, context);
    
    // 2. 判断是否为攻击者
    if (intent.riskScore > 0.7) {
      // 3. 返回蜜罐数据
      return this.fakeDataGenerator.generate({
        schema: query.targetSchema,
        seed: query.hash(),  // 确定性生成，保持一致性
        fakeRatio: 0.1,      // 10% 假数据
      });
    }
    
    // 4. 正常查询
    return this.realStorage.query(query);
  }
  
  private async detectQueryIntent(query: DataQuery, context: QueryContext): Promise<QueryIntent> {
    // 分析查询模式
    // 检测异常行为
    // 返回风险评分
    return this.detectionEngine.analyze(query, context);
  }
}
```

### 9.6 审计日志链

**文件**：`src/db/audit/chain.ts`（新建）

```typescript
export interface DataOperation {
  operationId: string;
  intentId: string;           // 关联业务意图
  decisionId: string;         // 关联决策
  queryHash: string;          // 查询哈希
  dataHash: string;           // 结果数据哈希
  previousHash: string;       // 链式结构（区块链式）
  timestamp: number;
  signature: string;          // 数字签名
  operator: string;           // 操作者身份
}

export class AuditChain {
  private chain: DataOperation[] = [];
  
  async record(operation: DataOperation): Promise<void> {
    // 计算前一个哈希
    const previousHash = this.chain.length > 0 
      ? this.chain[this.chain.length - 1].operationId 
      : '0';
    
    // 构建完整操作记录
    const fullOperation = {
      ...operation,
      previousHash,
      signature: await this.sign(operation),
    };
    
    // 添加到链
    this.chain.push(fullOperation);
    
    // 持久化
    await this.persist(fullOperation);
  }
  
  // 验证链完整性
  async verify(): Promise<boolean> {
    for (let i = 1; i < this.chain.length; i++) {
      if (this.chain[i].previousHash !== this.chain[i-1].operationId) {
        return false;  // 链断裂
      }
      if (!await this.verifySignature(this.chain[i])) {
        return false;  // 签名无效
      }
    }
    return true;
  }
  
  // 追溯完整链路：意图 → 决策 → 操作 → 数据
  async trace(intentId: string): Promise<DecisionChain> {
    return this.chain
      .filter(op => op.intentId === intentId)
      .map(op => ({
        intent: op.intentId,
        decision: op.decisionId,
        operation: op.operationId,
        data: op.dataHash,
        timestamp: op.timestamp,
      }));
  }
}
```

### 9.7 与意图决策运行时集成

**文件**：`src/db/client/intent-db-client.ts`（新建）

```typescript
export class IntentDBClient {
  constructor(
    private db: IntentDB,
    private intentCore: IntentDecisionCore
  ) {}
  
  async execute(dataIntent: DataIntent): Promise<DataResult> {
    // 1. 提交数据意图给决策核心
    const decision = await this.intentCore.processIntent({
      ...dataIntent,
      category: IntentCategory.DATA,
    });
    
    // 2. 根据决策执行数据操作
    if (decision.type === 'allow') {
      return await this.db.execute(decision.actions);
    } else if (decision.type === 'honeypot') {
      return await this.db.getHoneyPotData(dataIntent);
    } else {
      throw new DataAccessDeniedError(decision.reasons);
    }
  }
  
  // 自然语言查询接口
  async naturalLanguageQuery(nlQuery: string): Promise<DataResult> {
    // 1. NL → Intent
    const intent = await this.nlToIntent(nlQuery);
    
    // 2. 执行意图查询
    return this.execute(intent);
  }
  
  private async nlToIntent(nlQuery: string): Promise<DataIntent> {
    // 使用 NLP 模型解析自然语言
    // 转换为结构化意图
    return this.intentCore.parseNaturalLanguage(nlQuery);
  }
}
```

### 9.8 渐进式实现策略

**Phase A：意图查询层（3个月）**

```typescript
// 在现有 PostgreSQL/MongoDB 上封装意图层
class IntentQueryEngine {
  constructor(private underlyingDB: TraditionalDB) {}
  
  async executeIntent(intent: DataIntent): Promise<DataResult> {
    // 1. 意图解析
    const queryPlan = this.parseIntent(intent);
    
    // 2. 意图优化
    const optimizedPlan = this.optimize(queryPlan);
    
    // 3. 转换为传统查询
    const sql = this.toSQL(optimizedPlan);
    
    // 4. 执行
    const result = await this.underlyingDB.query(sql);
    
    // 5. 格式化为意图输出
    return this.formatResult(result, intent.output);
  }
}
```

**Phase B：意图感知存储（6个月）**

```rust
// Rust 实现的意图感知存储引擎
#[napi]
pub struct IntentStorageEngine {
    index_manager: IntentIndexManager,
    cache_manager: PredictiveCache,
    compression: AdaptiveCompression,
    honey_pot: HoneyPotPartition,
}

#[napi]
impl IntentStorageEngine {
    #[napi]
    pub async fn execute_intent(&self, intent: IntentQuery) -> Result<DataResult> {
        // 原生意图执行，无需转换
    }
}
```

**Phase C：完整 IntentDB（12个月）**

```
原生意图数据库，无需底层 SQL/NoSQL
完全为意图驱动架构设计
```

### 9.9 IntentDB 验证清单

#### 功能验证
- [ ] IQL 解析正常
- [ ] 意图→查询转换正确
- [ ] 意图感知索引有效
- [ ] 蜜罐分区正常工作
- [ ] 审计链完整性可验证
- [ ] 自然语言查询可用

#### 性能验证
- [ ] 意图解析延迟 < 5ms
- [ ] 查询性能不低于底层数据库
- [ ] 意图缓存命中率 > 80%
- [ ] 预测性缓存有效

#### 安全验证
- [ ] 攻击者查询返回假数据
- [ ] 真实用户查询返回真数据
- [ ] 审计链不可篡改
- [ ] 意图级加密有效

#### 与运行时集成验证
- [ ] 数据意图与业务意图协同
- [ ] 完整意图→决策→数据链路
- [ ] AI 能优化数据查询

---

## 全栈意图化架构（最终形态）

```
┌─────────────────────────────────────────────────────────────────┐
│                         应用生态层                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  桌面   │ │  移动   │ │  车载   │ │  IoT   │ │  VR/AR  │   │
│  │ Flutter │ │ Flutter │ │ Custom │ │  Lite  │ │  Unity  │   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │
│       └─────────────┴─────────┴─────────┴─────────────┘        │
│                         Intent SDK                              │
├─────────────────────────────────────────────────────────────────┤
│                      意图决策运行时（Node/Rust）                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              IntentDecisionCore                          │   │
│  │  • 业务意图决策（安全/业务/运维）                         │   │
│  │  • 数据意图决策（IntentDB 客户端）                        │   │
│  │  • AI 协同接口                                           │   │
│  │  • 审计日志                                              │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                      IntentDB（意图数据库）                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│  │  IQL 接口层  │ │ 意图执行引擎 │ │ 智能存储层   │             │
│  └─────────────┘ └─────────────┘ └─────────────┘             │
│  ┌─────────────┐ ┌─────────────┐                             │
│  │ 安全存储层   │ │ 分布式共识   │                             │
│  └─────────────┘ └─────────────┘                             │
├─────────────────────────────────────────────────────────────────┤
│                      硬件抽象层（Rust/Node NAPI）                │
│              • 进程管理、内存管理、设备管理                        │
├─────────────────────────────────────────────────────────────────┤
│                      物理驱动层（Rust/C）                        │
│              • CPU/GPU/NPU/存储/网络驱动                         │
└─────────────────────────────────────────────────────────────────┘
```

这是一个**全栈意图化**的下一代软件架构！
