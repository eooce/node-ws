const os = require('os');
const http = require('http');
const fs = require('fs');
const axios = require('axios');
const net = require('net');
const path = require('path');
const { Buffer } = require('buffer');
const { exec, execSync } = require('child_process');
const { WebSocket, createWebSocketStream } = require('ws');
const UUID = process.env.UUID || '5efabea4-f6d4-91fd-b8f0-17e004c89c60'; // 运行哪吒v1,在不同的平台需要改UUID,否则会被覆盖
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';       // 哪吒v1填写形式：nz.abc.com:8008   哪吒v0填写形式：nz.abc.com
const NEZHA_PORT = process.env.NEZHA_PORT || '';           // 哪吒v1没有此变量，v0的agent端口为{443,8443,2096,2087,2083,2053}其中之一时开启tls
const NEZHA_KEY = process.env.NEZHA_KEY || '';             // v1的NZ_CLIENT_SECRET或v0的agent端口                
const DOMAIN = process.env.DOMAIN || 'xx-hf.space.domain'; // 填写项目域名或已反代的域名，不带前缀，建议填已反代的域名
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;      // 是否开启自动访问保活,false为关闭,true为开启,需同时填写DOMAIN变量
const WSPATH = process.env.WSPATH || UUID.slice(0, 8);     // 节点路径，默认获取uuid前8位
const SUB_PATH = process.env.SUB_PATH || 'sub';            // 获取节点的订阅路径
const NAME = process.env.NAME || 'Hug';                    // 节点名称
const PORT = process.env.PORT || 7860;                     // http和ws服务端口

let ISP = '';
const GetISP = async () => {
  try {
    const res = await axios.get('https://speed.cloudflare.com/meta');
    const data = res.data;
    ISP = `${data.country}-${data.asOrganization}`.replace(/ /g, '_');
  } catch (e) {
    ISP = 'Unknown';
  }
}
GetISP();
const httpServer = http.createServer((req, res) => {
  if (req.url === '/') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
                return;
            }
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        });
        return;
  } else if (req.url === `/${SUB_PATH}`) {
    const vlessURL = `vless://${UUID}@www.visa.com.tw:443?encryption=none&security=tls&sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F${WSPATH}#${NAME}-${ISP}`;
    const base64Content = Buffer.from(vlessURL).toString('base64');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(base64Content + '\n');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }
});

const wss = new WebSocket.Server({ server: httpServer });
const uuid = UUID.replace(/-/g, "");
const DNS_SERVERS = ['8.8.4.4', '1.1.1.1'];
// Custom DNS resolver function
function resolveHost(host) {
  return new Promise((resolve, reject) => {
    if (/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(host)) {
      resolve(host);
      return;
    }

    let attempts = 0;
    
    function tryNextDNS() {
      if (attempts >= DNS_SERVERS.length) {
        reject(new Error(`Failed to resolve ${host} with all DNS servers`));
        return;
      }
      
      const dnsServer = DNS_SERVERS[attempts];
      attempts++;
      const dnsQuery = `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`;
      axios.get(dnsQuery, {
        timeout: 5000,
        headers: {
          'Accept': 'application/dns-json'
        }
      })
      .then(response => {
        const data = response.data;
        if (data.Status === 0 && data.Answer && data.Answer.length > 0) {
          const ip = data.Answer.find(record => record.type === 1);
          if (ip) {
            resolve(ip.data);
            return;
          }
        }
        tryNextDNS();
      })
      .catch(error => {
        // console.warn(`DNS resolution failed with ${dnsServer}:`, error.message);
        tryNextDNS();
      });
    }
    
    tryNextDNS();
  });
}

wss.on('connection', ws => {
  // console.log("Connected successfully");
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
    // console.log(`Connection from ${host}:${port}`);
    ws.send(new Uint8Array([VERSION, 0]));
    const duplex = createWebSocketStream(ws);
    
    // Resolve hostname using custom DNS before connecting
    resolveHost(host)
      .then(resolvedIP => {
        console.log(`Resolved ${host} to ${resolvedIP} using custom DNS`);
        net.connect({ host: resolvedIP, port }, function() {
          this.write(msg.slice(i));
          duplex.on('error', () => {}).pipe(this).on('error', () => {}).pipe(duplex);
        }).on('error', (error) => {
          console.error(`Connection error to ${resolvedIP}:${port}`, error.message);
        });
      })
      .catch(error => {
        console.error(`DNS resolution failed for ${host}:`, error.message);
        // Fallback to system DNS
        net.connect({ host, port }, function() {
          this.write(msg.slice(i));
          duplex.on('error', () => {}).pipe(this).on('error', () => {}).pipe(duplex);
        }).on('error', (error) => {
          console.error(`Connection error to ${host}:${port}`, error.message);
        });
      });
  }).on('error', () => {});
});

const getDownloadUrl = () => {
  const arch = os.arch(); 
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
    if (!NEZHA_PORT) {
      return 'https://arm64.ssss.nyc.mn/v1';
    } else {
        return 'https://arm64.ssss.nyc.mn/agent';
    }
  } else {
    if (!NEZHA_PORT) {
      return 'https://amd64.ssss.nyc.mn/v1';
    } else {
        return 'https://amd64.ssss.nyc.mn/agent';
    }
  }
};

const downloadFile = async () => {
  if (!NEZHA_SERVER && !NEZHA_KEY) return;  // 不存在nezha变量时不下载文件
  
  try {
    const url = getDownloadUrl();
    // console.log(`Start downloading file from ${url}`);
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream('npm');
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('npm download successfully');
        exec('chmod +x npm', (err) => {
          if (err) reject(err);
          resolve();
        });
      });
      writer.on('error', reject);
    });
  } catch (err) {
    throw err;
  }
};

const runnz = async () => {
  try {
    const status = execSync('ps aux | grep -v "grep" | grep "./[n]pm"', { encoding: 'utf-8' });
    if (status.trim() !== '') {
      console.log('npm is already running, skip running...');
      return;
    }
  } catch (e) {
    //进程不存在时继续运行nezha
  }

  await downloadFile();
  let command = '';
  let tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
  
  if (NEZHA_SERVER && NEZHA_PORT && NEZHA_KEY) {
    // 检测哪吒v0是否开启TLS
    const NEZHA_TLS = tlsPorts.includes(NEZHA_PORT) ? '--tls' : '';
    command = `setsid nohup ./npm -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`;
  } else if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      // 检测哪吒v1是否开启TLS
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const NZ_TLS = tlsPorts.includes(port) ? 'true' : 'false';
      const configYaml = `client_secret: ${NEZHA_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NEZHA_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${NZ_TLS}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}`;
      
      fs.writeFileSync('config.yaml', configYaml);
    }
    command = `setsid nohup ./npm -c config.yaml >/dev/null 2>&1 &`;
  } else {
    console.log('NEZHA variable is empty, skip running');
    return;
  }

  try {
    exec(command, { shell: '/bin/bash' }, (err) => {
      if (err) console.error('npm running error:', err);
      else console.log('npm is running');
    });
  } catch (error) {
    console.error(`error: ${error}`);
  }   
}; 

async function addAccessTask() {
  if (!AUTO_ACCESS) return;

  if (!DOMAIN) {
    // console.log('URL is empty. Skip Adding Automatic Access Task');
    return;
  }
  const fullURL = `https://${DOMAIN}/${SUB_PATH}`;
  try {
    const res = await axios.post("https://oooo.serv00.net/add-url", {
      url: fullURL
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('Automatic Access Task added successfully');
  } catch (error) {
    // console.error('Error adding Task:', error.message);
  }
}

const delFiles = () => {
  fs.unlink('npm', () => {});
  fs.unlink('config.yaml', () => {}); 
};

httpServer.listen(PORT, () => {
  runnz();
  setTimeout(() => {
    delFiles();
  }, 180000); // 180s
  addAccessTask();
  console.log(`Server is running on port ${PORT}`);
});
