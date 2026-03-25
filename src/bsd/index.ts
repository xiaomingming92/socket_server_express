/**
 * BSD Socket 模块
 * 手动实现 BSD 风格的 Socket API
 */

// 协议层
export {
  MessageType,
  HEADER_LENGTH,
  MAX_BODY_LENGTH,
  type Message,
  type Header,
  encodeMessage,
  decodeHeader,
  decodeMessage,
  ProtocolCodec,
  createConnectMessage,
  createConnectAckMessage,
  createChatMessage,
  createHeartbeatMessage,
  createDisconnectMessage,
  createAuthMessage,
  createAuthAckMessage,
  createErrorMessage
} from './protocol';

// Socket 连接
export { BSDSocket } from './socket';

// 服务器
export { BSDSocketServer, type ServerOptions } from './server';

// 客户端
export { BSDSocketClient, type ClientOptions } from './client';
