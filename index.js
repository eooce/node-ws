const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const axios = require('axios');
const request = require('request');
const { exec } = require('child_process');
const { WebSocket, createWebSocketStream } = require('ws');
const logcb = (...args) => console.log.bind(this, ...args);
const errcb = (...args) => console.error.bind(this, ...args);
// const projectPageURL = `https://www.google.com`;
const uuid = (process.env.UUID || 'de04add9-5c68-6bab-950c-08cd5320df37').replace(/-/g, "");
const NEZHA_SERVER = process.env.NEZHA_SERVER || 'nz.aaa.com:5555';
const NEZHA_KEY = process.env.NEZHA_KEY || 'zbcdefghijabcdefg';
const port = process.env.PORT || 3000;

// 创建HTTP服务
const httpServer = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello, World\n');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }
});
httpServer.listen(port, () => {
  console.log(`HTTP Server is running on port ${port}`);
});

// 判断系统架构
function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64') {
    return 'arm';
  } else {
    return 'amd';
  }
}

// 下载对应系统架构的ne-zha
function downloadFile(fileName, fileUrl, callback) {
  let stream = fs.createWriteStream(path.join("./", fileName));
  request(fileUrl)
    .pipe(stream)
    .on("close", function(err) {
      if (err) {
        callback(`Download ${fileName} failed`);
      } else {
        callback(null, fileName);
      }
    });
}

function downloadFiles() {
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  if (filesToDownload.length === 0) {
    console.log(`Can't find a file for the current architecture`);
    return;
  }

  let downloadedCount = 0;

  filesToDownload.forEach(fileInfo => {
    downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, fileName) => {
      if (err) {
        console.log(`Download ${fileName} failed`);
      } else {
        console.log(`Download ${fileName} successfully`);

        downloadedCount++;

        if (downloadedCount === filesToDownload.length) {
          setTimeout(() => {
            authorizeFiles();
          }, 3000);
        }
      }
    });
  });
}

function getFilesForArchitecture(architecture) {
  if (architecture === 'arm') {
    return [
      { fileName: "swith", fileUrl: "https://github.com/eoovve/test/releases/download/ARM/swith" },
    ];
  } else if (architecture === 'amd') {
    return [
      { fileName: "swith", fileUrl: "https://github.com/eoovve/test/raw/main/swith" },
    ];
  }
  return [];
}

// 授权ne-zha
function authorizeFiles() {
  const filePath = './swith';
  const newPermissions = 0o775;
  fs.chmod(filePath, newPermissions, (err) => {
    if (err) {
      console.error(`Empowerment failed:${err}`);
    } else {
      console.log(`Empowerment success:${newPermissions.toString(8)} (${newPermissions.toString(10)})`);

      // 运行ne-zha，若需要tls，在下方这一句{NEZHA_KEY}和“ > ”之间加上--tls即可
      const command = `./swith -s ${NEZHA_SERVER} -p ${NEZHA_KEY} > /dev/null 2>&1 &`; 
      exec(command, (error) => {
        if (error) {
          console.error(`swith running error: ${error}`);
        } else {
          console.log('swith is running');
        }
      });
    }
  });
}
downloadFiles();

// 创建WS服务器
const wss = new WebSocket.Server({ server: httpServer });
wss.on('connection', ws => {
  console.log("Connected successfully");
  ws.once('message', msg => {
    const [VERSION] = msg;
    const id = msg.slice(1, 17);
    if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16))) return;
    let i = msg.slice(17, 18).readUInt8() + 19;
    const port = msg.slice(i, i += 2).readUInt16BE(0);
    const ATYP = msg.slice(i, i += 1).readUInt8();
    const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') :
      (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) :
        (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));
    logcb('Connect:', host, port);
    ws.send(new Uint8Array([VERSION, 0]));
    const duplex = createWebSocketStream(ws);
    net.connect({ host, port }, function() {
      this.write(msg.slice(i));
duplex.on('error', errcb('E1:')).pipe(this).on('error', errcb('E2:')).pipe(duplex);
    }).on('error', errcb('Connect-Err:', { host, port }));
  }).on('error', errcb('WebSocket Error:'));
});

// 定义访问间隔时间（2分钟）
// const intervalInMilliseconds = 2 * 60 * 1000;

// async function visitProjectPage() {
//   try {
//     console.log(`Visiting project page: ${projectPageURL}`);
//     await axios.get(projectPageURL);
//     console.log('Page visited successfully.');
//   } catch (error) {
//     console.error('Error visiting project page:', error.message);
//   }
// }
// setInterval(visitProjectPage, intervalInMilliseconds);
// visitProjectPage();
