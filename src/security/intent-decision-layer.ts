/**
 * 意图决策层 (Intent Decision Layer)
 * 
 * 核心设计理念：
 * 1. **端点混淆** - 动态端点路径，业务意图固定
 * 2. **用户分级** - 注册/未注册/攻击者，差异化服务
 * 3. **蜜罐欺骗** - 给攻击者想要的结果，但是是假的
 * 4. **意图识别** - 行为分析 + 业务规则 + 能力模型
 * 5. **能力约束** - 执行前校验权限、配额、边界
 * 
 * 安全哲学：
 * - 不要暴露真实端点
 * - 不要让攻击者知道被识别
 * - 给攻击者虚假的成功感
 * - 真实用户能识别真假，攻击者认为是垃圾
 */

import { EventEmitter } from 'events';

// ==================== 类型定义 ====================

/**
 * 用户身份级别
 */
export enum UserTier {
  /** 已注册用户 - 可信 */
  REGISTERED = 'registered',
  /** 未注册访客 - 观察 */
  GUEST = 'guest',
  /** 疑似攻击者 - 欺骗 */
  SUSPECTED = 'suspected',
  /** 确认攻击者 - 拦截 */
  ATTACKER = 'attacker',
  /** 未知 - 需要识别 */
  UNKNOWN = 'unknown',
}

/**
 * 意图类型
 */
export enum IntentType {
  /** 正常业务 */
  NORMAL = 'normal',
  /** 可疑行为 */
  SUSPICIOUS = 'suspicious',
  /** 恶意攻击 */
  MALICIOUS = 'malicious',
  /** 未知意图 */
  UNKNOWN = 'unknown',
}

/**
 * 决策结果
 */
export enum Decision {
  /** 放行 */
  ALLOW = 'allow',
  /** 挑战（验证码等） */
  CHALLENGE = 'challenge',
  /** 蜜罐欺骗 */
  HONEYPOT = 'honeypot',
  /** 拦截 */
  BLOCK = 'block',
  /** 观察 */
  OBSERVE = 'observe',
}

/**
 * 能力模型
 */
export interface CapabilityModel {
  /** 用户角色 */
  role: string;
  /** 权限列表 */
  permissions: string[];
  /** 配额限制 */
  quotas: {
    [resource: string]: {
      limit: number;
      window: number; // 时间窗口（秒）
      used: number;
    };
  };
  /** 数据范围 */
  dataScope: {
    ownData: boolean;
    orgData: boolean;
    publicData: boolean;
  };
  /** 操作限制 */
  operations: {
    allowed: string[];
    denied: string[];
  };
}

/**
 * 请求上下文
 */
export interface RequestContext {
  /** 请求ID */
  requestId: string;
  /** 客户端IP */
  clientIp: string;
  /** 用户ID（如果有） */
  userId?: string;
  /** 会话ID */
  sessionId?: string;
  /** 请求路径 */
  path: string;
  /** 业务意图 */
  businessIntent: string;
  /** 请求方法 */
  method: string;
  /** 请求参数 */
  params: Record<string, any>;
  /** 请求头 */
  headers: Record<string, string>;
  /** 时间戳 */
  timestamp: number;
  /** 历史行为 */
  behaviorHistory: BehaviorRecord[];
}

/**
 * 行为记录
 */
export interface BehaviorRecord {
  timestamp: number;
  action: string;
  path: string;
  result: 'success' | 'failure' | 'blocked';
  metadata?: Record<string, any>;
}

/**
 * 意图分析结果
 */
export interface IntentAnalysis {
  intentType: IntentType;
  confidence: number; // 0-1
  reasons: string[];
  riskScore: number; // 0-100
  patterns: string[];
}

/**
 * 决策上下文
 */
export interface DecisionContext {
  userTier: UserTier;
  intentAnalysis: IntentAnalysis;
  capabilityMatch: boolean;
  quotaStatus: 'ok' | 'warning' | 'exceeded';
  businessValid: boolean;
}

/**
 * 端点映射
 */
export interface EndpointMapping {
  /** 动态端点（对外暴露） */
  dynamicEndpoint: string;
  /** 业务意图（内部识别） */
  businessIntent: string;
  /** 真实端点（内部路由） */
  realEndpoint?: string;
  /** 创建时间 */
  createdAt: number;
  /** 过期时间 */
  expiresAt: number;
  /** 访问次数 */
  accessCount: number;
}

// ==================== 端点混淆层 ====================

/**
 * 端点混淆管理器
 * 
 * 核心功能：
 * - 动态生成端点路径
 * - 业务意图固定
 * - 定期轮换端点
 */
export class EndpointObfuscator {
  private mappings: Map<string, EndpointMapping> = new Map();
  private businessToDynamic: Map<string, string> = new Map();
  private options: {
    endpointLength: number;
    rotationInterval: number;
    maxAccessCount: number;
  };

  constructor(options?: Partial<typeof this.options>) {
    this.options = {
      endpointLength: 8,
      rotationInterval: 3600000, // 1小时
      maxAccessCount: 1000,
      ...options,
    };

    // 启动定期轮换
    setInterval(() => this.rotateEndpoints(), this.options.rotationInterval);
  }

  /**
   * 生成随机端点
   */
  private generateEndpoint(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '/api/';
    for (let i = 0; i < this.options.endpointLength; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * 注册业务意图
   */
  registerBusinessIntent(businessIntent: string, realEndpoint?: string): string {
    // 检查是否已存在
    const existing = this.businessToDynamic.get(businessIntent);
    if (existing) {
      return existing;
    }

    // 生成新端点
    let dynamicEndpoint: string;
    do {
      dynamicEndpoint = this.generateEndpoint();
    } while (this.mappings.has(dynamicEndpoint));

    const now = Date.now();
    const mapping: EndpointMapping = {
      dynamicEndpoint,
      businessIntent,
      realEndpoint,
      createdAt: now,
      expiresAt: now + this.options.rotationInterval,
      accessCount: 0,
    };

    this.mappings.set(dynamicEndpoint, mapping);
    this.businessToDynamic.set(businessIntent, dynamicEndpoint);

    return dynamicEndpoint;
  }

  /**
   * 解析端点
   */
  resolveEndpoint(dynamicEndpoint: string): EndpointMapping | null {
    const mapping = this.mappings.get(dynamicEndpoint);
    if (!mapping) return null;

    // 检查过期
    if (Date.now() > mapping.expiresAt) {
      this.mappings.delete(dynamicEndpoint);
      this.businessToDynamic.delete(mapping.businessIntent);
      return null;
    }

    // 检查访问次数
    if (mapping.accessCount >= this.options.maxAccessCount) {
      this.rotateSingleEndpoint(dynamicEndpoint);
      return this.mappings.get(dynamicEndpoint) || null;
    }

    mapping.accessCount++;
    return mapping;
  }

  /**
   * 获取业务意图对应的端点
   */
  getEndpointForBusinessIntent(businessIntent: string): string | null {
    return this.businessToDynamic.get(businessIntent) || null;
  }

  /**
   * 轮换单个端点
   */
  private rotateSingleEndpoint(oldEndpoint: string): void {
    const mapping = this.mappings.get(oldEndpoint);
    if (!mapping) return;

    // 生成新端点
    let newEndpoint: string;
    do {
      newEndpoint = this.generateEndpoint();
    } while (this.mappings.has(newEndpoint));

    // 更新映射
    this.mappings.delete(oldEndpoint);
    mapping.dynamicEndpoint = newEndpoint;
    mapping.createdAt = Date.now();
    mapping.expiresAt = Date.now() + this.options.rotationInterval;
    mapping.accessCount = 0;

    this.mappings.set(newEndpoint, mapping);
    this.businessToDynamic.set(mapping.businessIntent, newEndpoint);
  }

  /**
   * 轮换所有端点
   */
  private rotateEndpoints(): void {
    const businessIntents = Array.from(this.businessToDynamic.keys());
    for (const intent of businessIntents) {
      const oldEndpoint = this.businessToDynamic.get(intent);
      if (oldEndpoint) {
        this.rotateSingleEndpoint(oldEndpoint);
      }
    }
  }

  /**
   * 获取所有映射（用于调试）
   */
  getAllMappings(): EndpointMapping[] {
    return Array.from(this.mappings.values());
  }
}

// ==================== 用户识别层 ====================

/**
 * 用户识别器
 * 
 * 基于多维度信息识别用户身份级别
 */
export class UserIdentifier {
  private userDatabase: Map<string, {
    tier: UserTier;
    capabilities: CapabilityModel;
    registeredAt: number;
    lastSeen: number;
    reputation: number; // 0-100
  }> = new Map();

  private ipReputation: Map<string, {
    score: number;
    requestCount: number;
    blockedCount: number;
    lastRequest: number;
  }> = new Map();

  /**
   * 识别用户级别
   */
  identifyUser(context: RequestContext): UserTier {
    // 1. 检查已注册用户
    if (context.userId && this.isRegisteredUser(context.userId)) {
      return UserTier.REGISTERED;
    }

    // 2. 检查IP声誉
    const ipRep = this.getIpReputation(context.clientIp);
    
    // 3. 分析行为模式
    const behaviorScore = this.analyzeBehavior(context);

    // 4. 综合判断
    if (ipRep.score < 20 || behaviorScore < 20) {
      return UserTier.ATTACKER;
    }
    if (ipRep.score < 50 || behaviorScore < 50) {
      return UserTier.SUSPECTED;
    }
    if (context.userId) {
      return UserTier.GUEST;
    }

    return UserTier.UNKNOWN;
  }

  /**
   * 检查是否已注册
   */
  private isRegisteredUser(userId: string): boolean {
    const user = this.userDatabase.get(userId);
    return user?.tier === UserTier.REGISTERED;
  }

  /**
   * 获取IP声誉
   */
  private getIpReputation(ip: string): { score: number; requestCount: number; blockedCount: number; lastRequest: number } {
    return this.ipReputation.get(ip) || {
      score: 100,
      requestCount: 0,
      blockedCount: 0,
      lastRequest: 0,
    };
  }

  /**
   * 分析行为模式
   */
  private analyzeBehavior(context: RequestContext): number {
    let score = 100;
    const history = context.behaviorHistory;

    // 检查请求频率
    const recentRequests = history.filter(
      h => context.timestamp - h.timestamp < 60000
    );
    if (recentRequests.length > 100) {
      score -= 30;
    }

    // 检查失败率
    const failures = recentRequests.filter(h => h.result === 'failure');
    if (recentRequests.length > 0 && failures.length / recentRequests.length > 0.5) {
      score -= 20;
    }

    // 检查路径遍历
    const uniquePaths = new Set(history.map(h => h.path));
    if (uniquePaths.size > 50) {
      score -= 20;
    }

    return Math.max(0, score);
  }

  /**
   * 更新用户行为
   */
  updateUserBehavior(userId: string, record: BehaviorRecord): void {
    // 实现行为更新逻辑
  }

  /**
   * 更新IP声誉
   */
  updateIpReputation(ip: string, action: 'request' | 'block' | 'success'): void {
    const rep = this.ipReputation.get(ip) || {
      score: 100,
      requestCount: 0,
      blockedCount: 0,
      lastRequest: 0,
    };

    switch (action) {
      case 'request':
        rep.requestCount++;
        rep.lastRequest = Date.now();
        break;
      case 'block':
        rep.blockedCount++;
        rep.score = Math.max(0, rep.score - 10);
        break;
      case 'success':
        rep.score = Math.min(100, rep.score + 1);
        break;
    }

    this.ipReputation.set(ip, rep);
  }
}

// ==================== 蜜罐服务层 ====================

/**
 * 蜜罐服务
 * 
 * 为攻击者/未注册用户返回看似正常但实际虚假的结果
 */
export class HoneyPotService {
  private cache: Map<string, {
    data: any;
    expiresAt: number;
    accessCount: number;
  }> = new Map();

  private fakeDataGenerators: Map<string, () => any> = new Map();

  constructor() {
    this.registerFakeGenerators();
  }

  /**
   * 注册虚假数据生成器
   */
  private registerFakeGenerators(): void {
    // 用户列表生成器
    this.fakeDataGenerators.set('user.list', () => ({
      users: [
        { id: 'fake-1', name: 'User A', status: 'active' },
        { id: 'fake-2', name: 'User B', status: 'inactive' },
      ],
      total: 2,
      page: 1,
    }));

    // 订单列表生成器
    this.fakeDataGenerators.set('order.list', () => ({
      orders: [
        { id: 'ORD-FAKE-001', amount: 99.99, status: 'completed' },
        { id: 'ORD-FAKE-002', amount: 199.99, status: 'pending' },
      ],
      total: 2,
    }));

    // 配置信息生成器
    this.fakeDataGenerators.set('config.get', () => ({
      apiVersion: 'v1.0.0',
      features: ['feature-a', 'feature-b'],
      limits: {
        maxRequests: 1000,
        window: 3600,
      },
    }));
  }

  /**
   * 获取蜜罐响应
   */
  getHoneyPotResponse(businessIntent: string, params: Record<string, any>): {
    data: any;
    isFake: true;
    cacheKey: string;
  } {
    const cacheKey = this.generateCacheKey(businessIntent, params);
    
    // 检查缓存
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      cached.accessCount++;
      return {
        data: cached.data,
        isFake: true,
        cacheKey,
      };
    }

    // 生成虚假数据
    const generator = this.fakeDataGenerators.get(businessIntent);
    const fakeData = generator ? generator() : this.generateGenericFakeData();

    // 缓存结果
    this.cache.set(cacheKey, {
      data: fakeData,
      expiresAt: Date.now() + 300000, // 5分钟过期
      accessCount: 1,
    });

    return {
      data: fakeData,
      isFake: true,
      cacheKey,
    };
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(businessIntent: string, params: Record<string, any>): string {
    const paramStr = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `${businessIntent}:${paramStr}`;
  }

  /**
   * 生成通用虚假数据
   */
  private generateGenericFakeData(): any {
    return {
      status: 'success',
      data: {
        id: `fake-${Date.now()}`,
        timestamp: new Date().toISOString(),
        message: 'Operation completed',
      },
    };
  }

  /**
   * 获取蜜罐统计
   */
  getStats(): {
    cacheSize: number;
    totalAccesses: number;
    hitRate: number;
  } {
    let totalAccesses = 0;
    for (const item of this.cache.values()) {
      totalAccesses += item.accessCount;
    }

    return {
      cacheSize: this.cache.size,
      totalAccesses,
      hitRate: totalAccesses > 0 ? totalAccesses / this.cache.size : 0,
    };
  }
}

// ==================== 意图决策层 ====================

/**
 * 意图决策引擎
 * 
 * 综合分析请求，做出安全决策
 */
export class IntentDecisionEngine extends EventEmitter {
  private endpointObfuscator: EndpointObfuscator;
  private userIdentifier: UserIdentifier;
  private honeyPotService: HoneyPotService;

  constructor() {
    super();
    this.endpointObfuscator = new EndpointObfuscator();
    this.userIdentifier = new UserIdentifier();
    this.honeyPotService = new HoneyPotService();
  }

  /**
   * 处理请求
   */
  async processRequest(context: RequestContext): Promise<{
    decision: Decision;
    context: DecisionContext;
    response?: any;
    realEndpoint?: string;
  }> {
    // 1. 端点解析
    const endpointMapping = this.endpointObfuscator.resolveEndpoint(context.path);
    if (!endpointMapping) {
      return {
        decision: Decision.BLOCK,
        context: this.createDecisionContext(context, UserTier.UNKNOWN, {
          intentType: IntentType.MALICIOUS,
          confidence: 1,
          reasons: ['Invalid endpoint'],
          riskScore: 100,
          patterns: ['endpoint_scanning'],
        }),
      };
    }

    // 更新业务意图
    context.businessIntent = endpointMapping.businessIntent;

    // 2. 用户识别
    const userTier = this.userIdentifier.identifyUser(context);

    // 3. 意图分析
    const intentAnalysis = this.analyzeIntent(context, userTier);

    // 4. 能力匹配
    const capabilityMatch = this.checkCapability(context, userTier);

    // 5. 配额检查
    const quotaStatus = this.checkQuota(context, userTier);

    // 6. 业务校验
    const businessValid = this.validateBusiness(context);

    // 7. 综合决策
    const decision = this.makeDecision({
      userTier,
      intentAnalysis,
      capabilityMatch,
      quotaStatus,
      businessValid,
    });

    const decisionContext: DecisionContext = {
      userTier,
      intentAnalysis,
      capabilityMatch,
      quotaStatus,
      businessValid,
    };

    // 8. 执行决策
    switch (decision) {
      case Decision.HONEYPOT:
        const honeyPotResponse = this.honeyPotService.getHoneyPotResponse(
          context.businessIntent,
          context.params
        );
        return {
          decision,
          context: decisionContext,
          response: honeyPotResponse,
        };

      case Decision.ALLOW:
        return {
          decision,
          context: decisionContext,
          realEndpoint: endpointMapping.realEndpoint,
        };

      case Decision.CHALLENGE:
        return {
          decision,
          context: decisionContext,
          response: {
            challenge: true,
            type: 'captcha',
            message: 'Please complete the verification',
          },
        };

      case Decision.BLOCK:
      default:
        return {
          decision,
          context: decisionContext,
        };
    }
  }

  /**
   * 分析意图
   */
  private analyzeIntent(context: RequestContext, userTier: UserTier): IntentAnalysis {
    const reasons: string[] = [];
    const patterns: string[] = [];
    let riskScore = 0;

    // 检查请求频率
    const recentRequests = context.behaviorHistory.filter(
      h => context.timestamp - h.timestamp < 60000
    );
    if (recentRequests.length > 100) {
      reasons.push('High request frequency');
      patterns.push('rate_limit_exceeded');
      riskScore += 30;
    }

    // 检查参数异常
    if (Object.keys(context.params).length > 50) {
      reasons.push('Too many parameters');
      patterns.push('parameter_stuffing');
      riskScore += 20;
    }

    // 检查路径遍历
    if (context.path.includes('..') || context.path.includes('//')) {
      reasons.push('Path traversal attempt');
      patterns.push('path_traversal');
      riskScore += 50;
    }

    // 用户级别影响
    if (userTier === UserTier.ATTACKER) {
      riskScore += 30;
    } else if (userTier === UserTier.SUSPECTED) {
      riskScore += 15;
    }

    // 确定意图类型
    let intentType: IntentType;
    if (riskScore >= 70) {
      intentType = IntentType.MALICIOUS;
    } else if (riskScore >= 40) {
      intentType = IntentType.SUSPICIOUS;
    } else if (riskScore >= 20) {
      intentType = IntentType.UNKNOWN;
    } else {
      intentType = IntentType.NORMAL;
    }

    return {
      intentType,
      confidence: Math.min(1, riskScore / 100),
      reasons,
      riskScore,
      patterns,
    };
  }

  /**
   * 检查能力匹配
   */
  private checkCapability(context: RequestContext, userTier: UserTier): boolean {
    // 简化实现，实际应从用户数据库获取能力模型
    if (userTier === UserTier.REGISTERED) {
      return true;
    }
    if (userTier === UserTier.GUEST) {
      // 访客只能访问公开接口
      return ['public.list', 'config.get'].includes(context.businessIntent);
    }
    return false;
  }

  /**
   * 检查配额
   */
  private checkQuota(context: RequestContext, userTier: UserTier): 'ok' | 'warning' | 'exceeded' {
    // 简化实现
    const recentRequests = context.behaviorHistory.filter(
      h => context.timestamp - h.timestamp < 60000
    );

    if (recentRequests.length > 1000) return 'exceeded';
    if (recentRequests.length > 500) return 'warning';
    return 'ok';
  }

  /**
   * 校验业务规则
   */
  private validateBusiness(context: RequestContext): boolean {
    // 简化实现，实际应校验业务规则
    return true;
  }

  /**
   * 做出决策
   */
  private makeDecision(context: DecisionContext): Decision {
    // 攻击者 -> 蜜罐或拦截
    if (context.userTier === UserTier.ATTACKER) {
      return Decision.HONEYPOT;
    }

    // 疑似攻击者 -> 蜜罐或挑战
    if (context.userTier === UserTier.SUSPECTED) {
      if (context.intentAnalysis.riskScore > 60) {
        return Decision.HONEYPOT;
      }
      return Decision.CHALLENGE;
    }

    // 配额超限 -> 拦截
    if (context.quotaStatus === 'exceeded') {
      return Decision.BLOCK;
    }

    // 能力不匹配 -> 拦截
    if (!context.capabilityMatch) {
      return Decision.BLOCK;
    }

    // 恶意意图 -> 挑战或拦截
    if (context.intentAnalysis.intentType === IntentType.MALICIOUS) {
      return Decision.BLOCK;
    }

    // 可疑意图 -> 挑战
    if (context.intentAnalysis.intentType === IntentType.SUSPICIOUS) {
      return Decision.CHALLENGE;
    }

    // 正常请求 -> 放行
    return Decision.ALLOW;
  }

  /**
   * 创建决策上下文
   */
  private createDecisionContext(
    requestContext: RequestContext,
    userTier: UserTier,
    intentAnalysis: IntentAnalysis
  ): DecisionContext {
    return {
      userTier,
      intentAnalysis,
      capabilityMatch: this.checkCapability(requestContext, userTier),
      quotaStatus: this.checkQuota(requestContext, userTier),
      businessValid: this.validateBusiness(requestContext),
    };
  }

  /**
   * 注册业务意图
   */
  registerBusinessIntent(businessIntent: string, realEndpoint?: string): string {
    return this.endpointObfuscator.registerBusinessIntent(businessIntent, realEndpoint);
  }

  /**
   * 获取端点映射
   */
  getEndpointMapping(dynamicEndpoint: string): EndpointMapping | null {
    return this.endpointObfuscator.resolveEndpoint(dynamicEndpoint);
  }
}

// 导出单例
export const intentDecisionEngine = new IntentDecisionEngine();
