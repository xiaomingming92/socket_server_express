/**
 * 业务决策域 (Business Decision Domain)
 * 
 * 展示意图决策如何应用于业务场景：
 * - 订单路由决策
 * - 库存分配决策
 * - 价格策略决策
 * - 推荐算法决策
 */

import {
  DecisionDomain,
  Intent,
  Decision,
  IntentContext,
  DomainStatus,
  DecisionAction,
} from './intent-decision-core';

/**
 * 订单路由意图
 */
export interface OrderRouteIntent extends Intent {
  type: 'order:route';
  parameters: {
    orderId: string;
    userId: string;
    amount: number;
    region: string;
    priority: 'high' | 'normal' | 'low';
    items: Array<{
      sku: string;
      quantity: number;
      warehouse?: string;
    }>;
  };
}

/**
 * 库存分配意图
 */
export interface InventoryAllocateIntent extends Intent {
  type: 'inventory:allocate';
  parameters: {
    sku: string;
    quantity: number;
    orderId: string;
    preferredWarehouse?: string;
    fallbackAllowed: boolean;
  };
}

/**
 * 价格策略意图
 */
export interface PricingIntent extends Intent {
  type: 'pricing:calculate';
  parameters: {
    sku: string;
    userId: string;
    quantity: number;
    promotionCode?: string;
    userTier: 'vip' | 'normal' | 'new';
  };
}

/**
 * 业务决策域实现
 */
export class BusinessDecisionDomain implements DecisionDomain {
  name = 'business';
  supportedIntents = [
    'order:route',
    'inventory:allocate',
    'pricing:calculate',
    'recommend:products',
    'payment:process',
  ];

  private orderRouter: OrderRouter;
  private inventoryManager: InventoryManager;
  private pricingEngine: PricingEngine;

  constructor() {
    this.orderRouter = new OrderRouter();
    this.inventoryManager = new InventoryManager();
    this.pricingEngine = new PricingEngine();
  }

  /**
   * 业务决策入口
   */
  async decide(intent: Intent): Promise<Decision> {
    switch (intent.type) {
      case 'order:route':
        return this.decideOrderRoute(intent as OrderRouteIntent);
      case 'inventory:allocate':
        return this.decideInventoryAllocate(intent as InventoryAllocateIntent);
      case 'pricing:calculate':
        return this.decidePricing(intent as PricingIntent);
      default:
        return this.createDefaultDecision(intent);
    }
  }

  /**
   * 订单路由决策
   * 
   * 决策逻辑：
   * 1. 根据用户地域选择最近仓库
   * 2. 根据库存情况选择有货的仓库
   * 3. 根据订单优先级选择处理队列
   * 4. 考虑成本选择最优方案
   */
  private async decideOrderRoute(intent: OrderRouteIntent): Promise<Decision> {
    const { orderId, userId, amount, region, priority, items } = intent.parameters;

    const reasons: string[] = [];
    const actions: DecisionAction[] = [];

    // 1. 检查库存分布
    const inventoryDistribution = await this.inventoryManager.checkInventory(
      items.map((i) => i.sku)
    );

    // 2. 选择最优仓库
    const selectedWarehouse = this.orderRouter.selectWarehouse({
      region,
      inventoryDistribution,
      priority,
    });

    reasons.push(`Selected warehouse: ${selectedWarehouse} based on region ${region}`);

    // 3. 根据优先级选择处理队列
    const queue = priority === 'high' ? 'priority-queue' : 'normal-queue';
    reasons.push(`Routed to ${queue} due to ${priority} priority`);

    // 4. 构建执行动作
    actions.push({
      type: 'reserve_inventory',
      target: 'inventory-service',
      params: {
        orderId,
        items,
        warehouse: selectedWarehouse,
      },
      priority: 1,
    });

    actions.push({
      type: 'create_order',
      target: 'order-service',
      params: {
        orderId,
        userId,
        amount,
        warehouse: selectedWarehouse,
        queue,
      },
      priority: 2,
    });

    actions.push({
      type: 'notify_user',
      target: 'notification-service',
      params: {
        userId,
        orderId,
        message: `Order created, processing at ${selectedWarehouse}`,
      },
      priority: 3,
    });

    return {
      id: `decision-${Date.now()}`,
      intentId: intent.id,
      type: 'allow',
      reasons,
      strategy: 'optimal_warehouse_selection',
      actions,
      metadata: {
        latency: 0,
        confidence: 0.95,
        aiAssisted: false,
        humanOverride: false,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 库存分配决策
   */
  private async decideInventoryAllocate(
    intent: InventoryAllocateIntent
  ): Promise<Decision> {
    const { sku, quantity, orderId, preferredWarehouse, fallbackAllowed } = intent.parameters;

    const reasons: string[] = [];
    const actions: DecisionAction[] = [];

    // 1. 检查首选仓库
    if (preferredWarehouse) {
      const available = await this.inventoryManager.checkAvailability(
        preferredWarehouse,
        sku,
        quantity
      );

      if (available) {
        reasons.push(`Allocated from preferred warehouse: ${preferredWarehouse}`);
        actions.push({
          type: 'allocate_inventory',
          target: 'inventory-service',
          params: {
            warehouse: preferredWarehouse,
            sku,
            quantity,
            orderId,
          },
          priority: 1,
        });

        return this.createDecision(intent, reasons, actions);
      }
    }

    // 2. 寻找其他仓库
    if (fallbackAllowed) {
      const alternativeWarehouse = await this.inventoryManager.findAlternativeWarehouse(
        sku,
        quantity
      );

      if (alternativeWarehouse) {
        reasons.push(
          `Preferred warehouse unavailable, allocated from alternative: ${alternativeWarehouse}`
        );
        actions.push({
          type: 'allocate_inventory',
          target: 'inventory-service',
          params: {
            warehouse: alternativeWarehouse,
            sku,
            quantity,
            orderId,
          },
          priority: 1,
        });

        return this.createDecision(intent, reasons, actions);
      }
    }

    // 3. 无法分配
    return {
      id: `decision-${Date.now()}`,
      intentId: intent.id,
      type: 'deny',
      reasons: ['Insufficient inventory across all warehouses'],
      strategy: 'inventory_unavailable',
      actions: [
        {
          type: 'notify_backorder',
          target: 'notification-service',
          params: { orderId, sku, quantity },
          priority: 1,
        },
      ],
      metadata: {
        latency: 0,
        confidence: 1,
        aiAssisted: false,
        humanOverride: false,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 价格策略决策
   */
  private async decidePricing(intent: PricingIntent): Promise<Decision> {
    const { sku, userId, quantity, promotionCode, userTier } = intent.parameters;

    const reasons: string[] = [];
    const actions: DecisionAction[] = [];

    // 1. 获取基础价格
    let basePrice = await this.pricingEngine.getBasePrice(sku);
    reasons.push(`Base price: ${basePrice}`);

    // 2. 应用用户等级折扣
    let tierDiscount = 0;
    switch (userTier) {
      case 'vip':
        tierDiscount = 0.2;
        reasons.push('Applied VIP discount: 20%');
        break;
      case 'new':
        tierDiscount = 0.1;
        reasons.push('Applied new user discount: 10%');
        break;
    }

    // 3. 应用促销码
    let promoDiscount = 0;
    if (promotionCode) {
      promoDiscount = await this.pricingEngine.validatePromotion(promotionCode);
      if (promoDiscount > 0) {
        reasons.push(`Applied promotion ${promotionCode}: ${promoDiscount * 100}%`);
      }
    }

    // 4. 批量折扣
    let bulkDiscount = 0;
    if (quantity >= 100) {
      bulkDiscount = 0.15;
      reasons.push('Applied bulk discount: 15%');
    } else if (quantity >= 10) {
      bulkDiscount = 0.05;
      reasons.push('Applied bulk discount: 5%');
    }

    // 5. 计算最终价格
    const totalDiscount = Math.min(tierDiscount + promoDiscount + bulkDiscount, 0.5); // 最大50%折扣
    const finalPrice = basePrice * quantity * (1 - totalDiscount);

    reasons.push(`Final price: ${finalPrice} (total discount: ${totalDiscount * 100}%)`);

    actions.push({
      type: 'calculate_price',
      target: 'pricing-service',
      params: {
        sku,
        userId,
        quantity,
        basePrice,
        discounts: {
          tier: tierDiscount,
          promotion: promoDiscount,
          bulk: bulkDiscount,
        },
        finalPrice,
      },
      priority: 1,
    });

    return {
      id: `decision-${Date.now()}`,
      intentId: intent.id,
      type: 'allow',
      reasons,
      strategy: 'dynamic_pricing',
      actions,
      metadata: {
        latency: 0,
        confidence: 1,
        aiAssisted: false,
        humanOverride: false,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 创建决策辅助方法
   */
  private createDecision(
    intent: Intent,
    reasons: string[],
    actions: DecisionAction[]
  ): Decision {
    return {
      id: `decision-${Date.now()}`,
      intentId: intent.id,
      type: 'allow',
      reasons,
      strategy: 'business_logic',
      actions,
      metadata: {
        latency: 0,
        confidence: 0.9,
        aiAssisted: false,
        humanOverride: false,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 创建默认决策
   */
  private createDefaultDecision(intent: Intent): Decision {
    return {
      id: `decision-${Date.now()}`,
      intentId: intent.id,
      type: 'allow',
      reasons: ['Default business decision'],
      strategy: 'default',
      actions: [],
      metadata: {
        latency: 0,
        confidence: 0.5,
        aiAssisted: false,
        humanOverride: false,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 获取域状态
   */
  getStatus(): DomainStatus {
    return {
      name: this.name,
      healthy: true,
      load: 0.3,
      lastDecision: Date.now(),
    };
  }
}

// ==================== 辅助类 ====================

/**
 * 订单路由器
 */
class OrderRouter {
  selectWarehouse(params: {
    region: string;
    inventoryDistribution: Map<string, number>;
    priority: string;
  }): string {
    const { region, inventoryDistribution } = params;

    // 简化的路由逻辑：选择库存最多的仓库
    let selectedWarehouse = '';
    let maxInventory = 0;

    for (const [warehouse, inventory] of inventoryDistribution) {
      if (inventory > maxInventory) {
        maxInventory = inventory;
        selectedWarehouse = warehouse;
      }
    }

    return selectedWarehouse || `${region}-warehouse-1`;
  }
}

/**
 * 库存管理器
 */
class InventoryManager {
  private inventory: Map<string, Map<string, number>> = new Map();

  async checkInventory(skus: string[]): Promise<Map<string, number>> {
    const distribution = new Map<string, number>();

    // 模拟库存分布
    for (const sku of skus) {
      distribution.set(`warehouse-east`, 100);
      distribution.set(`warehouse-west`, 80);
      distribution.set(`warehouse-south`, 60);
    }

    return distribution;
  }

  async checkAvailability(
    warehouse: string,
    sku: string,
    quantity: number
  ): Promise<boolean> {
    const warehouseInventory = this.inventory.get(warehouse);
    if (!warehouseInventory) return false;

    const available = warehouseInventory.get(sku) || 0;
    return available >= quantity;
  }

  async findAlternativeWarehouse(sku: string, quantity: number): Promise<string | null> {
    // 模拟寻找替代仓库
    return 'warehouse-alternative';
  }
}

/**
 * 价格引擎
 */
class PricingEngine {
  private basePrices: Map<string, number> = new Map([
    ['sku-001', 100],
    ['sku-002', 200],
    ['sku-003', 300],
  ]);

  async getBasePrice(sku: string): Promise<number> {
    return this.basePrices.get(sku) || 0;
  }

  async validatePromotion(code: string): Promise<number> {
    // 模拟促销码验证
    const promotions: Record<string, number> = {
      SAVE10: 0.1,
      SAVE20: 0.2,
      VIP50: 0.5,
    };

    return promotions[code] || 0;
  }
}
