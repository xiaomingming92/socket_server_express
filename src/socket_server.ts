/*
 * @Author       : yinming 1090538449@qq.com
 * @Date         : 2025-07-30 17:59
 * @LastEditors  : wujixmm wujixmm@gmail.com
 * @LastEditTime : 2026-03-20 11:11:51
 * @FilePath     : /socket_server_express/src/socket_server.ts
 * @Description  :  
 */
import http from 'http';
const {Server} = require('socket.io');
import app from './app';
const initSocket = require('./sockets');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

// init 所有socket namespace
initSocket(io);

server.listen(3000, () => {
  console.log("serve run at http://localhost:3000")
})