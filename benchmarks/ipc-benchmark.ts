/**
 * IPC 性能基准测试
 * 
 * 对比：自定义 IPCChannel vs Node.js EventEmitter
 * 测试维度：延迟、吞吐量、内存占用、订阅/取消订阅性能
 */

import { EventEmitter } from 'events';
import { IPCChannel, createIPCChannel } from '../src/bsd/ipc';

// ==================== 测试配置 ====================
const WARMUP_ITERATIONS = 1000;
const BENCHMARK_ITERATIONS = 100000;
const MESSAGE_PAYLOAD = { data: 'test message', timestamp: Date.now() };

// ==================== 辅助函数 ====================
function formatNumber(num: number): string {
  return num.toLocaleString('zh-CN');
}

function formatTime(ns: number): string {
  if (ns < 1000) return `${ns.toFixed(2)} ns`;
  if (ns < 1000000) return `${(ns / 1000).toFixed(2)} μs`;
  return `${(ns / 1000000).toFixed(2)} ms`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 基准测试类 ====================
class Benchmark {
  private results: Map<string, number> = new Map();

  async run(name: string, fn: () => void | Promise<void>, iterations: number): Promise<number> {
    // 预热
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      await fn();
    }

    // 强制垃圾回收（如果可用）
    if (global.gc) {
      global.gc();
    }

    await sleep(100);

    // 正式测试
    const startTime = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      await fn();
    }
    
    const endTime = process.hrtime.bigint();
    const totalNs = Number(endTime - startTime);
    const avgNs = totalNs / iterations;

    this.results.set(name, avgNs);
    return avgNs;
  }

  report(): void {
    console.log('\n========== 性能测试报告 ==========\n');
    
    for (const [name, avgNs] of this.results) {
      console.log(`${name}:`);
      console.log(`  平均延迟: ${formatTime(avgNs)}`);
      console.log(`  吞吐量: ${formatNumber(Math.floor(1000000000 / avgNs))} ops/s`);
      console.log('');
    }
  }

  compare(baseline: string, target: string): void {
    const baselineNs = this.results.get(baseline);
    const targetNs = this.results.get(target);
    
    if (!baselineNs || !targetNs) {
      console.log('无法比较：缺少数据');
      return;
    }

    const ratio = baselineNs / targetNs;
    const percent = ((targetNs - baselineNs) / baselineNs * 100).toFixed(1);
    
    console.log(`\n========== 对比: ${target} vs ${baseline} ==========`);
    console.log(`性能差异: ${ratio.toFixed(2)}x ${ratio > 1 ? '更快' : '更慢'}`);
    console.log(`百分比: ${ratio > 1 ? '+' : ''}${percent}%`);
    console.log('');
  }
}

// ==================== 测试场景 ====================
async function runBenchmarks(): Promise<void> {
  const benchmark = new Benchmark();

  console.log('=== IPC 性能基准测试 ===\n');
  console.log(`测试迭代次数: ${formatNumber(BENCHMARK_ITERATIONS)}`);
  console.log(`预热迭代次数: ${formatNumber(WARMUP_ITERATIONS)}\n`);

  // 1. 简单发布-订阅延迟测试
  console.log('【测试 1】简单发布-订阅延迟');
  
  // EventEmitter
  const ee = new EventEmitter();
  let eeReceived = 0;
  ee.on('test', () => { eeReceived++; });
  
  await benchmark.run(
    'EventEmitter.publish',
    () => ee.emit('test', MESSAGE_PAYLOAD),
    BENCHMARK_ITERATIONS
  );

  // IPCChannel
  const ipc = createIPCChannel();
  let ipcReceived = 0;
  ipc.subscribe('test', () => { ipcReceived++; });
  
  await benchmark.run(
    'IPCChannel.publish',
    () => ipc.publish('test', MESSAGE_PAYLOAD),
    BENCHMARK_ITERATIONS
  );

  // 2. 多订阅者测试
  console.log('【测试 2】多订阅者性能（10 个订阅者）');
  
  // EventEmitter - 10 handlers
  const ee10 = new EventEmitter();
  for (let i = 0; i < 10; i++) {
    ee10.on('test', () => {});
  }
  
  await benchmark.run(
    'EventEmitter.10subscribers',
    () => ee10.emit('test', MESSAGE_PAYLOAD),
    BENCHMARK_ITERATIONS / 10
  );

  // IPCChannel - 10 handlers
  const ipc10 = createIPCChannel();
  for (let i = 0; i < 10; i++) {
    ipc10.subscribe('test', () => {});
  }
  
  await benchmark.run(
    'IPCChannel.10subscribers',
    () => ipc10.publish('test', MESSAGE_PAYLOAD),
    BENCHMARK_ITERATIONS / 10
  );

  // 3. 订阅/取消订阅性能
  console.log('【测试 3】订阅/取消订阅性能');
  
  // EventEmitter
  await benchmark.run(
    'EventEmitter.subscribe+unsubscribe',
    () => {
      const handler = () => {};
      ee.on('temp', handler);
      ee.off('temp', handler);
    },
    BENCHMARK_ITERATIONS / 10
  );

  // IPCChannel
  const ipcSub = createIPCChannel();
  await benchmark.run(
    'IPCChannel.subscribe+unsubscribe',
    () => {
      const handler = () => {};
      const unsubscribe = ipcSub.subscribe('temp', handler);
      unsubscribe();
    },
    BENCHMARK_ITERATIONS / 10
  );

  // 4. 异步处理器测试
  console.log('【测试 4】异步处理器性能');
  
  // EventEmitter async
  const eeAsync = new EventEmitter();
  eeAsync.on('test', async () => { await sleep(0); });
  
  await benchmark.run(
    'EventEmitter.async',
    () => eeAsync.emit('test', MESSAGE_PAYLOAD),
    BENCHMARK_ITERATIONS / 100
  );

  // IPCChannel async
  const ipcAsync = createIPCChannel();
  ipcAsync.subscribe('test', async () => { await sleep(0); }, { async: true });
  
  await benchmark.run(
    'IPCChannel.async',
    () => ipcAsync.publish('test', MESSAGE_PAYLOAD),
    BENCHMARK_ITERATIONS / 100
  );

  // 5. 内存占用测试
  console.log('【测试 5】内存占用对比');
  
  if (global.gc) {
    global.gc();
    const memBeforeEE = process.memoryUsage();
    
    const eeMem = new EventEmitter();
    for (let i = 0; i < 10000; i++) {
      eeMem.on(`event${i}`, () => {});
    }
    
    global.gc();
    const memAfterEE = process.memoryUsage();
    
    console.log('EventEmitter (10000 订阅):');
    console.log(`  堆内存增长: ${((memAfterEE.heapUsed - memBeforeEE.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
    
    global.gc();
    const memBeforeIPC = process.memoryUsage();
    
    const ipcMem = createIPCChannel();
    for (let i = 0; i < 10000; i++) {
      ipcMem.subscribe(`event${i}`, () => {});
    }
    
    global.gc();
    const memAfterIPC = process.memoryUsage();
    
    console.log('IPCChannel (10000 订阅):');
    console.log(`  堆内存增长: ${((memAfterIPC.heapUsed - memBeforeIPC.heapUsed) / 1024 / 1024).toFixed(2)} MB`);
    
    const ratio = (memAfterEE.heapUsed - memBeforeEE.heapUsed) / (memAfterIPC.heapUsed - memBeforeIPC.heapUsed);
    console.log(`\n内存效率比: IPCChannel 比 EventEmitter 节省 ${(ratio - 1).toFixed(1)}x 内存`);
  } else {
    console.log('  无法测试内存（需要 --expose-gc 标志）');
  }

  // 6. 统计信息对比
  console.log('\n【测试 6】统计信息功能');
  
  const ipcStats = createIPCChannel();
  ipcStats.subscribe('test', () => {});
  
  for (let i = 0; i < 100; i++) {
    ipcStats.publish('test', MESSAGE_PAYLOAD);
  }
  
  const stats = ipcStats.getStats();
  console.log('IPCChannel 统计信息:');
  console.log(`  总发布: ${stats.totalPublished}`);
  console.log(`  总处理: ${stats.totalHandled}`);
  console.log(`  平均延迟: ${stats.averageLatency} ms`);
  console.log('  EventEmitter: 无内置统计功能');

  // 生成报告
  benchmark.report();
  
  // 对比分析
  benchmark.compare('EventEmitter.publish', 'IPCChannel.publish');
  benchmark.compare('EventEmitter.10subscribers', 'IPCChannel.10subscribers');
  benchmark.compare('EventEmitter.subscribe+unsubscribe', 'IPCChannel.subscribe+unsubscribe');

  console.log('\n========== 总结 ==========');
  console.log('IPCChannel 优势:');
  console.log('  ✓ 类型安全（完整 TypeScript 支持）');
  console.log('  ✓ 取消订阅函数（更好的内存管理）');
  console.log('  ✓ 内置统计功能');
  console.log('  ✓ 优先级支持');
  console.log('  ✓ 异步处理器原生支持');
  console.log('  ✓ 可选消息队列');
  console.log('\nEventEmitter 优势:');
  console.log('  ✓ Node.js 原生，无需额外代码');
  console.log('  ✓ 生态兼容性');
  console.log('  ✓ 经过长期生产验证');
}

// 运行测试
runBenchmarks().catch(console.error);