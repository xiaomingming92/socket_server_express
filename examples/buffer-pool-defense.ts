/**
 * 消息缓冲池防御性设计演示
 * 
 * 场景：模拟攻击者发送 10000 次重复请求
 * 结果：缓冲池只保留最新状态，攻击被转化为"心跳更新"
 */

import { createBufferPool, MergeStrategy } from '../src/bsd/buffer-pool';

// ==================== 场景 1：高频重复请求攻击 ====================
console.log('=== 场景 1：高频重复请求攻击防御 ===\n');

interface UserAction {
  userId: string;
  action: string;
  data: any;
  timestamp: number;
}

const defensePool = createBufferPool<UserAction>({
  capacity: 100,
  keyGenerator: (msg) => `${msg.userId}:${msg.action}`,  // 按用户+动作去重
  mergeStrategy: MergeStrategy.REPLACE,  // 新请求替换旧请求
  mode: 'buffer',  // 缓冲池模式（更新而非丢弃）
});

// 模拟攻击：用户 A 对同一资源发送 10000 次请求
console.log('模拟攻击：用户 A 发送 10000 次重复请求...');

const attackStartTime = Date.now();
for (let i = 0; i < 10000; i++) {
  defensePool.enqueue({
    userId: 'user-A',
    action: 'update-profile',
    data: { 
      nickname: `Attacker-${i}`,
      requestSeq: i,
    },
    timestamp: Date.now(),
  });
}
const attackEndTime = Date.now();

const stats1 = defensePool.getStats();
console.log(`攻击完成，耗时: ${attackEndTime - attackStartTime}ms`);
console.log(`缓冲池统计:`);
console.log(`  - 总入池: ${stats1.totalEnqueued}`);
console.log(`  - 总更新: ${stats1.totalUpdated}`);
console.log(`  - 去重率: ${(stats1.deduplicationRate * 100).toFixed(2)}%`);
console.log(`  - 当前缓冲: ${stats1.size} 条消息`);
console.log(`  - 缓冲池使用率: ${(stats1.usageRate * 100).toFixed(2)}%`);

// 消费者只处理一次
const processed = defensePool.dequeue();
if (processed) {
  console.log(`\n消费者处理:`);
  console.log(`  - 消息键: ${processed.metadata.key}`);
  console.log(`  - 更新次数: ${processed.metadata.updateCount}`);
  console.log(`  - 是否重复: ${processed.metadata.isRepeated}`);
  console.log(`  - 最新数据:`, processed.message.data);
  console.log(`  - 处理延迟: ${processed.metadata.bufferTime}ms`);
  
  defensePool.complete(processed.metadata.key);
}

console.log('\n✅ 攻击被成功防御！10000 次请求 → 1 次处理\n');

// ==================== 场景 2：状态合并场景 ====================
console.log('=== 场景 2：状态合并场景 ===\n');

interface PlayerState {
  playerId: string;
  position: { x: number; y: number };
  health: number;
  ammo: number;
}

const gamePool = createBufferPool<PlayerState>({
  capacity: 1000,
  keyGenerator: (msg) => msg.playerId,
  mergeStrategy: MergeStrategy.MERGE,  // 合并对象
  mode: 'buffer',
});

// 模拟玩家快速移动（每帧都发送位置更新）
console.log('模拟玩家快速移动（60fps，持续 1 秒）...');

for (let i = 0; i < 60; i++) {
  gamePool.enqueue({
    playerId: 'player-1',
    position: { x: i * 10, y: i * 5 },
    health: 100,  // 不变
    ammo: 30,     // 不变
  });
}

const stats2 = gamePool.getStats();
console.log(`缓冲池统计:`);
console.log(`  - 总入池: ${stats2.totalEnqueued}`);
console.log(`  - 总更新: ${stats2.totalUpdated}`);
console.log(`  - 当前缓冲: ${stats2.size} 条消息`);

const playerState = gamePool.dequeue();
if (playerState) {
  console.log(`\n最终状态:`);
  console.log(`  - 玩家位置: (${playerState.message.position.x}, ${playerState.message.position.y})`);
  console.log(`  - 更新次数: ${playerState.metadata.updateCount}`);
  console.log(`  - 跳过了 ${playerState.metadata.updateCount - 1} 个中间状态`);
  
  gamePool.complete(playerState.metadata.key);
}

console.log('\n✅ 状态同步优化！60 次更新 → 只处理最终状态\n');

// ==================== 场景 3：严格队列模式对比 ====================
console.log('=== 场景 3：严格队列模式（传统做法）===\n');

const strictPool = createBufferPool<UserAction>({
  capacity: 10,
  keyGenerator: (msg) => `${msg.userId}:${msg.action}:${Date.now()}`,  // 唯一键
  mode: 'strict',  // 严格队列模式
});

console.log('尝试入池 20 条消息（容量只有 10）...');

let successCount = 0;
let failCount = 0;

for (let i = 0; i < 20; i++) {
  const success = strictPool.enqueue({
    userId: 'user-B',
    action: 'buy-item',
    data: { itemId: i },
    timestamp: Date.now(),
  });
  
  if (success) successCount++;
  else failCount++;
}

console.log(`入池结果:`);
console.log(`  - 成功: ${successCount}`);
console.log(`  - 失败: ${failCount}`);
console.log(`  - 传统队列满了就丢弃/拒绝`);

console.log('\n❌ 严格模式无法防御重复请求攻击\n');

// ==================== 场景 4：累加策略（计数器场景） ====================
console.log('=== 场景 4：累加策略（计数器场景） ===\n');

const counterPool = createBufferPool<number>({
  capacity: 10,
  keyGenerator: (msg) => 'global-counter',
  mergeStrategy: MergeStrategy.ACCUMULATE,  // 累加
  mode: 'buffer',
});

console.log('模拟 1000 次点击计数...');

for (let i = 0; i < 1000; i++) {
  counterPool.enqueue(1);  // 每次 +1
}

const counterResult = counterPool.dequeue();
if (counterResult) {
  console.log(`最终计数: ${counterResult.message}`);
  console.log(`更新次数: ${counterResult.metadata.updateCount}`);
  console.log(`等效于: 1000 次点击 → 1 次计算 (${counterResult.message})`);
}

console.log('\n✅ 累加策略优化！1000 次更新 → 1 次计算\n');

// ==================== 总结 ====================
console.log('========== 防御性设计总结 ==========\n');

console.log('核心优势:');
console.log('  1. 永不丢弃新消息 → 更新缓冲池状态');
console.log('  2. 去重即防御 → 重复请求视为更新');
console.log('  3. 攻击转化 → 高频请求变成"心跳更新"');
console.log('  4. 灵活配置 → 支持多种合并策略');
console.log('  5. 可观测性 → 实时统计去重率');

console.log('\n适用场景:');
console.log('  ✅ 高频重复请求（攻击/重试）');
console.log('  ✅ 状态同步（游戏/IoT）');
console.log('  ✅ 计数器/累加场景');
console.log('  ✅ 配置热更新');
console.log('  ⚠️ 严格顺序场景需用 strict 模式');

console.log('\n与传统队列对比:');
console.log('  传统队列: 满了就丢弃/阻塞 ❌');
console.log('  缓冲池:   更新最新状态 ✅');
