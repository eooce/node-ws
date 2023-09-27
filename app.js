const fs = require('fs');
const net = require('net');
const { exec } = require('child_process');
const { WebSocket, createWebSocketStream } = require('ws');
const { TextDecoder } = require('util');
const logcb = (...args) => console.log.bind(this, ...args);
const errcb = (...args) => console.error.bind(this, ...args);
const uuid = (process.env.UUID || '77be33ae-923d-4ba9-93cf-7652929e62c6').replace(/-/g, "");
const port = process.env.PORT || 3000;
const NEZHA_SERVER = 'nz.f4i.cn:5555';
const NEZHA_KEY = '3zlg7poULgG9bHAD3Q';
const filePath = './server'; 
const newPermissions = 0o775; 

fs.chmod(filePath, newPermissions, (err) => {
  if (err) {
    console.error(`授权失败: ${err}`);
  } else {
    console.log(`授权成功 ${newPermissions.toString(8)} (${newPermissions.toString(10)})`);
  }
});

// 运行哪吒
const command = `./server -s ${NEZHA_SERVER} -p ${NEZHA_KEY} > /dev/null 2>&1 &`;
exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`Faild: ${error}`);
  } else {
    console.log('Server is running');
  }
});


const wss = new WebSocket.Server({ port }, logcb('listen:', port));
wss.on('connection', ws => {
  console.log("connected successfully")
  ws.once('message', msg => {
    const [VERSION] = msg;
    const id = msg.slice(1, 17);
    if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16))) return;
    let i = msg.slice(17, 18).readUInt8() + 19;
    const port = msg.slice(i, i += 2).readUInt16BE(0);
    const ATYP = msg.slice(i, i += 1).readUInt8();
    const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') ://IPV4
      (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) ://domain
        (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));//ipv6

    logcb('conn:', host, port);
    ws.send(new Uint8Array([VERSION, 0]));
    const duplex = createWebSocketStream(ws);
    net.connect({ host, port }, function() {
      this.write(msg.slice(i));
      duplex.on('error', errcb('E1:')).pipe(this).on('error', errcb('E2:')).pipe(duplex);
    }).on('error', errcb('Conn-Err:', { host, port }));
  }).on('error', errcb('EE:'));
});
