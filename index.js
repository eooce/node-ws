#!/usr/bin/env node

const os = require('os');
const http = require('http');
const fs = require('fs');
const net = require('net');
const dns = require('dns');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const axios = require('axios');
const si = require('systeminformation');
const grpc = require('@grpc/grpc-js');
const { spawn } = require('child_process');
const protoLoader = require('@grpc/proto-loader');
const { WebSocket, createWebSocketStream } = require('ws');

// ========================== 环境变量配置 ==========================
const UUID = process.env.UUID || 'd1cf4b9c-3e57-085d-b34a-797fcf801380'; // 节点UUID、哪吒的UUID、tg-webproxy的secret
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';       // 仅支持哪吒v1，格式：nz.xxx.com:8008
const NEZHA_KEY = process.env.NEZHA_KEY || '';             // nz_client_secret密钥
const DOMAIN = process.env.DOMAIN || 'your-domain.com';    // 项目分配的域名或回源后的域名,例如：xxx.xxx.com
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;      // 是否开启自动访问保活，需确保DOMAIN可用
const SUB_PATH = process.env.SUB_PATH || 'sub';            // 订阅token
const NAME = process.env.NAME || '';                       // 节点名称
const PORT = process.env.PORT || 3000;                     // http+ws端口

// NZ-Agent 配置
const AGENT_VERSION = 'nodejs-9.9.9';
const REPORT_DELAY = 4;
const RETRY_DELAY = 10000;
const IP_REPORT_PERIOD = 1800;   
const NETWORK_TIMEOUT = 10000;  // 10s

// 日志控制 
const SHOW_LOG = !!(process.env.SHOW_LOG);
function log(...args) { if (SHOW_LOG) console.log(...args); }
function logErr(...args) { if (SHOW_LOG) console.error(...args); }
function logWarn(...args) { if (SHOW_LOG) console.warn(...args); }

// 辅助工具
const WSPATH = process.env.WSPATH || UUID.slice(0, 8); // WS 路径
const TLS_PORTS = new Set([443, 2053, 2083, 2087, 2096, 8443]); // NZ-TLS 端口列表
let uuid = UUID.replace(/-/g, ""), CurrentDomain = DOMAIN, Tls = 'tls', CurrentPort = 443, ISP = '';
const DNS_SERVERS = ['8.8.4.4', '1.1.1.1'];
const BLOCKED_DOMAINS = [
  'speedtest.net', 'fast.com', 'speedtest.cn', 'speed.cloudflare.com', 'speedof.me',
   'testmy.net', 'bandwidth.place', 'speed.io', 'librespeed.org', 'speedcheck.org'
];

//  TLS 检测
function shouldUseTLS(server) {
    const parts = server.split(':');
    if (parts.length < 2) return false;
    const port = parseInt(parts[parts.length - 1], 10);
    return TLS_PORTS.has(port);
}

// block speedtest domains
function isBlockedDomain(host) {
  if (!host) return false;
  const hostLower = host.toLowerCase();
  return BLOCKED_DOMAINS.some(blocked => {
    return hostLower === blocked || hostLower.endsWith('.' + blocked);
  });
}

// 获取isp
async function getisp() {
  if (!axios) { ISP = ''; return; }
  try {
    const res = await axios.get('https://api.ip.sb/geoip', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 }});
    const data = res.data;
    ISP = `${data.country_code}-${data.isp}`.replace(/ /g, '_');
  } catch (e) {
    try {
      const res2 = await axios.get('http://ip-api.com/json', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 }});
      const data2 = res2.data;
      ISP = `${data2.countryCode}-${data2.org}`.replace(/ /g, '_');
    } catch (e2) {
      ISP = 'Unknown';
    }
  }
}

// 获取ip
async function getip() {
  if (!DOMAIN || DOMAIN === 'your-domain.com') {
      try {
          const res = await axios.get('https://api-ipv4.ip.sb/ip', { timeout: 5000 });
          const ip = res.data.trim();
          CurrentDomain = ip, Tls = 'none', CurrentPort = PORT;
      } catch (e) {
          console.error('Failed to get IP', e.message);
          CurrentDomain = 'cahnge-your-domain.com', Tls = 'tls', CurrentPort = 443;
      }
  } else {
      CurrentDomain = DOMAIN, Tls = 'tls', CurrentPort = 443;
  }
}

// HTTP 路由
const httpServer = http.createServer(async (req, res) => {
  try { if (await tgRoute(req, res)) return; } catch (e) { console.error('[TG] route error:', e.message); }
  if (req.url === '/') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('Hello world!');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return;
  } else if (req.url === `/${SUB_PATH}`) {
    await getisp();await getip();
    const namePart = NAME ? `${NAME}-${ISP}` : ISP;
    const tlsParam = Tls === 'tls' ? 'tls' : 'none';
    const ssTlsParam = Tls === 'tls' ? 'tls;' : '';
    const vlsURL = `vless://${UUID}@${CurrentDomain}:${CurrentPort}?encryption=none&security=${tlsParam}&sni=${CurrentDomain}&fp=chrome&type=ws&host=${CurrentDomain}&path=%2F${WSPATH}#${namePart}`;
    const troURL = `trojan://${UUID}@${CurrentDomain}:${CurrentPort}?security=${tlsParam}&sni=${CurrentDomain}&fp=chrome&type=ws&host=${CurrentDomain}&path=%2F${WSPATH}#${namePart}`;
    const ssMethodPassword = Buffer.from(`none:${UUID}`).toString('base64');
    const ssURL = `ss://${ssMethodPassword}@${CurrentDomain}:${CurrentPort}?plugin=v2ray-plugin;mode%3Dwebsocket;host%3D${CurrentDomain};path%3D%2F${WSPATH};${ssTlsParam}sni%3D${CurrentDomain};skip-cert-verify%3Dtrue;mux%3D0#${namePart}`;
    const subscription = vlsURL + '\n' + troURL + '\n' + ssURL;
    const base64Content = Buffer.from(subscription).toString('base64');

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(base64Content + '\n');
  } else if (req.url === `/${SUB_PATH}-tg`) {
    await getip();
    const tgLink = `https://t.me/webproxy?server=${CurrentDomain}&secret=${uuid}`;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TG Webproxy link:' + '\n\n'+ tgLink);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }
});

// Custom DNS
function resolveHost(host) {
  return new Promise((resolve, reject) => {
    if (/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(host)) {
      resolve(host);
      return;
    }
    let attempts = 0;
    function tryNextDNS() {
      if (!axios) {
        dns.promises.resolve4(host).then(resolve, () => reject(new Error(`Failed to resolve ${host}`)));
        return;
      }
      if (attempts >= DNS_SERVERS.length) {
        reject(new Error(`Failed to resolve ${host} with all DNS servers`));
        return;
      }
      const dnsServer = DNS_SERVERS[attempts];
      attempts++;
      const dnsQuery = `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`;
      axios.get(dnsQuery, {
        timeout: 5000,
        headers: { 'Accept': 'application/dns-json' }
      })
        .then(response => {
          const data = response.data;
          if (data.Status === 0 && data.Answer && data.Answer.length > 0) {
            const ip = data.Answer.find(record => record.type === 1);
            if (ip) { resolve(ip.data); return; }
          }
          tryNextDNS();
        })
        .catch(error => { tryNextDNS(); });
    }
    tryNextDNS();
  });
}

// VLE-SS处理
function handleVlsConnection(ws, msg) {
  const [VERSION] = msg;
  const id = msg.slice(1, 17);
  if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16))) return false;

  let i = msg.slice(17, 18).readUInt8() + 19;
  const port = msg.slice(i, i += 2).readUInt16BE(0);
  const ATYP = msg.slice(i, i += 1).readUInt8();
  const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') :
    (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) :
      (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : ''));

  if (isBlockedDomain(host)) { ws.close(); return false; }
  ws.send(new Uint8Array([VERSION, 0]));
  const duplex = createWebSocketStream(ws);
  resolveHost(host)
    .then(resolvedIP => {
      net.connect({ host: resolvedIP, port }, function () {
        this.write(msg.slice(i));
        duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
      }).on('error', () => { });
    })
    .catch(error => {
      net.connect({ host, port }, function () {
        this.write(msg.slice(i));
        duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
      }).on('error', () => { });
    });
  return true;
}

// Tro-jan处理
function handleTrojConnection(ws, msg) {
  try {
    if (msg.length < 58) return false;
    const receivedPasswordHash = msg.slice(0, 56).toString();
    const possiblePasswords = [UUID];
    let matchedPassword = null;
    for (const pwd of possiblePasswords) {
      const hash = crypto.createHash('sha224').update(pwd).digest('hex');
      if (hash === receivedPasswordHash) { matchedPassword = pwd; break; }
    }
    if (!matchedPassword) return false;
    let offset = 56;
    if (msg[offset] === 0x0d && msg[offset + 1] === 0x0a) offset += 2;
    const cmd = msg[offset];
    if (cmd !== 0x01) return false;
    offset += 1;
    const atyp = msg[offset];
    offset += 1;
    let host, port;
    if (atyp === 0x01) {
      host = msg.slice(offset, offset + 4).join('.'); offset += 4;
    } else if (atyp === 0x03) {
      const hostLen = msg[offset]; offset += 1;
      host = msg.slice(offset, offset + hostLen).toString(); offset += hostLen;
    } else if (atyp === 0x04) {
      host = msg.slice(offset, offset + 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':'); offset += 16;
    } else { return false; }
    port = msg.readUInt16BE(offset); offset += 2;
    if (offset < msg.length && msg[offset] === 0x0d && msg[offset + 1] === 0x0a) offset += 2;
    if (isBlockedDomain(host)) { ws.close(); return false; }
    const duplex = createWebSocketStream(ws);
    resolveHost(host)
      .then(resolvedIP => {
        net.connect({ host: resolvedIP, port }, function () {
          if (offset < msg.length) this.write(msg.slice(offset));
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      })
      .catch(error => {
        net.connect({ host, port }, function () {
          if (offset < msg.length) this.write(msg.slice(offset));
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      });
    return true;
  } catch (error) { return false; }
}

// Ss处理
function handleSsConnection(ws, msg) {
  try {
    let offset = 0;
    const atyp = msg[offset]; offset += 1;
    let host, port;
    if (atyp === 0x01) {
      host = msg.slice(offset, offset + 4).join('.'); offset += 4;
    } else if (atyp === 0x03) {
      const hostLen = msg[offset]; offset += 1;
      host = msg.slice(offset, offset + hostLen).toString(); offset += hostLen;
    } else if (atyp === 0x04) {
      host = msg.slice(offset, offset + 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':'); offset += 16;
    } else { return false; }
    port = msg.readUInt16BE(offset); offset += 2;
    if (isBlockedDomain(host)) { ws.close(); return false; }
    const duplex = createWebSocketStream(ws);
    resolveHost(host)
      .then(resolvedIP => {
        net.connect({ host: resolvedIP, port }, function () {
          if (offset < msg.length) this.write(msg.slice(offset));
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      })
      .catch(error => {
        net.connect({ host, port }, function () {
          if (offset < msg.length) this.write(msg.slice(offset));
          duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
        }).on('error', () => { });
      });
    return true;
  } catch (error) { return false; }
}

// Ws handler
const wss = new WebSocket.Server({ noServer: true });
// WS 路径分发：/${WSPATH} -> vless/trojan/ss；/api/v1/ws -> Telegram WEB Proxy
httpServer.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url === '/api/v1/ws') {
    tgWsUpgrade(req, socket, head);
  } else if (url.startsWith(`/${WSPATH}`)) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
wss.on('connection', (ws, req) => {
  const url = req.url || '';
  const expectedPath = `/${WSPATH}`;
  if (!url.startsWith(expectedPath)) { ws.close(); return; }

  ws.once('message', msg => {
    if (msg.length > 17 && msg[0] === 0) {
      const id = msg.slice(1, 17);
      const isVless = id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16));
      if (isVless) { if (!handleVlsConnection(ws, msg)) ws.close(); return; }
    }
    if (msg.length >= 58) { if (handleTrojConnection(ws, msg)) return; }
    if (msg.length > 0 && (msg[0] === 0x01 || msg[0] === 0x03 || msg[0] === 0x04)) {
      if (handleSsConnection(ws, msg)) return;
    }
    ws.close();
  }).on('error', () => { });
});

// 添加自动保活任务
async function addAccessTask() {
  if (!AUTO_ACCESS || !axios) return;
  if (!DOMAIN) return;
  const fullURL = `https://${DOMAIN}/${SUB_PATH}`;
  try {
    const res = await axios.post("https://oooo.serv00.net/add-url", { url: fullURL }, { headers: { 'Content-Type': 'application/json' } });
    console.log('Automatic Access Task added successfully');
  } catch (error) { }
}

// NZ-Agent: Proto 定义 
const PROTO_CONTENT = `
syntax = "proto3";
option go_package = "./proto";
package proto;

service NezhaService {
  rpc ReportSystemState(stream State) returns (stream Receipt) {}
  rpc ReportSystemInfo(Host) returns (Receipt) {}
  rpc RequestTask(stream TaskResult) returns (stream Task) {}
  rpc IOStream(stream IOStreamData) returns (stream IOStreamData) {}
  rpc ReportGeoIP(GeoIP) returns (GeoIP) {}
  rpc ReportSystemInfo2(Host) returns (Uint64Receipt) {}
}

message Host {
  string platform = 1;
  string platform_version = 2;
  repeated string cpu = 3;
  uint64 mem_total = 4;
  uint64 disk_total = 5;
  uint64 swap_total = 6;
  string arch = 7;
  string virtualization = 8;
  uint64 boot_time = 9;
  string version = 10;
  repeated string gpu = 11;
}

message State {
  double cpu = 1;
  uint64 mem_used = 2;
  uint64 swap_used = 3;
  uint64 disk_used = 4;
  uint64 net_in_transfer = 5;
  uint64 net_out_transfer = 6;
  uint64 net_in_speed = 7;
  uint64 net_out_speed = 8;
  uint64 uptime = 9;
  double load1 = 10;
  double load5 = 11;
  double load15 = 12;
  uint64 tcp_conn_count = 13;
  uint64 udp_conn_count = 14;
  uint64 process_count = 15;
  repeated State_SensorTemperature temperatures = 16;
  repeated double gpu = 17;
}

message State_SensorTemperature {
  string name = 1;
  double temperature = 2;
}

message Task {
  uint64 id = 1;
  uint64 type = 2;
  string data = 3;
}

message TaskResult {
  uint64 id = 1;
  uint64 type = 2;
  float delay = 3;
  string data = 4;
  bool successful = 5;
}

message Receipt { bool proced = 1; }
message Uint64Receipt { uint64 data = 1; }
message IOStreamData { bytes data = 1; }

message GeoIP {
  bool use6 = 1;
  IP ip = 2;
  string country_code = 3;
  uint64 dashboard_boot_time = 4;
}

message IP {
  string ipv4 = 1;
  string ipv6 = 2;
}
`;

function loadProto() {
    const tmpFile = path.join(os.tmpdir(), `nezha_${process.pid}.proto`);
    fs.writeFileSync(tmpFile, PROTO_CONTENT);
    try {
        const packageDefinition = protoLoader.loadSync(tmpFile, {
            keepCase: false, longs: Number, enums: Number, defaults: true, oneofs: true,
        });
        const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
        return protoDescriptor.proto;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (e) {}
    }
}

// NZ-Agent: gRPC 认证
function buildMetadata() {
    const meta = new grpc.Metadata();
    meta.add('client-secret', NEZHA_KEY);
    meta.add('client-uuid', UUID);
    meta.add('client_secret', NEZHA_KEY);
    meta.add('client_uuid', UUID);
    return meta;
}

// NZ-Agent: 系统监控
let netInTransfer = 0, netOutTransfer = 0;
let netInSpeed = 0, netOutSpeed = 0;
let lastNetUpdate = 0;
let activeIOStreams = 0;
let lastReportedIP = null;

const EXCLUDE_INTERFACES = ['lo', 'tun', 'docker', 'veth', 'br-', 'vmbr', 'vnet', 'kube', 'Meta', 'tailscale', 'fw', 'tap'];
const EXPECT_FS_TYPES = new Set(['apfs', 'ext4', 'ext3', 'ext2', 'f2fs', 'reiserfs', 'jfs', 'bcachefs', 'btrfs', 'fuseblk', 'zfs', 'simfs', 'ntfs', 'fat32', 'exfat', 'xfs', 'fuse.rclone']);

function shouldExcludeInterface(name) { return EXCLUDE_INTERFACES.some(ex => name.includes(ex)); }

function getArch() {
    switch (process.arch) {
        case 'x64': return 'x86_64';
        case 'arm64': return 'aarch64';
        case 'ia32': return 'i386';
        default: return process.arch;
    }
}

async function getHost() {
    const [osInfo, cpuInfo, memInfo, fsSize] = await Promise.all([
        si.osInfo(), si.cpu(), si.mem(), si.fsSize(),
    ]);
    let platform = osInfo.distro || process.platform;
    let platformVersion = osInfo.release || '';
    const cpuStr = `${cpuInfo.manufacturer} ${cpuInfo.brand} ${cpuInfo.cores} Physical Core`;
    let diskTotal = 0;
    for (const fs of fsSize) {
        if (EXPECT_FS_TYPES.has((fs.type || '').toLowerCase())) diskTotal += fs.size || 0;
    }
    const bootTime = Math.floor(Date.now() / 1000 - os.uptime());
    return {
        platform, platformVersion, cpu: [cpuStr], memTotal: memInfo.total,
        diskTotal, swapTotal: memInfo.swaptotal || 0, arch: getArch(),
        virtualization: '', bootTime, version: AGENT_VERSION, gpu: [],
    };
}

async function trackNetworkSpeed() {
    try {
        const networkStats = await si.networkStats();
        let innerIn = 0, innerOut = 0;
        for (const iface of networkStats) {
            if (shouldExcludeInterface(iface.iface)) continue;
            innerIn += iface.rx_bytes || 0;
            innerOut += iface.tx_bytes || 0;
        }
        const now = Math.floor(Date.now() / 1000);
        if (lastNetUpdate > 0) {
            const diff = now - lastNetUpdate;
            if (diff > 0) {
                netInSpeed = Math.max(0, (innerIn - netInTransfer) / diff);
                netOutSpeed = Math.max(0, (innerOut - netOutTransfer) / diff);
            }
        }
        netInTransfer = innerIn;
        netOutTransfer = innerOut;
        lastNetUpdate = now;
    } catch (e) { }
}

function getConnCount() {
    if (process.platform === 'linux') {
        try {
            const tcp = fs.readFileSync('/proc/net/tcp', 'utf8');
            const tcp6 = fs.readFileSync('/proc/net/tcp6', 'utf8');
            const udp = fs.readFileSync('/proc/net/udp', 'utf8');
            const udp6 = fs.readFileSync('/proc/net/udp6', 'utf8');
            const tcpCount = Math.max(0, tcp.split('\n').length - 2) + Math.max(0, tcp6.split('\n').length - 2);
            const udpCount = Math.max(0, udp.split('\n').length - 2) + Math.max(0, udp6.split('\n').length - 2);
            return [tcpCount, udpCount];
        } catch (e) { return [0, 0]; }
    }
    return [0, 0];
}

function getProcessCountSync() {
    if (process.platform === 'linux') {
        try {
            const dirs = fs.readdirSync('/proc');
            let count = 0;
            for (let i = 0; i < dirs.length; i++) { if (/^\d+$/.test(dirs[i])) count++; }
            return count;
        } catch (e) { return 0; }
    }
    return -1;
}

async function getState() {
    const [currentLoad, memInfo, fsSize] = await Promise.all([
        si.currentLoad(), si.mem(), si.fsSize(),
    ]);
    const cpu = currentLoad.currentLoad || 0;
    let memUsed;
    if (process.platform === 'linux' && memInfo.active) {
        memUsed = memInfo.active;
    } else if (process.platform === 'linux') {
        memUsed = Math.max(0, (memInfo.used || 0) - (memInfo.buffcache || 0));
    } else {
        memUsed = memInfo.used || 0;
    }
    const swapUsed = memInfo.swapused || 0;
    let diskUsed = 0;
    for (const fs of fsSize) {
        if (EXPECT_FS_TYPES.has((fs.type || '').toLowerCase())) diskUsed += fs.used || 0;
    }
    const load = os.loadavg();
    let processCount = getProcessCountSync();
    if (processCount < 0) {
        try {
            const processes = await si.processes();
            processCount = processes.all || 0;
        } catch (e) { processCount = 0; }
    }
    const uptime = Math.floor(os.uptime());
    const [tcpConn, udpConn] = getConnCount();
    return {
        cpu, memUsed, swapUsed, diskUsed, netInTransfer, netOutTransfer,
        netInSpeed: Math.floor(netInSpeed), netOutSpeed: Math.floor(netOutSpeed),
        uptime, load1: load[0] || 0, load5: load[1] || 0, load15: load[2] || 0,
        tcpConnCount: tcpConn, udpConnCount: udpConn, processCount, temperatures: [], gpu: [],
    };
}

// NZ-Agent: GeoIP
function makeLookup(family) {
    return (hostname, opts, callback) => { dns.lookup(hostname, { family }, callback); };
}

function parseIPFromResponse(body, family) {
    const trimmed = body.trim();
    if (family === 4 && net.isIPv4(trimmed)) return trimmed;
    if (family === 6 && net.isIPv6(trimmed)) return trimmed;
    const lines = trimmed.split('\n');
    for (const line of lines) {
        if (line.startsWith('ip=')) {
            const ip = line.substring(3).trim();
            if (family === 4 && net.isIPv4(ip)) return ip;
            if (family === 6 && net.isIPv6(ip)) return ip;
        }
    }
    return '';
}

async function fetchIP() {
    const ipv4Endpoints = ['https://ipv4.ip.sb/ip', 'https://blog.cloudflare.com/cdn-cgi/trace', 'https://developers.cloudflare.com/cdn-cgi/trace'];
    const ipv6Endpoints = ['https://ipv6.ip.sb/ip', 'https://blog.cloudflare.com/cdn-cgi/trace', 'https://developers.cloudflare.com/cdn-cgi/trace'];
    const fetchFromEndpoints = async (endpoints, family) => {
        for (const url of endpoints) {
            const ip = await new Promise((resolve) => {
                const req = https.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' }, lookup: makeLookup(family) }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => { resolve(parseIPFromResponse(data, family)); });
                });
                req.on('error', () => resolve(''));
                req.on('timeout', () => { req.destroy(); resolve(''); });
            });
            if (ip) return ip;
        }
        return '';
    };
    const [ipv4, ipv6] = await Promise.all([fetchFromEndpoints(ipv4Endpoints, 4), fetchFromEndpoints(ipv6Endpoints, 6)]);
    return { ipv4, ipv6 };
}

async function reportGeoIP(client, metadata, forceUpdate = false) {
    try {
        const { ipv4, ipv6 } = await fetchIP();
        const currentIPKey = ipv4 || ipv6 || '';
        if (!forceUpdate && lastReportedIP !== null && currentIPKey === lastReportedIP) return true;
        if (!ipv4 && !ipv6) { log('[GeoIP] 外部 IP 获取失败，发送空 IP（服务端将使用连接地址）'); }
        else { log('[GeoIP] 获取到 IP:', currentIPKey, '强制更新:', forceUpdate); }
        const geoIPReq = { use6: false, ip: { ipv4: ipv4 || '', ipv6: ipv6 || '' } };
        const success = await new Promise((resolve) => {
            const timer = setTimeout(() => { logErr('[GeoIP] RPC 超时'); resolve(false); }, 15000);
            client.ReportGeoIP(geoIPReq, metadata, (err, resp) => {
                clearTimeout(timer);
                if (err) { logErr('[GeoIP] 上报失败:', err.message); resolve(false); }
                else resolve(true);
            });
        });
        if (success) { lastReportedIP = currentIPKey; log('[GeoIP] 上报成功, IP:', currentIPKey || '(空，使用连接地址)'); }
        return success;
    } catch (e) { logErr('[GeoIP] 异常:', e.message); return false; }
}

// NZ-Agent: 终端任务
const TaskType = { TerminalGRPC: 8, FM: 11 };

function handleTerminalTask(task, client, metadata) {
    let terminal;
    try { terminal = JSON.parse(task.data); } catch (e) { logErr('[Terminal] 任务解析错误:', e.message); return; }

    const ioStream = client.IOStream(metadata);
    let streamClosed = false;
    let ptyProcess = null;
    let keepAlive = null;
    activeIOStreams++;

    function cleanup() {
        if (streamClosed) return;
        streamClosed = true;
        activeIOStreams--;
        if (keepAlive) clearInterval(keepAlive);
        try { ioStream.end(); } catch (e) {}
        if (ptyProcess) { try { ptyProcess.kill(); } catch (e) {} }
    }

    ioStream.on('error', (err) => { logErr('[Terminal] IOStream 错误:', err.message); cleanup(); });
    ioStream.on('end', () => { cleanup(); });
    ioStream.on('status', (status) => {
        if (status.code !== 0 && status.code !== grpc.status.OK) { logErr('[Terminal] IOStream 状态异常:', status.code, status.details); cleanup(); }
    });

    const streamIDData = Buffer.concat([Buffer.from([0xff, 0x05, 0xff, 0x05]), Buffer.from(terminal.StreamID || '')]);
    try { ioStream.write({ data: streamIDData }); }
    catch (e) { logErr('[Terminal] 发送 StreamID 失败:', e.message); cleanup(); return; }

    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
    let ptyModule = null;
    try { ptyModule = require('node-pty'); } catch (e) { }

    if (ptyModule) {
        try {
            ptyProcess = ptyModule.spawn(shell, [], {
                name: 'xterm', cols: 80, rows: 40,
                cwd: process.env.HOME || process.cwd(),
                env: { ...process.env, TERM: 'xterm' },
            });
        } catch (e) { logErr('[Terminal] PTY 启动失败:', e.message); }
    }

    if (!ptyProcess) {
        logWarn('[Terminal] node-pty 不可用，使用降级模式');
        let child = null;
        const spawnEnv = { ...process.env, TERM: 'xterm' };
        const spawnCwd = process.env.HOME || process.cwd();

        if (process.platform !== 'win32') {
            const tryStart = (cmd, args) => {
                try {
                    const c = spawn(cmd, args, { cwd: spawnCwd, env: spawnEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
                    if (c.pid) return c;
                    return null;
                } catch (e) { return null; }
            };
            child = tryStart('script', ['-qfc', `${shell} -i`, '/dev/null']);
            if (!child) {
                log('[Terminal] script 不可用，尝试 python3 pty');
                child = tryStart('python3', ['-c', 'import pty,os,sys;pty.spawn([os.environ.get("SHELL","/bin/bash"),"-i"])']);
            }
            if (!child) {
                child = tryStart('python', ['-c', 'import pty,os,sys;pty.spawn([os.environ.get("SHELL","/bin/bash"),"-i"])']);
            }
            if (!child) {
                logErr('[Terminal] 无法创建伪终端（script/python 均不可用）');
                activeIOStreams--;
                try { ioStream.end(); } catch (e) {}
                return;
            }
        } else {
            child = spawn(shell, [], { cwd: spawnCwd, env: spawnEnv, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
        }

        child.on('error', (err) => { logErr('[Terminal] 子进程启动失败:', err.message); });

        ptyProcess = {
            write: (data) => { try { child.stdin.write(data); } catch (e) {} },
            onData: (cb) => { child.stdout.on('data', cb); child.stderr.on('data', cb); },
            resize: () => {},
            kill: () => {
                try {
                    if (process.platform !== 'win32' && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {} }
                    child.kill('SIGKILL');
                } catch (e) {}
            },
            onExit: (cb) => {
                child.on('exit', (code) => cb({ exitCode: code || 0 }));
                child.on('error', (err) => { logErr('[Terminal] 子进程错误:', err.message); cb({ exitCode: -1 }); });
            },
        };
    }

    log('[Terminal] 初始化, StreamID:', terminal.StreamID);

    ptyProcess.onData((data) => {
        if (streamClosed) return;
        try { ioStream.write({ data: Buffer.from(data) }); } catch (e) { }
    });

    ioStream.on('data', (msg) => {
        const data = Buffer.from(msg.data || []);
        if (data.length === 0) return;
        switch (data[0]) {
            case 0: try { ptyProcess.write(data.slice(1)); } catch (e) {} break;
            case 1: try { const resize = JSON.parse(data.slice(1).toString()); if (ptyProcess.resize) ptyProcess.resize(resize.Cols || 80, resize.Rows || 40); } catch (e) {} break;
        }
    });

    keepAlive = setInterval(() => {
        if (streamClosed) return;
        try { ioStream.write({ data: Buffer.alloc(0) }); } catch (e) {}
    }, 30000);

    ptyProcess.onExit((e) => { log('[Terminal] 退出, StreamID:', terminal.StreamID, 'code:', e.exitCode); cleanup(); });
}

// NZ-Agent: SFTP
const FM_NZFN = Buffer.from([0x4E, 0x5A, 0x46, 0x4E]);
const FM_NZTD = Buffer.from([0x4E, 0x5A, 0x54, 0x44]);
const FM_NERR = Buffer.from([0x4E, 0x45, 0x52, 0x52]);
const FM_NZUP = Buffer.from([0x4E, 0x5A, 0x55, 0x50]);

function handleFMTask(task, client, metadata) {
    let fmTask;
    try { fmTask = JSON.parse(task.data); } catch (e) { logErr('[FM] 任务解析错误:', e.message); return; }

    const ioStream = client.IOStream(metadata);
    let streamClosed = false;
    let uploadState = null;
    activeIOStreams++;

    const streamIDData = Buffer.concat([Buffer.from([0xff, 0x05, 0xff, 0x05]), Buffer.from(fmTask.StreamID || '')]);
    try { ioStream.write({ data: streamIDData }); }
    catch (e) { logErr('[FM] 发送 StreamID 失败:', e.message); activeIOStreams--; return; }

    log('[FM] 初始化, StreamID:', fmTask.StreamID);

    const keepAlive = setInterval(() => {
        if (streamClosed) return;
        try { ioStream.write({ data: Buffer.alloc(0) }); } catch (e) {}
    }, 30000);

    function sendError(msg) {
        if (streamClosed) return;
        try { ioStream.write({ data: Buffer.concat([FM_NERR, Buffer.from(msg)]) }); } catch (e) {}
    }

    function listDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const parts = [];
            const pathBuf = Buffer.from(dir);
            const pathLen = Buffer.alloc(4);
            pathLen.writeUInt32BE(pathBuf.length, 0);
            parts.push(FM_NZFN, pathLen, pathBuf);
            for (const entry of entries) {
                const isDir = entry.isDirectory() ? 1 : 0;
                const nameBuf = Buffer.from(entry.name);
                parts.push(Buffer.from([isDir, nameBuf.length & 0xFF]), nameBuf);
            }
            ioStream.write({ data: Buffer.concat(parts) });
        } catch (err) {
            const homeDir = os.homedir() + path.sep;
            if (dir !== homeDir) listDir(homeDir);
            else sendError(err.message);
        }
    }

    function downloadFile(filePath) {
        try {
            const stat = fs.statSync(filePath);
            if (stat.size <= 0) { sendError('requested file is empty'); return; }
            const sizeBuf = Buffer.alloc(8);
            sizeBuf.writeBigUInt64BE(BigInt(stat.size), 0);
            ioStream.write({ data: Buffer.concat([FM_NZTD, sizeBuf]) });
            const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
            stream.on('data', (chunk) => {
                if (streamClosed) { stream.destroy(); return; }
                ioStream.write({ data: chunk });
            });
            stream.on('error', (err) => sendError(err.message));
        } catch (err) { sendError(err.message); }
    }

    function startUpload(data) {
        if (data.length < 8) { sendError('data is invalid'); return; }
        const fileSize = Number(data.readBigUInt64BE(0));
        const filePath = data.slice(8).toString();
        try {
            const dir = path.dirname(filePath);
            if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const writeStream = fs.createWriteStream(filePath);
            uploadState = { writeStream, fileSize, received: 0, finished: false };
            writeStream.on('error', (err) => { if (uploadState) { sendError(err.message); uploadState = null; } });
            writeStream.on('finish', () => {
                if (uploadState && !uploadState.finished) {
                    uploadState.finished = true;
                    log('[FM] 文件接收完成');
                    ioStream.write({ data: FM_NZUP });
                    uploadState = null;
                }
            });
            log('[FM] 接收文件:', filePath, '大小:', fileSize);
        } catch (err) { sendError(err.message); }
    }

    ioStream.on('data', (msg) => {
        const data = Buffer.from(msg.data || []);
        if (data.length === 0) return;
        if (uploadState) {
            const ok = uploadState.writeStream.write(data);
            uploadState.received += data.length;
            if (!ok) uploadState.writeStream.once('drain', () => {});
            if (uploadState.received >= uploadState.fileSize) uploadState.writeStream.end();
            return;
        }
        switch (data[0]) {
            case 0: listDir(data.slice(1).toString()); break;
            case 1: downloadFile(data.slice(1).toString()); break;
            case 2: startUpload(data.slice(1)); break;
        }
    });

    const cleanup = () => {
        clearInterval(keepAlive);
        if (!streamClosed) {
            streamClosed = true;
            activeIOStreams--;
            if (uploadState) { try { uploadState.writeStream.destroy(); } catch (e) {} uploadState = null; }
        }
    };
    ioStream.on('error', (err) => { logErr('[FM] IOStream 错误:', err.message); cleanup(); });
    ioStream.on('end', () => { log('[FM] IOStream 结束, StreamID:', fmTask.StreamID); cleanup(); });
}

// NZ-Agent: 任务分发 
function dispatchTask(task, taskStream, client, metadata) {
    switch (task.type) {
        case TaskType.TerminalGRPC: handleTerminalTask(task, client, metadata); break;
        case TaskType.FM: handleFMTask(task, client, metadata); break;
    }
}

// NZ-Agent: 辅助函数
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function callWithTimeout(fn, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        fn((err, resp) => { clearTimeout(timer); if (err) reject(err); else resolve(resp); });
    });
}

// NZ-Agent: 主循环
async function startNezhaAgent() {
    if (!NEZHA_SERVER || !NEZHA_KEY) {
        console.log('[Nezha] NEZHA_SERVER 或 NEZHA_KEY 未配置，跳过哪吒 agent');
        return;
    }
    if (!grpc || !protoLoader) {
        console.warn('[Nezha] 未安装 @grpc/grpc-js / @grpc/proto-loader，跳过哪吒 agent');
        return;
    }

    log('[Nezha] 服务器:', NEZHA_SERVER);
    log('[Nezha] TLS:', shouldUseTLS(NEZHA_SERVER) ? '启用' : '禁用');
    log('[Nezha] UUID:', UUID);

    const proto = loadProto();
    const useTLS = shouldUseTLS(NEZHA_SERVER);
    const credentials = useTLS ? grpc.credentials.createSsl() : grpc.credentials.createInsecure();
    const metadata = buildMetadata();

    let lastReportHostInfo = 0;
    let lastReportIPInfo = 0;
    let geoipReported = false;
    let prevDashboardBootTime = 0;

    while (true) {
        let client = null;
        let taskStream = null;
        let stateStream = null;
        let workerCancelled = false;

        try {
            client = new proto.NezhaService(NEZHA_SERVER, credentials);
            console.log('nzbot is running...');

            const hostInfo = await getHost();
            let dashboardBootTime = 0;
            try {
                const receipt = await callWithTimeout(
                    (cb) => client.ReportSystemInfo2(hostInfo, metadata, cb), NETWORK_TIMEOUT
                );
                dashboardBootTime = receipt.data || 0;
                log('[Agent] 上报系统信息成功, Dashboard BootTime:', dashboardBootTime);
            } catch (err) {
                logErr('[Agent] 上报系统信息失败:', err.message);
                throw err;
            }

            geoipReported = false;
            prevDashboardBootTime = dashboardBootTime;

            try {
                const success = await reportGeoIP(client, metadata, true);
                if (success) { lastReportIPInfo = Date.now(); geoipReported = true; }
            } catch (e) { logErr('[GeoIP] 首次上报异常:', e.message); }

            taskStream = client.RequestTask(metadata);
            log('[Agent] RequestTask 流已建立');

            stateStream = client.ReportSystemState(metadata);
            log('[Agent] ReportSystemState 流已建立');

            taskStream.on('data', (task) => { dispatchTask(task, taskStream, client, metadata); });
            taskStream.on('error', (err) => { logErr('[Agent] RequestTask 流错误:', err.message); workerCancelled = true; });
            taskStream.on('end', () => { log('[Agent] RequestTask 流结束'); workerCancelled = true; });

            const stateLoop = (async () => {
                while (!workerCancelled) {
                    try {
                        await trackNetworkSpeed();
                        const state = await getState();
                        await new Promise((resolve, reject) => {
                            stateStream.write(state, (err) => { if (err) reject(err); else resolve(); });
                        });
                        await new Promise((resolve, reject) => {
                            const timer = setTimeout(() => {
                                stateStream.removeListener('data', onReceipt);
                                stateStream.removeListener('error', onError);
                                reject(new Error('receipt timeout'));
                            }, NETWORK_TIMEOUT);
                            const onReceipt = (msg) => { clearTimeout(timer); stateStream.removeListener('error', onError); resolve(msg); };
                            const onError = (err) => { clearTimeout(timer); stateStream.removeListener('data', onReceipt); reject(err); };
                            stateStream.once('data', onReceipt);
                            stateStream.once('error', onError);
                        });
                        const now = Date.now();
                        if (now - lastReportHostInfo > 10 * 60 * 1000) {
                            try {
                                const hostRefresh = await getHost();
                                await callWithTimeout((cb) => client.ReportSystemInfo2(hostRefresh, metadata, cb), 10000);
                                lastReportHostInfo = now;
                            } catch (e) { }
                        }
                        if (now - lastReportIPInfo > IP_REPORT_PERIOD * 1000 || !geoipReported) {
                            const forceUpdate = !geoipReported;
                            const success = await reportGeoIP(client, metadata, forceUpdate);
                            if (success) { lastReportIPInfo = now; geoipReported = true; }
                        }
                    } catch (err) {
                        logErr('[Agent] 状态上报错误:', err.message);
                        workerCancelled = true;
                        break;
                    }
                    await sleep(REPORT_DELAY * 1000);
                }
            })();

            await stateLoop;

        } catch (err) {
            logErr('[Agent] 连接错误:', err.message);
        } finally {
            if (activeIOStreams > 0) {
                log(`[Agent] 等待 ${activeIOStreams} 个活跃 IOStream 会话结束...`);
                const waitStart = Date.now();
                while (activeIOStreams > 0 && Date.now() - waitStart < 5000) await sleep(100);
                if (activeIOStreams > 0) logWarn(`[Agent] 仍有 ${activeIOStreams} 个 IOStream 会话未结束，强制关闭`);
            }
            try { if (taskStream) taskStream.end(); } catch (e) {}
            try { if (stateStream) stateStream.end(); } catch (e) {}
            try { if (client) client.close(); } catch (e) {}
        }

        log('[Agent] 等待重连...');
        await sleep(RETRY_DELAY);
        log('[Agent] 尝试重连...');
    }
}


// ==================== Telegram WEB Proxy ====================
// 统一说明：TG 的 secret 直接复用上面的 UUID（通信时即 32 位 hex）。
const CFG = { dnPack: 32 * 1024, upPack: 20 * 1024, dnMs: 1 };
const txt = new TextEncoder()
const dec = new TextDecoder();
const nil = Buffer.alloc(0);
const badHead = new Set(['HEAD', 'POST', 'GET ', 'OPTI']);

// UUID（含短横线）-> 纯 hex；其余格式原样返回（交给 getKey 校验）
function normalizeSecret(v) {
  const str = String(v || '').trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(str)) {
    return str.replace(/-/g, '');
  }
  return str;
}

const macKeys = new Map();
const leases = new Map();

// ==================== 工具函数 ====================
function u8(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  throw new TypeError('Invalid buffer');
}

const dup = v => Buffer.from(u8(v));
function cat(...args) {
  return Buffer.concat(args.filter(v => v?.byteLength).map(u8));
}
const hex = v => Buffer.from(v, 'hex');
function b64(v) {
  const b = Buffer.isBuffer(v) ? v : Buffer.from(v);
  return b.toString('base64url');
}
const un64 = v => Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const rand = n => crypto.randomBytes(n);
const wake = st => { const { wake: ok } = st; st.wake = null; ok?.(); };
const isType = t => t === 1 || t === 2 || t === 3 || t === 4 || t === 17;

function reply(res, body = null, status = 404, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
  return true; // 已处理：tgRoute 的返回值用于融合处理器的路由判断
}

// ==================== 帧编码/解析 ====================
function enc(type, sid, data = nil) {
  const body = u8(data);
  if (!isType(type)) throw new RangeError('Invalid type');
  if (!Number.isInteger(sid) || sid < 0 || sid > 0xffffff) throw new RangeError('Invalid sid');
  if (body.byteLength > 1024 * 1024) throw new RangeError('Body too large');
  const frame = Buffer.alloc(8 + body.byteLength);
  frame[0] = type;
  frame[1] = sid >>> 16;
  frame[2] = sid >>> 8;
  frame[3] = sid;
  frame.writeUInt32BE(body.byteLength, 4);
  frame.set(body, 8);
  return frame;
}

function getFrame(b, o) {
  if (b.byteLength - o < 8) return null;
  const type = b[o];
  if (!isType(type)) throw new Error('Invalid frame type');
  const sid = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  const n = b.readUInt32BE(o + 4);
  if (n > 1024 * 1024) throw new Error('Frame too large');
  const total = 8 + n;
  if (b.byteLength - o < total) return null;
  return {
    frame: { type, sid, payload: b.subarray(o + 8, o + total) },
    consumed: total,
  };
}

function frames(v) {
  const src = u8(v), out = [];
  for (let o = 0; o < src.byteLength;) {
    const part = getFrame(src, o);
    if (!part) throw new Error('Incomplete frame');
    if (out.length >= 4096) throw new Error('Too many frames');
    out.push(part.frame);
    o += part.consumed;
  }
  return out;
}

function win(data) {
  const body = u8(data);
  if (body.byteLength !== 4) throw new Error('Invalid window');
  const n = body.readUInt32BE(0);
  if (!n) throw new Error('Zero window');
  return n;
}

function check(frame) {
  const { type, payload: data } = frame;
  if (type === 1 || type === 3) { if (data.byteLength) throw new Error('Empty expected'); return 0; }
  if (type === 2) { if (!data.byteLength) throw new Error('Non-empty expected'); return 0; }
  if (type === 4) return win(data);
  throw new Error('Invalid type');
}

// ==================== 头部处理 ====================
const i16 = (b, o) => (b[o] | (b[o + 1] << 8)) << 16 >> 16;

function headOf(head) {
  const tag = head.readUInt32LE(56);
  const mode = tag === 0xefefefef ? 0xef : tag === 0xeeeeeeee ? 0xee : tag === 0xdddddddd ? 0xdd : 0;
  if (!mode) throw new Error('Invalid mode');
  const dc = i16(head, 60);
  const target = Math.abs(dc) - 1;
  if (target < 0 || target >= 5) throw new Error('Invalid DC');
  return { mode, target, media: dc < 0 };
}

function mkHead(mode, target, media) {
  const head = Buffer.alloc(64);
  do {
    crypto.randomFillSync(head);
  } while (
    head[0] === 0xef ||
    badHead.has(dec.decode(head.subarray(0, 4))) ||
    head.subarray(4, 8).every(v => v === 0)
  );
  head.fill(mode, 56, 60);
  head.writeInt16LE((target + 1) * (media ? -1 : 1), 60);
  return head;
}

// ==================== 密钥/主机 ====================
function getKey(v, keepTag = false) {
  const str = String(v || '').trim().toLowerCase();
  if (!/^(?:[0-9a-f]{32}|(?:dd|ee|ef)[0-9a-f]{32})$/.test(str)) throw new Error('Invalid key');
  return hex(keepTag && str.length === 34 && str.startsWith('dd') ? str : str.slice(-32));
}

function hostOf(v) {
  const host = String(v || '').trim().toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  if (!host.includes('.') || host.length > 253 || host.includes(':') ||
      labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('Invalid host');
  }
  return host;
}

// 从 SECRET 用带标签的 HMAC-SHA256 确定性派生。
function deriveBoot(secretRaw) {
  const master = crypto.createHmac('sha256', 'tg-webproxy-master-v1')
    .update(String(secretRaw).trim().toLowerCase())
    .digest();
  return crypto.createHmac('sha256', 'tg-webproxy-boot-v1')
    .update(master)
    .digest('hex'); // 64 位 hex 字符串
}

// ==================== HMAC / MAC ====================
function macKey(raw, id) {
  // Cache the raw key material, not an Hmac instance: newer Node versions
  // dropped Hmac#copy, so sign() must build a fresh HMAC per call.
  let key = macKeys.get(id);
  if (!key) macKeys.set(id, key = Buffer.from(u8(raw)));
  return key;
}

function sign(key, v) {
  const h = crypto.createHmac('sha256', key);
  h.update(u8(v));
  return h.digest();
}

async function mac(boot, kind, body) {
  const prefix = txt.encode(`${kind}\n`);
  const msg = Buffer.concat([Buffer.from(prefix), Buffer.from(body)]);
  const key = macKey(Buffer.from(txt.encode(boot)), `token:${boot}`);
  return sign(key, msg).subarray(0, 16);
}

async function mkToken(boot, kind, expAt, nonce) {
  const body = Buffer.alloc(16);
  const exp = Math.ceil(expAt / 1000);
  body.writeUInt32BE(exp, 0);
  body.set(nonce, 4);
  const token = Buffer.alloc(32);
  token.set(body);
  token.set(await mac(boot, kind, body), body.byteLength);
  return b64(token);
}

const mkBoot = async boot => mkToken(boot, 'bootstrap', Date.now() + 2 * 60 * 1000, rand(12));

async function verify(v, boot, kind) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v)) return false;
  let token;
  try { token = un64(v); } catch { return false; }
  if (token.byteLength !== 32 || b64(token) !== v) return false;
  const body = token.subarray(0, 16);
  const sig = token.subarray(16);
  const exp = body.readUInt32BE(0);
  if (exp <= Math.floor(Date.now() / 1000)) return false;
  const want = await mac(boot, kind, body);
  let diff = sig.byteLength ^ want.byteLength;
  for (let i = 0; i < want.length; i++) diff |= sig[i] ^ want[i];
  return diff === 0;
}

const mkSess = async boot => mkToken(boot, 'session', Date.now() + 5 * 60 * 1000, rand(12));
const authBoot = async (v, boot) => v === boot || verify(v, boot, 'bootstrap');
const mkLease = token => ({
  expires: un64(token).readUInt32BE(0) * 1000,
  active: new Set(),
  used: new Set(),
  deleted: false,
});
const bearer = v => /^Bearer ([^\s]+)$/.exec(v || '')?.[1] ?? null;
const binary = req => req.headers['content-type']?.trim().toLowerCase() === 'application/octet-stream';

// ==================== Hello 协议 ====================
function hello(body) {
  if (body.byteLength !== 9 || body[0] !== 0x10 || body[1] !== 0 || body[2] !== 0 ||
      body[3] !== 0 || body.readUInt32BE(4) !== 1 || body[8] !== 1) {
    throw new Error('Invalid hello');
  }
}

const protos = req => (req.headers['sec-websocket-protocol'] ?? '').split(',').map(v => v.trim()).filter(Boolean);

// ==================== 配置（启动时构造一次） ====================
let CFG_CACHE = null;
function mkTgCfg(secret) {
  if (CFG_CACHE) return CFG_CACHE;
  if (!secret) throw new Error('TG secret required');
  CFG_CACHE = {
    secret,
    key: getKey(secret),
    boot: deriveBoot(secret),   // 从 SECRET 派生
  };
  return CFG_CACHE;
}

// ==================== Bridge ====================
async function mkCap(secret, host) {
  const key = macKey(getKey(secret, true), `bridge:${String(secret).trim().toLowerCase()}`);
  const sig = sign(key, txt.encode(`tdesktop-web-proxy-bridge-v1\n${hostOf(host)}`));
  return b64(sig);
}

async function bridge(url, secret) {
  if (url.pathname !== '/' || url.search.length !== 51) return null;
  const cand = url.search.slice(8);
  if (url.search !== `?bridge=${cand}` || !/^[A-Za-z0-9_-]{43}$/.test(cand)) return null;
  const host = hostOf(url.hostname);
  const want = await mkCap(secret, host);
  if (cand.length !== want.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= cand.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0 ? host : null;
}

// ==================== 加密 ====================
const sha = v => crypto.createHash('sha256').update(u8(v)).digest();

function step(ctr, n) {
  let carry = n;
  for (let i = ctr.length - 1; i >= 0 && carry; i--) {
    const next = ctr[i] + (carry & 0xff);
    ctr[i] = next & 0xff;
    carry = Math.floor(carry / 256) + Math.floor(next / 256);
  }
  if (carry) throw new Error('Counter overflow');
}

function mkCtr(key, ctr) {
  let iv = dup(ctr), tail = nil;
  const crypt = async (v) => {
    const b = u8(v);
    if (!b.byteLength) return Buffer.alloc(0);
    if (!tail.byteLength && !(b.byteLength % 16)) {
      const cipher = crypto.createCipheriv(key.length === 32 ? 'aes-256-ctr' : 'aes-128-ctr', key, iv);
      const raw = Buffer.concat([cipher.update(b), cipher.final()]);
      step(iv, b.byteLength / 16);
      return raw;
    }
    if (b.byteLength <= tail.byteLength) {
      const out = Buffer.alloc(b.byteLength);
      for (let i = 0; i < b.byteLength; i++) out[i] = b[i] ^ tail[i];
      tail = tail.subarray(b.byteLength);
      return out;
    }
    const skip = tail.byteLength ? 16 - tail.byteLength : 0;
    const ctrCopy = Buffer.from(iv);
    if (skip) {
      for (let i = ctrCopy.length - 1; i >= 0; i--) if (ctrCopy[i]--) break;
    }
    const end = skip + b.byteLength;
    const block = Buffer.alloc(Math.ceil(end / 16) * 16);
    block.set(b, skip);
    const cipher = crypto.createCipheriv(key.length === 32 ? 'aes-256-ctr' : 'aes-128-ctr', key, ctrCopy);
    const raw = Buffer.concat([cipher.update(block), cipher.final()]);
    tail = raw.subarray(end);
    step(iv, block.byteLength / 16 - (skip ? 1 : 0));
    return raw.subarray(skip, end);
  };
  return { crypt };
}

async function cipher(head, secret, reverse) {
  const mat = dup(u8(head).subarray(8, 56));
  if (reverse) mat.reverse();
  const key = secret.byteLength ? sha(cat(mat.subarray(0, 32), secret)) : mat.subarray(0, 32);
  return mkCtr(key, mat.subarray(32, 48));
}

async function wireHead(head) {
  const ctr = await cipher(head, nil, false);
  const raw = await ctr.crypt(head);
  raw.set(u8(head).subarray(0, 56));
  return { wire: raw, cipher: ctr };
}

// ==================== Wire (WebSocket) ====================
const hosts = (dc, media) => [
  `kws${dc}${media ? '-1' : ''}.web.telegram.org`,
  `kws${dc}${media ? '' : '-1'}.web.telegram.org`,
];

function mkWire(ws, ms, signal) {
  const q = [], wait = [];
  let h = 0, qBytes = 0, closed = false, dead = false, up = false, fault = null;
  let pWake = null, pNeed, openTimer, readyOk, readyBad;

  const ready = new Promise((ok, bad) => { readyOk = ok; readyBad = bad; });

  const onAbort = () => { end(new Error('Aborted')); close(); };

  ws.binaryType = 'arraybuffer';
  ws.on('open', () => {
    if (closed) return;
    up = true;
    clearTimeout(openTimer);
    readyOk(api);
  });

  ws.on('message', (data) => {
    if (closed) return;
    const b = Buffer.from(data);
    if (!b.byteLength) return;
    const waiter = wait.shift();
    if (waiter) waiter.resolve(b);
    else {
      q.push(b);
      qBytes += b.byteLength;
      if (pWake && (qBytes >= pNeed || b.byteLength >= CFG.dnPack)) pWake();
    }
  });

  const end = (err = null) => {
    if (closed) return;
    closed = true;
    fault = err;
    clearTimeout(openTimer);
    signal?.removeEventListener('abort', onAbort);
    if (!up) readyBad(err || new Error('Closed'));
    pWake?.();
    for (const waiter of wait.splice(0)) err ? waiter.reject(err) : waiter.resolve(null);
  };

  ws.on('error', () => end(new Error('WS error')));
  ws.on('close', (code) => end(code && code !== 1000 ? new Error(`Closed ${code}`) : null));

  openTimer = setTimeout(() => { end(new Error('Timeout')); close(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  const write = async (v) => {
    await ready;
    if (closed) throw fault || new Error('Closed');
    ws.send(u8(v));
  };

  const take = async () => {
    await ready;
    if (h < q.length) {
      const msg = q[h];
      q[h++] = null;
      qBytes -= msg.byteLength;
      trim();
      return msg;
    }
    if (fault) throw fault;
    if (closed) return null;
    return new Promise((ok, bad) => wait.push({ resolve: ok, reject: bad }));
  };

  const pack = async () => {
    const first = await take();
    if (dead) return null;
    if (!first || first.byteLength >= CFG.dnPack) return first;
    if (!closed && qBytes < CFG.dnPack - first.byteLength) {
      await new Promise(ok => {
        pNeed = CFG.dnPack - first.byteLength;
        const timer = setTimeout(() => pWake?.(), CFG.dnMs);
        pWake = () => { clearTimeout(timer); pWake = null; ok(); };
      });
    }
    if (dead) return null;
    let n = first.byteLength, end = h;
    while (end < q.length && n + q[end].byteLength <= CFG.dnPack) {
      n += q[end++].byteLength;
    }
    if (end === h) return first;
    const b = Buffer.alloc(n);
    b.set(first);
    let o = first.byteLength;
    while (h < end) {
      const part = q[h];
      q[h++] = null;
      b.set(part, o);
      o += part.byteLength;
      qBytes -= part.byteLength;
    }
    trim();
    return b;
  };

  const trim = () => {
    if (h === q.length) { q.length = 0; h = 0; }
    else if (h >= 256 && h * 2 >= q.length) { q.splice(0, h); h = 0; }
  };

  const close = () => {
    if (dead) return;
    dead = true;
    if (!closed) end();
    q.length = h = qBytes = 0;
    try { ws.close(1000); } catch {}
  };

  const api = { ready, write, readPack: pack, close, get closed() { return closed; } };
  return api;
}

async function dial({ target, media, signal }) {
  for (const host of hosts(target + 1, media)) {
    if (signal?.aborted) throw new Error('Aborted');
    const url = `wss://${host}/apiws`;
    let kws;
    try {
      const ws = new WebSocket(url, 'binary');
      kws = mkWire(ws, 7500, signal);
      await kws.ready;
      if (signal?.aborted) throw new Error('Aborted');
      return kws;
    } catch (err) {
      kws?.close();
      if (signal?.aborted) throw err;
    }
  }
  throw new Error('All DCs failed');
}

// ==================== 数据包解析 ====================
function mkPkt(mode) {
  let tail = nil;
  const push = (v) => {
    const b = u8(v);
    if (b.byteLength) tail = tail.byteLength ? cat(tail, b) : b;
    const pkts = [];
    let o = 0;
    for (;;) {
      const avail = tail.byteLength - o;
      let hLen, pLen;
      if (mode === 0xef) {
        if (avail < 1) break;
        let words = tail[o] & 0x7f;
        if (words === 0x7f) {
          if (avail < 4) break;
          words = tail[o + 1] | (tail[o + 2] << 8) | (tail[o + 3] << 16);
          hLen = 4;
        } else hLen = 1;
        pLen = words * 4;
      } else {
        if (avail < 4) break;
        pLen = tail.readUInt32LE(o) & 0x7fffffff;
        hLen = 4;
      }
      if (!pLen || pLen > 8 * 1024 * 1024) throw new Error('Invalid packet length');
      const total = hLen + pLen;
      if (avail < total) break;
      pkts.push(tail.subarray(o, o + total));
      o += total;
    }
    if (o) tail = o === tail.byteLength ? nil : tail.subarray(o);
    if (tail.byteLength > 8 * 1024 * 1024 + 4) throw new Error('Tail overflow');
    return pkts;
  };
  const clear = () => { tail = nil; };
  return { push, clear };
}

// ==================== 流管理 ====================
function mkStream({ secret, emit, onClose }) {
  let hdr = nil, cIn = null, cOut = null, kIn = null, kOut = null, peer = null, pkt = null;
  let init = false, closed = false, chain = Promise.resolve();
  const ac = new AbortController();
  const uq = new Set();

  const push = (v) => {
    if (closed) return Promise.reject(new Error('Closed'));
    const job = { bytes: u8(v) };
    uq.add(job);
    chain = chain.then(async () => {
      if (closed) throw new Error('Closed');
      if (!job.bytes) return job.result;
      const jobs = [job];
      let n = job.bytes.byteLength;
      for (const next of uq) {
        if (next === job) continue;
        if (n >= CFG.upPack || n + next.bytes.byteLength > CFG.upPack) break;
        n += next.bytes.byteLength;
        jobs.push(next);
      }
      const b = jobs.length === 1 ? job.bytes : cat(...jobs.map(x => x.bytes));
      for (const item of jobs) { uq.delete(item); item.bytes = null; }
      const out = await feed(b);
      for (const item of jobs) item.result = out;
      return out;
    });
    return chain;
  };

  const feed = async (b) => {
    if (closed) throw new Error('Closed');
    if (init && peer.closed) return false;
    if (!b.byteLength) return;
    if (!init) {
      const need = 64 - hdr.byteLength;
      if (b.byteLength < need) { hdr = cat(hdr, b); return; }
      hdr = cat(hdr, b.subarray(0, need));
      await start();
      const rest = b.subarray(need);
      if (rest.byteLength) return write(rest);
      return;
    }
    return write(b);
  };

  const start = async () => {
    const raw = hdr;
    const cr = await cipher(raw, secret, false);
    const plain = await cr.crypt(raw);
    if (closed) return;
    const info = headOf(plain);
    const head = mkHead(info.mode, info.target, info.media);
    const [cw, out, kr] = await Promise.all([
      cipher(raw, secret, true),
      wireHead(head),
      cipher(head, nil, true),
    ]);
    if (closed) return;
    const kws = await dial({ target: info.target, media: info.media, signal: ac.signal });
    if (closed) { kws.close(); return; }
    peer = kws;
    cIn = cr; cOut = cw; kOut = out.cipher; kIn = kr;
    pkt = mkPkt(info.mode);
    await kws.write(out.wire);
    if (closed) return;
    hdr = nil;
    init = true;
    pump().catch(() => close());
  };

  const write = async (raw) => {
    if (closed || peer.closed) return false;
    const plain = await cIn.crypt(raw);
    if (closed || peer.closed) return false;
    const pkts = pkt.push(plain);
    for (let start = 0; start < pkts.length;) {
      let end = start + 1, n = pkts[start].byteLength;
      while (end < pkts.length && n + pkts[end].byteLength <= CFG.upPack) {
        n += pkts[end++].byteLength;
      }
      const first = pkts[start];
      const b = end === start + 1 ? first : Buffer.from(first.buffer, first.byteOffset, n);
      if (closed || peer.closed) return false;
      const wire = await kOut.crypt(b);
      for (let o = 0; start < end; start++) {
        if (closed || peer.closed) return false;
        const n = pkts[start].byteLength;
        try { await peer.write(wire.subarray(o, o + n)); } catch (err) {
          if (closed || peer.closed) return false;
          throw err;
        }
        o += n;
      }
    }
  };

  const pump = async () => {
    while (!closed) {
      const b = await peer.readPack();
      if (closed) return;
      if (!b) return close();
      const plain = await kIn.crypt(b);
      if (closed) return;
      const raw = await cOut.crypt(plain);
      if (closed) return;
      await emit(raw);
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    ac.abort();
    try { peer?.close(); } catch {}
    for (const job of uq) job.bytes = null;
    uq.clear();
    hdr = nil;
    pkt?.clear();
    cIn = cOut = kIn = kOut = peer = null;
    try { onClose(); } catch {}
  };

  return { push, close };
}

// ==================== 会话管理 ====================
function mkSession({ secret, sid, onClose, lease }) {
  let sock = null, closed = false, tx = Promise.resolve(), cur = null;

  const attach = (ws) => {
    if (sock || closed) throw new Error('Already attached');
    sock = ws;
    ws.on('message', (data) => {
      if (closed) return;
      try { onData(Buffer.from(data)); } catch { close(1008); }
    });
    ws.on('close', () => close());
    ws.on('error', () => close());
  };

  const onData = (b) => {
    if (closed) return;
    if (lease?.deleted) return close(1000);
    if (!b.byteLength || b.byteLength > 2 * 1024 * 1024) throw new Error('Bad data');
    for (const frame of frames(b)) {
      if (closed) return;
      const delta = check(frame);
      if (frame.sid !== sid) throw new Error('SID mismatch');
      if (!cur && frame.type !== 1) throw new Error('No stream');
      if (frame.type !== 1 && cur?.closed) continue;
      if (frame.type === 1) open();
      else if (frame.type === 2) write(frame.payload);
      else if (frame.type === 4) grant(delta);
      else if (frame.type === 3) end(false);
      else throw new Error('Bad type');
    }
  };

  const send = (type, data = nil) => {
    const out = enc(type, sid, data);
    const st = type === 2 || type === 4 ? cur : null;
    tx = tx.then(() => {
      if (closed) throw new Error('Closed');
      if ((type === 2 || type === 4) && (!st || st.closed)) return;
      sock.send(out);
    });
    return tx;
  };

  const open = () => {
    if (closed) return;
    if (cur) throw new Error('Already open');
    const st = { in: 4 * 1024 * 1024, out: 4 * 1024 * 1024, wake: null, closed: false, proxy: null, pItems: 0 };
    st.proxy = mkStream({
      secret,
      emit: b => emitDn(st, b),
      onClose: () => { if (!closed && !st.closed) end(true); },
    });
    cur = st;
  };

  const write = (data) => {
    if (closed || cur?.closed) return;
    const st = cur;
    if (!st || st.closed) throw new Error('No stream');
    const n = data.byteLength;
    if (n > st.in) throw new Error('Window exceeded');
    if (st.pItems >= 16384) throw new Error('Too many items');
    st.in -= n;
    st.pItems++;
    st.proxy.push(data).then(accepted => {
      freeUp(st);
      if (closed || st.closed || accepted === false) return;
      st.in += n;
      const delta = Buffer.alloc(4);
      delta.writeUInt32BE(n, 0);
      send(4, delta).catch(() => close());
    }, () => {
      freeUp(st);
      if (!closed && !st.closed) st.proxy.close();
    }).catch(() => close());
  };

  const freeUp = (st) => { if (st.closed) return; st.pItems--; };

  const emitDn = async (st, b) => {
    for (let o = 0; o < b.byteLength;) {
      while (!closed && !st.closed && st.out === 0) {
        await new Promise(ok => { st.wake = ok; });
      }
      if (closed || st.closed) throw new Error('Closed');
      const n = Math.min(64 * 1024, b.byteLength - o, st.out);
      st.out -= n;
      await send(2, b.subarray(o, o + n));
      o += n;
    }
  };

  const grant = (n) => {
    if (closed || cur?.closed) return;
    const st = cur;
    if (!st || st.closed) throw new Error('No stream');
    st.out = Math.min(0xffffffff, st.out + n);
    wake(st);
  };

  const stop = (st) => { st.closed = true; st.pItems = 0; wake(st); st.proxy.close(); };

  const end = (notify) => {
    if (closed || cur?.closed) return;
    const st = cur;
    if (!st) throw new Error('No stream');
    stop(st);
    if (notify) send(3).then(() => close(), () => close());
    else close();
  };

  const close = (code = 1000, reason = '') => {
    if (closed) return;
    closed = true;
    if (cur) stop(cur);
    cur = null;
    try { sock?.close(code, reason); } catch {}
    onClose?.();
    onClose = null;
  };

  return { attach, close };
}

// ==================== 页面生成 ====================
function mkPage(host, boot) {
  const nonce = b64(rand(18));
  const body = `<script nonce="__NONCE__">
(()=>{'use strict'; const origin=__ORIGIN__,boot=__BOOTSTRAP__;
const aNonce=/^#android=([A-Za-z0-9_-]{43})$/.exec(location.hash)?.[1]??''; history.replaceState(null,'',location.pathname);
let init=false,closed=false,port=null,token='',started=false,delSent=false; let qBytes=0,qItems=0;
const lanes=new Map(),used=new Set(),qMax=33554432,iMax=16384,msgMax=2097152; const laneMax=8388608,laneItems=1024;
const state=st=>port&&!closed&&port.postMessage({t:'status',state:st});
const opts=(method,token,body,keepalive)=>({ method,body,keepalive:!!keepalive,mode:'same-origin',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer', headers:{...(token&&{Authorization:'Bearer '+token}),...(body&&{'Content-Type':'application/octet-stream'})} });
function check(v){ if(!(v instanceof ArrayBuffer)||!v.byteLength||v.byteLength>msgMax)throw Error(); const view=new DataView(v);let o=0,frames=0; while(o<v.byteLength){ if(v.byteLength-o<8||frames++>=4096)throw Error(); const type=view.getUint8(o),n=view.getUint32(o+4),end=o+8+n; if(n>1048576||end>v.byteLength||(type===2&&!n))throw Error(); o=end; } return v; }
function split(v){ check(v);const view=new DataView(v),out=[];let o=0; while(o<v.byteLength){ const end=o+8+view.getUint32(o+4); out.push(o===0&&end===v.byteLength?v:v.slice(o,end));o=end; } return out; }
function sid(v){const b=new Uint8Array(v);return (b[1]<<16)|(b[2]<<8)|b[3];}
function hold(lane,v){ let buffered=0;for(const {ws} of lanes.values())buffered+=ws?.bufferedAmount??0; const own=lane.ws?.bufferedAmount??0; if(qBytes+buffered>qMax-v.byteLength||qItems>=iMax ||lane.bytes+own>laneMax-v.byteLength||lane.items>=laneItems)return false; qBytes+=v.byteLength;qItems++;lane.bytes+=v.byteLength;lane.items++;return true; }
function free(lane,v){qBytes-=v.byteLength;qItems--;lane.bytes-=v.byteLength;lane.items--;}
function fail(){ if(closed)return;state('failed');port?.postMessage({t:'close'});close(true); }
function drop(){ if(delSent||!token)return;delSent=true; fetch(origin+'/api/v1/session',opts('DELETE',token,null,true)).catch(()=>{}); }
function pump(lane){ const ws=lane.ws; if(closed||lane.done||!ws||ws.readyState!==WebSocket.OPEN||!lane.pending.length)return; if(ws.bufferedAmount>=msgMax){lane.timer ||= setTimeout(()=>{lane.timer=0;pump(lane);},10);return;} try{ const v=lane.pending.shift();ws.send(v);free(lane,v); port.postMessage({t:'traffic',up:v.byteLength,down:0}); if(lane.pending.length)queueMicrotask(()=>pump(lane)); }catch{fail();} }
function push(v){ try{for(const frame of split(v))pushLane(frame);} catch{fail();} }
function end(lane,notify){ if(lane.done)return;lane.done=true;if(lane.timer)clearTimeout(lane.timer); qBytes-=lane.bytes;qItems-=lane.items;lane.bytes=lane.items=0;lane.pending.length=0;lanes.delete(lane.id); try{lane.ws?.close();}catch{} if(notify&&port&&!closed){const frame=new ArrayBuffer(8),b=new Uint8Array(frame);b[0]=3;b[1]=lane.id>>>16;b[2]=lane.id>>>8;b[3]=lane.id;port.postMessage(frame,[frame]);} }
function open(lane){ const target=origin.replace(/^https:/,'wss:')+'/api/v1/ws'; const ws=lane.ws=new WebSocket(target,'tproxy-lane-v1.'+token+'.'+lane.id);ws.binaryType='arraybuffer'; ws.onopen=()=>{if(closed||lane.done){ws.close();return;}lane.opened=true;state('connected');pump(lane);}; ws.onmessage=e=>{ if(closed||lane.done)return; try{ const frames=split(e.data); if(frames.some(frame=>sid(frame)!==lane.id))throw Error(); const ended=frames.some(frame=>new Uint8Array(frame)[0]===3); if(ended)lane.rClosed=true; port.postMessage({t:'traffic',up:0,down:e.data.byteLength});port.postMessage(e.data,[e.data]);state('connected'); if(ended)end(lane,false); }catch{fail();} }; ws.onerror=()=>{}; ws.onclose=()=>{if(closed||lane.done)return;if(!lane.opened){fail();return;}end(lane,!lane.lClosed&&!lane.rClosed);}; }
function pushLane(v){ const id=sid(v),type=new Uint8Array(v)[0];let lane=lanes.get(id); if(!id)throw Error(); if(!lane&&(type===2||type===3||type===4))return; if(!lane){ if(type!==1||used.has(id)||lanes.size>=128||used.size>=4096)throw Error(); used.add(id);lane={id,ws:null,pending:[],bytes:0,items:0,timer:0,opened:false,done:false,lClosed:false,rClosed:false};lanes.set(id,lane); } if(lane.lClosed)return; if(type===3&&!lane.opened){end(lane,false);return;} if(!hold(lane,v))throw Error(); lane.pending.push(v);if(type===3)lane.lClosed=true; if(token){if(!lane.ws)open(lane);else pump(lane);} }
async function create(first){ try{ state('connecting'); const res=await fetch(origin+'/api/v1/session',opts('POST',boot,first)); if(res.status!==200||res.headers.get('X-Carrier-Mode')!=='websocket-lanes')throw Error(); token=res.headers.get('X-Session-Token')??''; if(!token)throw Error(); const welcome=await res.arrayBuffer();check(welcome); if(closed){drop();return;} port.postMessage(welcome,[welcome]);state('connected'); for(const lane of lanes.values())if(!lane.ws)open(lane); }catch{fail();} }
function close(notify){ if(closed)return;closed=true; for(const lane of [...lanes.values()])end(lane,false);used.clear(); if(notify)drop(); port?.close(); }
function start(next){ init=true;port=next; port.onmessage=msg=>{ const data=msg.data; if(data instanceof ArrayBuffer){ if(!started){ try{check(data);}catch{fail();return;} started=true;create(data); }else push(data); }else if(data&&data.t==='close')close(true); }; port.start();state('connecting'); }
addEventListener('message',e=>{ if(init||e.source!==parent||e.data===null||typeof e.data!=='object')return; const keys=Object.keys(e.data).sort(); if(keys.length!==2||keys[0]!=='t'||keys[1]!=='v'||e.data.t!=='tproxy-init'||e.data.v!==1||e.ports.length!==1)return; let src;try{src=new URL(e.origin);}catch{return;} if(src.protocol!=='http:'||src.hostname!=='127.0.0.1'||!src.port||src.origin!==e.origin)return; start(e.ports[0]); }); const android=globalThis.TelegramWebProxy;
if(!init&&aNonce&&android&&typeof android.postMessage==='function'){ const aPort={onmessage:null,start(){},close(){android.onmessage=null;},postMessage(v){ if(v instanceof ArrayBuffer){for(const frame of split(v))android.postMessage(frame);} else android.postMessage(JSON.stringify(v)); }}; android.onmessage=e=>{ let data=e.data;if(typeof data==='string'){try{data=JSON.parse(data);}catch{return;}} aPort.onmessage?.({data}); }; start(aPort);android.postMessage(JSON.stringify({t:'tproxy-android-init',v:1,nonce:aNonce})); } addEventListener('pagehide',()=>close(true),{once:true}); })();
</script>`.replaceAll('__NONCE__', nonce)
    .replace('__ORIGIN__', JSON.stringify(`https://${host}`))
    .replace('__BOOTSTRAP__', JSON.stringify(String(boot)));

  const csp = [
    "default-src 'none'", "base-uri 'none'", "child-src 'none'",
    `connect-src 'self' wss://${host}`, "font-src 'none'", "form-action 'none'",
    'frame-ancestors http://127.0.0.1:*', "frame-src 'none'", "img-src 'none'",
    "manifest-src 'none'", "media-src 'none'", "object-src 'none'",
    `script-src 'nonce-${nonce}'`, "style-src 'none'", "worker-src 'none'",
    'sandbox allow-same-origin allow-scripts',
  ].join('; ');

  return { body, csp };
}


const tgWss = new WebSocket.Server({
  noServer: true,
  handleProtocols: (protocols) => protocols.values().next().value ?? false,
});

async function tgRoute(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;
  const headers = req.headers;

    let cfg;
  try { cfg = mkTgCfg(uuid); } catch {
    if (['/', '/health', '/api/v1/session', '/api/v1/ws'].includes(path)) {
      return reply(res, null, 500);
    }
    return reply(res, null, 404);
  }

  // 根路径
  if (path === '/' && (method === 'GET' || method === 'HEAD')) {
    let host = null;
    if (method === 'GET') {
      try { host = await bridge(url, cfg.secret); } catch {}
    }
    if (host) {
      const boot = await mkBoot(cfg.boot);
      const page = mkPage(host, boot);
      return reply(res, method === 'HEAD' ? null : page.body, 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': page.csp,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Permissions-Policy': [
          'accelerometer=()', 'autoplay=()', 'camera=()',
          'clipboard-read=()', 'clipboard-write=()', 'display-capture=()',
          'encrypted-media=()', 'fullscreen=()', 'geolocation=()',
          'gyroscope=()', 'hid=()', 'idle-detection=()', 'magnetometer=()',
          'microphone=()', 'midi=()', 'payment=()', 'picture-in-picture=()',
          'publickey-credentials-create=()', 'publickey-credentials-get=()',
          'screen-wake-lock=()', 'serial=()', 'usb=()', 'web-share=()',
          'xr-spatial-tracking=()',
        ].join(', '),
      });
    }
    return false; 
  }

  // 健康检查
  if (path === '/health') {
    return reply(res, '{"ok":true}', 200, { 'Content-Type': 'application/json; charset=utf-8' });
  }

  // 会话 API
  if (path === '/api/v1/session') {
    const auth = bearer(headers['authorization']);
    if (method === 'DELETE') {
      if (!auth || !(await verify(auth, cfg.boot, 'session'))) return reply(res, null, 404);
      let lease = leases.get(auth);
      if (!lease) leases.set(auth, lease = mkLease(auth));
      lease.deleted = true;
      return reply(res, null, 204);
    }
    if (method !== 'POST' || !auth || !binary(req)) return reply(res, null, 404);
    if (!(await authBoot(auth, cfg.boot))) return reply(res, null, 404);
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      hello(body);
      const token = await mkSess(cfg.boot);
      return reply(res, enc(0x11, 0), 200, {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Session-Token': token,
        'X-Carrier-Mode': 'websocket-lanes',
      });
    } catch { return reply(res, null, 404); }
  }

  return false;
}


async function tgWsUpgrade(req, socket, head) {
  const headers = req.headers;
  const cfg = mkTgCfg(uuid);
  if (req.method !== 'GET' || (req.headers.origin &&
      req.headers.origin !== `https://${headers.host}` &&
      req.headers.origin !== `http://${headers.host}`)) { try { socket.destroy(); } catch {} return; }
  const offers = protos(req);
  const proto = offers.length === 1 ? offers[0] : null;
  const parts = proto?.split('.') ?? [];
  const [kind, token = '', id] = parts;
  const sid = Number(id);
  if (parts.length !== 3 || kind !== 'tproxy-lane-v1' ||
      !/^[1-9][0-9]{0,7}$/.test(id) || sid > 0xffffff ||
      !(await verify(token, cfg.boot, 'session'))) {
    return reply(res, null, 404);
  }

  const now = Date.now();
  for (const [key, v] of leases) {
    if (v.expires <= now && !v.active.size) leases.delete(key);
  }
  let lease = leases.get(token);
  if (!lease) {
    if (leases.size >= 4096) return reply(res, null, 503);
    leases.set(token, lease = mkLease(token));
  }
  if (lease.deleted || lease.used.has(sid) || lease.active.size >= 128 || lease.used.size >= 4096) {
    return reply(res, null, 409);
  }
  lease.used.add(sid);
  lease.active.add(sid);

  const sess = mkSession({
    secret: cfg.key,
    sid,
    lease,
    onClose: () => lease.active.delete(sid),
  });

  tgWss.handleUpgrade(req, socket, head, (ws) => {
    try {
      sess.attach(ws);
    } catch {
      sess.close();
      try { ws.close(); } catch {}
    }
  });
}

// 启动服务
httpServer.listen(PORT, () => {
  startNezhaAgent().catch(err => console.error('error', err));
  addAccessTask();
  console.log(`Server is running on ${PORT}`);
});
