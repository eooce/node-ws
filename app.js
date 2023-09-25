const http = require('http');
const { createServer } = require('http');
const WebSocket = require('ws');
const { exec } = require('child_process');
const port = process.env.PORT || 8080;
const NEZHA_SERVER = 'nz.f4i.cn:5555';
const NEZHA_KEY = 'SfWORrRPZrLqUydqpQ';
const UUID = (process.env.UUID || '2b8aa0b8-79fb-4d11-ae41-3aa2f5272a9f').replace(/-/g, "");

// 创建HTTP服务器
const httpServer = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello, World!\n');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }
});


// 创建WebSocket服务器
const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', ws => {
  console.log("connected successfully")
  ws.once('message', msg => {
    const [VERSION] = msg;
    const id = msg.slice(1, 17);
    if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16))) return;
    let i = msg.slice(17, 18).readUInt8() + 19;
    const port = msg.slice(i, i += 2).readUInt16BE(0);
    const ATYP = msg.slice(i, i += 1).readUInt8();
    const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') : // IPV4
      (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) : // 域名
        (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : '')); // IPv6

    const server = createServer((req, res) => {
    ws.send(new Uint8Array([VERSION, 0]));
    const duplex = createWebSocketStream(ws);
    net.connect({ host, port }, function () {
      this.write(msg.slice(i));
      duplex.on('error', ('E1:')).pipe(this).on('error', ('E2:')).pipe(duplex);
    }).on('error', ('Connect-Err:', { host, port }));
  }).on('error', ('WebSocket Error:'));
});
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request);
  });
});

const command = `./server -s ${NEZHA_SERVER} -p ${NEZHA_KEY} > /dev/null 2>&1 &`;
// 在异步命令执行完成后再启动HTTP服务器
exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`执行命令时出错: ${error}`);
  } else {
    console.log('命令已成功执行');
    
    // 在异步命令执行完成后再启动 HTTP 服务器
    httpServer.listen(80, () => {
      console.log(`HTTP 服务器监听在端口 ${port}`);
    });
  }
});
