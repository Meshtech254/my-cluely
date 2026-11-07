// Native messaging transport only. No tools, shell execution or web-server listener.
const fs = require('fs');
const net = require('net');
function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  if (body.length > 1024 * 1024 - 4) throw new Error('Native message too large');
  const size = Buffer.alloc(4); size.writeUInt32LE(body.length); return Buffer.concat([size, body]);
}
function decoder(accept, reject) {
  let buffer = Buffer.alloc(0);
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > 1024 * 1024 || !length) return reject(new Error('Invalid native frame size'));
      if (buffer.length < length + 4) return;
      try { accept(JSON.parse(buffer.subarray(4, length + 4).toString('utf8'))); } catch (error) { return reject(error); }
      buffer = buffer.subarray(length + 4);
    }
  };
}
function run(configPath, origin) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (origin !== `chrome-extension://${config.extensionId}/` && origin !== `chrome-extension://${config.extensionId}`) throw new Error('Unregistered extension origin');
  const socket = net.connect(config.pipe);
  socket.setEncoding('utf8');
  const quit = () => { socket.destroy(); process.exit(0); };
  socket.on('connect', () => socket.write(JSON.stringify({ type: 'hello', secret: config.secret }) + '\n'));
  socket.on('error', quit); socket.on('close', quit);
  process.stdout.on('error', quit);
  process.stdin.on('end', quit);
  process.stdin.on('data', decoder(message => socket.write(JSON.stringify(message) + '\n'), quit));
  let buffer = '';
  socket.on('data', chunk => {
    buffer += chunk.toString('utf8'); if (buffer.length > 2 * 1024 * 1024) return quit();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try { process.stdout.write(frame(JSON.parse(line))); } catch (_) { quit(); }
    }
  });
}
if (require.main === module) { try { run(process.argv[2], process.argv[3]); } catch (_) { process.exitCode = 1; } }
module.exports = { frame, decoder };
