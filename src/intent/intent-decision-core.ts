/**
 * 统一意图决策核心 - 系统架构中枢
 * 
 * 核心设计理念：
 * 1. **意图决策是系统架构核心**，不只是防御层
 * 2. **多域决策**：安全、业务、运维统一协调
 * 3. **AI 协同**：暴露接口给 AI 后端，人机协同决策
 * 4. **实时调整**：根据反馈动态优化决策策略
 * 
 * 架构位置：
 * - 位于所有子系统之上
 * - 接收所有请求和事件
 * - 协调各子系统行为
 * - 暴露接口给 AI/人工干预
 */

import { EventEmitter } from 'events';
import { IPCChannel, createIPCChannel, IPCMessage } from '../bsd/ipc';

// ==================== 核心类型定义 ====================

/**
 * 意图类型枚举
 */
export enum IntentCategory {
  /** 安全意图 */
  SECURITY = 'security',
  /** 业务意图 */
  BUSINESS = 'business',
  /** 运维意图 */
  OPERATIONS = 'operations',
  /** 用户意图 */
  USER = 'user',
  /** 系统意图 */
  SYSTEM = 'system',
}

/**
 * 意图定义
 */
export interface Intent {
  /** 意图ID */
  id: string;
  /** 意图类别 */
  category: IntentCategory;
  /** 意图类型 */
  type: string;
  /** 意图名称 */
  name: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 意图参数 */
  parameters: Record<string, any>;
  /** 约束条件 */
  constraints: IntentConstraint[];
  /** 优先级 0-100 */
  priority: number;
  /** 时间戳 */
  timestamp: number;
  /** 来源 */
  source: string;
  /** 上下文 */
  context: IntentContext;
}

/**
 * 意图约束
 */
export interface IntentConstraint {
  /** 约束类型 */
  type: 'time' | 'resource' | 'permission' | 'dependency' | 'business_rule';
  /** 约束描述 */
  description: string;
  /** 约束检查函数 */
  check: (context: IntentContext) => boolean | Promise<boolean>;
  /** 违反时的处理 */
  onViolation: 'block' | 'warn' | 'escalate';
}

/**
 * 意图上下文
 */
export interface IntentContext {
  /** 请求上下文 */
  request?: RequestContext;
  /** 用户上下文 */
  user?: UserContext;
  /** 业务上下文 */
  business?: BusinessContext;
  /** 系统上下文 */
  system?: SystemContext;
  /** 环境上下文 */
  environment?: EnvironmentContext;
}

/**
 * 请求上下文
 */
export interface RequestContext {
  requestId: string;
  clientIp: string;
  path: string;
  method: string;
  params: Record<string, any>;
  headers: Record<string, string>;
  timestamp: number;
}

/**
 * 用户上下文
 */
export interface UserContext {
  userId?: string;
  sessionId?: string;
  tier: 'registered' | 'guest' | 'suspected' | 'attacker';
  reputation: number;
  history: BehaviorRecord[];
}

/**
 * 业务上下文
 */
export interface BusinessContext {
  businessType: string;
  businessId?: string;
  transactionId?: string;
  relatedEntities: string[];
}

/**
 * 系统上下文
 */
export interface SystemContext {
  serviceName: string;
  instanceId: string;
  load: number;
  health: 'healthy' | 'degraded' | 'unhealthy';
}

/**
 * 环境上下文
 */
export interface EnvironmentContext {
  region: string;
  az: string;
  timeOfDay: number;
  dayOfWeek: number;
  isPeakTime: boolean;
}

/**
 * 行为记录
 */
export interface BehaviorRecord {
  timestamp: number;
  action: string;
  result: 'success' | 'failure' | 'blocked';
  metadata?: Record<string, any>;
}

/**
 * 决策结果
 */
export interface Decision {
  /** 决策ID */
  id: string;
  /** 对应意图ID */
  intentId: string;
  /** 决策类型 */
  type: 'allow' | 'deny' | 'challenge' | 'defer' | 'escalate';
  /** 决策原因 */
  reasons: string[];
  /** 决策策略 */
  strategy: string;
  /** 执行动作 */
  actions: DecisionAction[];
  /** 决策元数据 */
  metadata: {
    latency: number;
    confidence: number;
    aiAssisted: boolean;
    humanOverride: boolean;
  };
  /** 时间戳 */
  timestamp: number;
}

/**
 * 决策动作
 */
export interface DecisionAction {
  /** 动作类型 */
  type: string;
  /** 目标服务 */
  target: string;
  /** 动作参数 */
  params: Record<string, any>;
  /** 执行优先级 */
  priority: number;
}

/**
 * 决策域接口
 */
export interface DecisionDomain {
  /** 域名称 */
  name: string;
  /** 支持的意图类型 */
  supportedIntents: string[];
  /** 决策函数 */
  decide(intent: Intent): Promise<Decision>;
  /** 获取域状态 */
  getStatus(): DomainStatus;
}

/**
 * 域状态
 */
export interface DomainStatus {
  name: string;
  healthy: boolean;
  load: number;
  lastDecision: number;
}

/**
 * AI 决策建议
 */
export interface AIRecommendation {
  /** 建议ID */
  id: string;
  /** 对应意图ID */
  intentId: string;
  /** 建议类型 */
  type: 'approve' | 'reject' | 'modify' | 'escalate';
  /** 建议内容 */
  suggestion: string;
  /** 置信度 */
  confidence: number;
  /** 原因 */
  reasons: string[];
  /** 建议的决策 */
  proposedDecision?: Partial<Decision>;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 人工干预指令
 */
export interface HumanOverride {
  /** 指令ID */
  id: string;
  /** 对应决策ID */
  decisionId: string;
  /** 操作类型 */
  action: 'approve' | 'reject' | 'modify' | 'block_user' | 'unblock_user';
  /** 操作参数 */
  params: Record<string, any>;
  /** 操作人 */
  operator: string;
  /** 原因 */
  reason: string;
  /** 时间戳 */
  timestamp: number;
}

// ==================== 统一意图决策引擎 ====================

/**
 * 统一意图决策引擎
 * 
 * 系统架构核心中枢，协调所有决策域
 */
export class IntentDecisionCore extends EventEmitter {
  /** 决策域注册表 */
  private domains: Map<string, DecisionDomain> = new Map();
  
  /** IPC 通道 - 与 AI 后端通信 */
  private ipcChannel: IPCChannel;
  
  /** 意图历史 */
  private intentHistory: Map<string, Intent> = new Map();
  
  /** 决策历史 */
  private decisionHistory: Map<string, Decision> = new Map();
  
  /** AI 建议缓存 */
  private aiRecommendations: Map<string, AIRecommendation> = new Map();
  
  /** 配置 */
  private config: {
    aiEnabled: boolean;
    humanOverrideEnabled: boolean;
    maxHistorySize: number;
    defaultTimeout: number;
  };

  constructor(config?: Partial<IntentDecisionCore['config']>) {
    super();
    
    this.config = {
      aiEnabled: true,
      humanOverrideEnabled: true,
      maxHistorySize: 10000,
      defaultTimeout: 5000,
      ...config,
    };
    
    // 初始化 IPC 通道
    this.ipcChannel = createIPCChannel({
      enableQueue: true,
      maxQueueSize: 1000,
      catchErrors: true,
    });
    
    // 设置 IPC 事件监听
    this.setupIPCHandlers();
  }

  /**
   * 注册决策域
   */
  registerDomain(domain: DecisionDomain): void {
    this.domains.set(domain.name, domain);
    this.emit('domain:registered', { domain: domain.name });
  }

  /**
   * 注销决策域
   */
  unregisterDomain(name: string): void {
    this.domains.delete(name);
    this.emit('domain:unregistered', { domain: name });
  }

  /**
   * 处理意图 - 核心入口
   * 
   * 流程：
   * 1. 意图识别
   * 2. 路由到对应决策域
   * 3. 获取 AI 建议（如果启用）
   * 4. 综合决策
   * 5. 执行决策
   * 6. 反馈结果
   */
  async processIntent(intent: Intent): Promise<Decision> {
    const startTime = Date.now();
    
    // 1. 记录意图
    this.intentHistory.set(intent.id, intent);
    this.cleanupHistory();
    
    // 2. 广播意图事件（给 AI 后端）
    this.broadcastIntent(intent);
    
    // 3. 路由到决策域
    const domain = this.routeToDomain(intent);
    if (!domain) {
      return this.createFallbackDecision(intent, 'No suitable decision domain');
    }
    
    // 4. 获取 AI 建议（异步）
    let aiRecommendation: AIRecommendation | undefined;
    if (this.config.aiEnabled) {
      aiRecommendation = await this.getAIRecommendation(intent);
    }
    
    // 5. 执行决策
    let decision = await domain.decide(intent);
    
    // 6. 应用 AI 建议（如果置信度高）
    if (aiRecommendation && aiRecommendation.confidence > 0.8) {
      decision = this.applyAIRecommendation(decision, aiRecommendation);
    }
    
    // 7. 检查人工干预
    if (this.config.humanOverrideEnabled) {
      const override = await this.checkHumanOverride(decision);
      if (override) {
        decision = this.applyHumanOverride(decision, override);
      }
    }
    
    // 8. 记录决策
    decision.metadata.latency = Date.now() - startTime;
    this.decisionHistory.set(decision.id, decision);
    
    // 9. 广播决策结果
    this.broadcastDecision(decision);
    
    // 10. 执行决策动作
    await this.executeDecision(decision);
    
    return decision;
  }

  /**
   * 路由到决策域
   */
  private routeToDomain(intent: Intent): DecisionDomain | undefined {
    // 根据意图类别和类型选择决策域
    for (const domain of this.domains.values()) {
      if (domain.supportedIntents.includes(intent.type)) {
        return domain;
      }
    }
    
    // 默认路由：根据类别
    const categoryMap: Record<IntentCategory, string> = {
      [IntentCategory.SECURITY]: 'security',
      [IntentCategory.BUSINESS]: 'business',
      [IntentCategory.OPERATIONS]: 'operations',
      [IntentCategory.USER]: 'user',
      [IntentCategory.SYSTEM]: 'system',
    };
    
    return this.domains.get(categoryMap[intent.category]);
  }

  /**
   * 获取 AI 建议
   */
  private async getAIRecommendation(intent: Intent): Promise<AIRecommendation | undefined> {
    // 通过 IPC 向 AI 后端请求建议
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(undefined);
      }, 1000); // 1秒超时
      
      // 发送请求给 AI 后端
      this.ipcChannel.publish('ai:recommendation:request', {
        intentId: intent.id,
        intent: intent,
        timestamp: Date.now(),
      });
      
      // 监听 AI 响应
      const unsubscribe = this.ipcChannel.subscribe('ai:recommendation:response', (msg) => {
        if (msg.payload.intentId === intent.id) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(msg.payload.recommendation);
        }
      });
    });
  }

  /**
   * 应用 AI 建议
   */
  private applyAIRecommendation(decision: Decision, recommendation: AIRecommendation): Decision {
    if (recommendation.type === 'modify' && recommendation.proposedDecision) {
      return {
        ...decision,
        ...recommendation.proposedDecision,
        metadata: {
          ...decision.metadata,
          aiAssisted: true,
        },
      };
    }
    
    return {
      ...decision,
      metadata: {
        ...decision.metadata,
        aiAssisted: true,
      },
    };
  }

  /**
   * 检查人工干预
   */
  private async checkHumanOverride(decision: Decision): Promise<HumanOverride | undefined> {
    // 检查是否有待处理的人工干预指令
    // 实际实现中可能查询数据库或缓存
    return undefined;
  }

  /**
   * 应用人工干预
   */
  private applyHumanOverride(decision: Decision, override: HumanOverride): Decision {
    return {
      ...decision,
      type: override.action === 'approve' ? 'allow' : 
            override.action === 'reject' ? 'deny' : 'escalate',
      metadata: {
        ...decision.metadata,
        humanOverride: true,
      },
    };
  }

  /**
   * 执行决策
   */
  private async executeDecision(decision: Decision): Promise<void> {
    // 按优先级排序执行动作
    const sortedActions = decision.actions.sort((a, b) => a.priority - b.priority);
    
    for (const action of sortedActions) {
      try {
        await this.executeAction(action);
      } catch (error) {
        this.emit('action:error', { decision, action, error });
      }
    }
  }

  /**
   * 执行单个动作
   */
  private async executeAction(action: DecisionAction): Promise<void> {
    // 通过 IPC 发送给对应服务
    this.ipcChannel.publish(`service:${action.target}:execute`, {
      action: action.type,
      params: action.params,
      timestamp: Date.now(),
    });
  }

  /**
   * 广播意图事件
   */
  private broadcastIntent(intent: Intent): void {
    this.ipcChannel.publish('intent:recognized', {
      intentId: intent.id,
      category: intent.category,
      type: intent.type,
      confidence: intent.confidence,
      timestamp: intent.timestamp,
    });
  }

  /**
   * 广播决策结果
   */
  private broadcastDecision(decision: Decision): void {
    this.ipcChannel.publish('decision:made', {
      decisionId: decision.id,
      intentId: decision.intentId,
      type: decision.type,
      strategy: decision.strategy,
      timestamp: decision.timestamp,
    });
  }

  /**
   * 设置 IPC 事件处理器
   */
  private setupIPCHandlers(): void {
    // 监听 AI 建议
    this.ipcChannel.subscribe('ai:recommendation', (msg) => {
      const recommendation = msg.payload as AIRecommendation;
      this.aiRecommendations.set(recommendation.intentId, recommendation);
      this.emit('ai:recommendation', recommendation);
    });
    
    // 监听人工干预
    this.ipcChannel.subscribe('human:override', (msg) => {
      const override = msg.payload as HumanOverride;
      this.emit('human:override', override);
    });
    
    // 监听服务反馈
    this.ipcChannel.subscribe('service:feedback', (msg) => {
      this.emit('service:feedback', msg.payload);
    });
  }

  /**
   * 接收人工干预指令（外部调用）
   */
  receiveHumanOverride(override: HumanOverride): void {
    this.ipcChannel.publish('human:override', override);
  }

  /**
   * 接收 AI 建议（外部调用）
   */
  receiveAIRecommendation(recommendation: AIRecommendation): void {
    this.ipcChannel.publish('ai:recommendation', recommendation);
  }

  /**
   * 获取系统状态
   */
  getStatus(): {
    domains: DomainStatus[];
    intentQueueSize: number;
    decisionHistorySize: number;
    aiRecommendationsSize: number;
  } {
    return {
      domains: Array.from(this.domains.values()).map(d => d.getStatus()),
      intentQueueSize: this.intentHistory.size,
      decisionHistorySize: this.decisionHistory.size,
      aiRecommendationsSize: this.aiRecommendations.size,
    };
  }

  /**
   * 获取意图统计
   */
  getIntentStats(): {
    byCategory: Record<IntentCategory, number>;
    byType: Record<string, number>;
    averageConfidence: number;
    averageLatency: number;
  } {
    const intents = Array.from(this.intentHistory.values());
    
    const byCategory: Record<IntentCategory, number> = {
      [IntentCategory.SECURITY]: 0,
      [IntentCategory.BUSINESS]: 0,
      [IntentCategory.OPERATIONS]: 0,
      [IntentCategory.USER]: 0,
      [IntentCategory.SYSTEM]: 0,
    };
    
    const byType: Record<string, number> = {};
    let totalConfidence = 0;
    
    for (const intent of intents) {
      byCategory[intent.category]++;
      byType[intent.type] = (byType[intent.type] || 0) + 1;
      totalConfidence += intent.confidence;
    }
    
    const decisions = Array.from(this.decisionHistory.values());
    const totalLatency = decisions.reduce((sum, d) => sum + d.metadata.latency, 0);
    
    return {
      byCategory,
      byType,
      averageConfidence: intents.length > 0 ? totalConfidence / intents.length : 0,
      averageLatency: decisions.length > 0 ? totalLatency / decisions.length : 0,
    };
  }

  /**
   * 创建降级决策
   */
  private createFallbackDecision(intent: Intent, reason: string): Decision {
    return {
      id: `decision-${Date.now()}`,
      intentId: intent.id,
      type: 'defer',
      reasons: [reason],
      strategy: 'fallback',
      actions: [],
      metadata: {
        latency: 0,
        confidence: 0,
        aiAssisted: false,
        humanOverride: false,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 清理历史记录
   */
  private cleanupHistory(): void {
    if (this.intentHistory.size > this.config.maxHistorySize) {
      const entries = Array.from(this.intentHistory.entries());
      const toDelete = entries.slice(0, entries.length - this.config.maxHistorySize);
      for (const [key] of toDelete) {
        this.intentHistory.delete(key);
      }
    }
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.ipcChannel.destroy();
    this.removeAllListeners();
  }
}

// 导出单例
export const intentDecisionCore = new IntentDecisionCore();
