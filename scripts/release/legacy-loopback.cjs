'use strict';
// Only the adopted pre-Git baseline needs this compatibility hook. New server versions bind explicitly.
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  const port = typeof args[0] === 'number' || (typeof args[0] === 'string' && /^\d+$/.test(args[0]));
  if (port && process.env.LISTEN_SOCKET) {
    const socket = path.resolve(process.env.LISTEN_SOCKET);
    fs.mkdirSync(path.dirname(socket), { recursive: true, mode: 0o700 });
    if (fs.existsSync(socket)) { if (!fs.lstatSync(socket).isSocket()) throw new Error('Legacy socket path is occupied'); fs.unlinkSync(socket); }
    const callback = args.findLast(value => typeof value === 'function');
    return Reflect.apply(originalListen, this, [socket, () => { fs.chmodSync(socket, 0o600); if (callback) callback(); }]);
  }
  if (port && typeof args[1] !== 'string') args.splice(1, 0, '127.0.0.1');
  return Reflect.apply(originalListen, this, args);
};
