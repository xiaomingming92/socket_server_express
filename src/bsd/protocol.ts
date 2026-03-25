/**
 * BSD Socket 协议层
 * 定义消息格式、编解码、粘包处理
 *
 * 消息格式:
 * ┌─────────────┬─────────────┬─────────────┬─────────────────┐
 * │  消息类型    │  消息长度    │  保留字段    │     消息体       │
 * │  (1 byte)   │  (4 bytes)  │  (3 bytes)  │  (变长, JSON)   │
 * └─────────────┴─────────────┴─────────────┴─────────────────┘
 */

// 消息类型枚举
export enum MessageType {
  CONNECT = 0x01,      // 连接请求
  CONNECT_ACK = 0x02,  // 连接响应
  CHAT = 0x03,         // 聊天消息
  HEARTBEAT = 0x04,    // 心跳包
  DISCONNECT = 0x05,   // 断开连接
  AUTH = 0x06,         // 认证消息
  AUTH_ACK = 0x07,     // 认证响应
  ERROR = 0x08,        // 错误消息
}

// 消息头长度: 1 + 4 + 3 = 8 bytes
export const HEADER_LENGTH = 8;

// 最大消息体长度 (10MB)
export const MAX_BODY_LENGTH = 10 * 1024 * 1024;

// 消息接口
export interface Message {
  type: MessageType;
  body: any;
}

// 编码消息
export function encodeMessage(type: MessageType, body: any): Buffer {
  const bodyStr = JSON.stringify(body);
  const bodyBuffer = Buffer.from(bodyStr, 'utf-8');
  const bodyLength = bodyBuffer.length;

  if (bodyLength > MAX_BODY_LENGTH) {
    throw new Error(`消息体过大: ${bodyLength} bytes, 最大允许: ${MAX_BODY_LENGTH} bytes`);
  }

  // 创建消息缓冲区
  const buffer = Buffer.alloc(HEADER_LENGTH + bodyLength);

  // 写入消息类型 (1 byte)
  buffer.writeUInt8(type, 0);

  // 写入消息长度 (4 bytes, 大端序 - 网络字节序)
  buffer.writeUInt32BE(bodyLength, 1);

  // 保留字段 (3 bytes) - 暂不使用，填充 0
  buffer.writeUInt8(0, 5);
  buffer.writeUInt8(0, 6);
  buffer.writeUInt8(0, 7);

  // 写入消息体
  bodyBuffer.copy(buffer, HEADER_LENGTH);

  return buffer;
}

// 解码消息头
export interface Header {
  type: MessageType;
  length: number;
  valid: boolean;
}

export function decodeHeader(buffer: Buffer): Header {
  if (buffer.length < HEADER_LENGTH) {
    return { type: MessageType.CONNECT, length: 0, valid: false };
  }

  const type = buffer.readUInt8(0) as MessageType;
  const length = buffer.readUInt32BE(1);

  // 验证消息类型
  if (!Object.values(MessageType).includes(type)) {
    return { type, length, valid: false };
  }

  // 验证消息长度
  if (length > MAX_BODY_LENGTH) {
    return { type, length, valid: false };
  }

  return { type, length, valid: true };
}

// 解码完整消息
export function decodeMessage(buffer: Buffer): Message | null {
  const header = decodeHeader(buffer);

  if (!header.valid) {
    return null;
  }

  if (buffer.length < HEADER_LENGTH + header.length) {
    return null; // 数据不完整
  }

  const bodyBuffer = buffer.slice(HEADER_LENGTH, HEADER_LENGTH + header.length);
  const bodyStr = bodyBuffer.toString('utf-8');

  try {
    const body = JSON.parse(bodyStr);
    return { type: header.type, body };
  } catch (err) {
    return null; // JSON 解析失败
  }
}

// 消息编解码器类 (处理粘包)
export class ProtocolCodec {
  private buffer: Buffer = Buffer.alloc(0);

  // 追加数据到缓冲区
  append(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
  }

  // 尝试解码一条消息
  decodeOne(): Message | null {
    // 检查是否有足够的字节读取头部
    if (this.buffer.length < HEADER_LENGTH) {
      return null;
    }

    const header = decodeHeader(this.buffer);

    if (!header.valid) {
      // 无效头部，丢弃一个字节继续尝试
      this.buffer = this.buffer.slice(1);
      return this.decodeOne();
    }

    // 检查是否有完整的消息体
    const totalLength = HEADER_LENGTH + header.length;
    if (this.buffer.length < totalLength) {
      return null; // 等待更多数据
    }

    // 提取完整消息
    const messageBuffer = this.buffer.slice(0, totalLength);
    this.buffer = this.buffer.slice(totalLength);

    return decodeMessage(messageBuffer);
  }

  // 解码所有可用的消息
  decodeAll(): Message[] {
    const messages: Message[] = [];
    let message: Message | null;

    while ((message = this.decodeOne()) !== null) {
      messages.push(message);
    }

    return messages;
  }

  // 清空缓冲区
  clear(): void {
    this.buffer = Buffer.alloc(0);
  }

  // 获取当前缓冲区大小
  getBufferSize(): number {
    return this.buffer.length;
  }
}

// 便捷函数：创建各类消息

export function createConnectMessage(token?: string): Buffer {
  return encodeMessage(MessageType.CONNECT, { token, timestamp: Date.now() });
}

export function createConnectAckMessage(success: boolean, message?: string): Buffer {
  return encodeMessage(MessageType.CONNECT_ACK, { success, message, timestamp: Date.now() });
}

export function createChatMessage(from: string, content: string, to?: string): Buffer {
  return encodeMessage(MessageType.CHAT, { from, content, to, timestamp: Date.now() });
}

export function createHeartbeatMessage(): Buffer {
  return encodeMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });
}

export function createDisconnectMessage(reason?: string): Buffer {
  return encodeMessage(MessageType.DISCONNECT, { reason, timestamp: Date.now() });
}

export function createAuthMessage(token: string): Buffer {
  return encodeMessage(MessageType.AUTH, { token, timestamp: Date.now() });
}

export function createAuthAckMessage(success: boolean, user?: any): Buffer {
  return encodeMessage(MessageType.AUTH_ACK, { success, user, timestamp: Date.now() });
}

export function createErrorMessage(code: number, message: string): Buffer {
  return encodeMessage(MessageType.ERROR, { code, message, timestamp: Date.now() });
}
