const os = require('os');
const http = require('http');
const https = require('https');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const { exec, execSync } = require('child_process');
const vmsServer = require('jsvms/protocols/vmess/server');
const Validator = require('jsvms/protocols/vmess/validator');
const { WebSocket, createWebSocketStream } = require('ws');
const UUID = process.env.UUID || '5efabea4-f6d4-91fd-b8f0-17e004c89c60';
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';
const DOMAIN = process.env.DOMAIN || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;
const WSPATH = process.env.WSPATH || UUID.slice(0, 8);
const SUB_PATH = process.env.SUB_PATH || 'sub';
const NAME = process.env.NAME || '';
const PORT = process.env.PORT || 3000;

let uuid = UUID.replace(/-/g, ""), CurrentDomain = DOMAIN, Tls = 'tls', CurrentPort = 443, ISP = '';
const vmsUser = { id: UUID, alterId: 0, security: 'auto' };
Validator.init({ tag: 'inbound', users: [vmsUser] });
const DNS_SERVERS = ['8.8.4.4', '1.1.1.1']; // custom dns
const BLOCKED_DOMAINS = [
    'speedtest.net', 'fast.com', 'speedtest.cn', 'speed.cloudflare.com', 'speedof.me',
    'testmy.net', 'bandwidth.place', 'speed.io', 'librespeed.org', 'speedcheck.org'
];
// block speedtest domain
function isBlockedDomain(host) {
    if (!host) return false;
    const hostLower = host.toLowerCase();
    return BLOCKED_DOMAINS.some(blocked => {
        return hostLower === blocked || hostLower.endsWith('.' + blocked);
    });
}
// HTTP GET helper function to replace axios
const httpGet = (url, options = {}) => {
    return new Promise((resolve, reject) => {
        const timeout = options.timeout || 10000;
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, { timeout }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({ data: jsonData });
                } catch (e) {
                    resolve({ data: data });
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
};

// HTTP POST helper function
const httpPost = (url, postData, options = {}) => {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const data = JSON.stringify(postData);
        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length,
                ...options.headers
            }
        };
        const req = https.request(reqOptions, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => resolve({ data: responseData }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
};

// get config
const GetConfig = async () => {
    try {
        // Use ip-api.com (free, no strict rate limits)
        const res = await httpGet('http://ip-api.com/json/?fields=status,country,countryCode,isp,as', { timeout: 8000 });
        const data = res.data;

        if (data && data.status === 'success' && data.countryCode) {
            const org = data.isp || data.as || 'ISP';
            ISP = `${data.countryCode}-${org}`.replace(/ /g, '_');
        } else {
            ISP = 'Unknown';
        }
    } catch (e) {
        ISP = 'Unknown';
    }

    if (!DOMAIN || DOMAIN === 'your-domain.com') {
        try {
            const res = await httpGet('https://api-ipv4.ip.sb/ip', { timeout: 8000 });
            const ip = res.data.trim();
            CurrentDomain = ip, Tls = 'none', CurrentPort = PORT;
        } catch (e) {
            console.error('Failed to get IP', e.message);
            CurrentDomain = 'your-domain.com', Tls = 'tls', CurrentPort = 443;
        }
    } else {
        CurrentDomain = DOMAIN, Tls = 'tls', CurrentPort = 443;
    }
}

const httpServer = http.createServer((req, res) => {
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
        GetConfig().then(() => {
            const namePart = NAME ? `${NAME}-${ISP}` : ISP;
            const tlsParam = Tls === 'tls' ? 'tls' : 'none';
            const ssTlsParam = Tls === 'tls' ? 'tls;' : '';
            const ssMethodPassword = Buffer.from(`none:${UUID}`).toString('base64');
            const vlsURL = `vless://${UUID}@${CurrentDomain}:${CurrentPort}?encryption=none&security=${tlsParam}&sni=${CurrentDomain}&fp=chrome&type=ws&host=${CurrentDomain}&path=%2F${WSPATH}#${namePart}`;
            const troURL = `trojan://${UUID}@${CurrentDomain}:${CurrentPort}?security=${tlsParam}&sni=${CurrentDomain}&fp=chrome&type=ws&host=${CurrentDomain}&path=%2F${WSPATH}#${namePart}`;
            const ssURL = `ss://${ssMethodPassword}@${CurrentDomain}:${CurrentPort}?plugin=v2ray-plugin;mode%3Dwebsocket;host%3D${CurrentDomain};path%3D%2F${WSPATH};${ssTlsParam}sni%3D${CurrentDomain};skip-cert-verify%3Dtrue;mux%3D0#${namePart}`;
            const vmsConfig = { v: '2', ps: `${namePart}`, add: CurrentDomain, port: CurrentPort.toString(), id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: CurrentDomain, path: `/${WSPATH}`, tls: Tls, sni: CurrentDomain, alpn: '', allowInsecure: '0', fp: 'chrome' };
            const vmsURL = 'vmess://' + Buffer.from(JSON.stringify(vmsConfig)).toString('base64');
            const subscription = vlsURL + '\n' + vmsURL + '\n' + troURL + '\n' + ssURL;
            const base64Content = Buffer.from(subscription).toString('base64');
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(base64Content + '\n');
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found\n');
    }
});

// dns resolve
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
            httpGet(dnsQuery, { timeout: 5000 })
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
                    tryNextDNS();
                });
        }

        tryNextDNS();
    });
}
// vle-ss Connection Handler
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
// tro-jan Connection Handler
function handleTrojConnection(ws, msg) {
    try {
        if (msg.length < 58) return false;
        const receivedPasswordHash = msg.slice(0, 56).toString();
        const possiblePasswords = [UUID];

        let matchedPassword = null;
        for (const pwd of possiblePasswords) {
            const hash = crypto.createHash('sha224').update(pwd).digest('hex');
            if (hash === receivedPasswordHash) {
                matchedPassword = pwd;
                break;
            }
        }

        if (!matchedPassword) return false;
        let offset = 56;
        if (msg[offset] === 0x0d && msg[offset + 1] === 0x0a) {
            offset += 2;
        }

        const cmd = msg[offset];
        if (cmd !== 0x01) return false;
        offset += 1;
        const atyp = msg[offset];
        offset += 1;
        let host, port;
        if (atyp === 0x01) {
            host = msg.slice(offset, offset + 4).join('.');
            offset += 4;
        } else if (atyp === 0x03) {
            const hostLen = msg[offset];
            offset += 1;
            host = msg.slice(offset, offset + hostLen).toString();
            offset += hostLen;
        } else if (atyp === 0x04) {
            host = msg.slice(offset, offset + 16).reduce((s, b, i, a) =>
                (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), [])
                .map(b => b.readUInt16BE(0).toString(16)).join(':');
            offset += 16;
        } else {
            return false;
        }

        port = msg.readUInt16BE(offset);
        offset += 2;
        if (offset < msg.length && msg[offset] === 0x0d && msg[offset + 1] === 0x0a) {
            offset += 2;
        }
        if (isBlockedDomain(host)) { ws.close(); return false; }
        const duplex = createWebSocketStream(ws);

        resolveHost(host)
            .then(resolvedIP => {
                net.connect({ host: resolvedIP, port }, function () {
                    if (offset < msg.length) {
                        this.write(msg.slice(offset));
                    }
                    duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
                }).on('error', () => { });
            })
            .catch(error => {
                net.connect({ host, port }, function () {
                    if (offset < msg.length) {
                        this.write(msg.slice(offset));
                    }
                    duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
                }).on('error', () => { });
            });

        return true;
    } catch (error) {
        return false;
    }
}
// Ss Connection Handler
function handleSsConnection(ws, msg) {
    try {
        let offset = 0;
        const atyp = msg[offset];
        offset += 1;

        let host, port;
        if (atyp === 0x01) {
            host = msg.slice(offset, offset + 4).join('.');
            offset += 4;
        } else if (atyp === 0x03) {
            const hostLen = msg[offset];
            offset += 1;
            host = msg.slice(offset, offset + hostLen).toString();
            offset += hostLen;
        } else if (atyp === 0x04) {
            host = msg.slice(offset, offset + 16).reduce((s, b, i, a) =>
                (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), [])
                .map(b => b.readUInt16BE(0).toString(16)).join(':');
            offset += 16;
        } else {
            return false;
        }

        port = msg.readUInt16BE(offset);
        offset += 2;
        if (isBlockedDomain(host)) { ws.close(); return false; }
        const duplex = createWebSocketStream(ws);
        resolveHost(host)
            .then(resolvedIP => {
                net.connect({ host: resolvedIP, port }, function () {
                    if (offset < msg.length) {
                        this.write(msg.slice(offset));
                    }
                    duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
                }).on('error', () => { });
            })
            .catch(error => {
                net.connect({ host, port }, function () {
                    if (offset < msg.length) {
                        this.write(msg.slice(offset));
                    }
                    duplex.on('error', () => { }).pipe(this).on('error', () => { }).pipe(duplex);
                }).on('error', () => { });
            });

        return true;
    } catch (error) {
        return false;
    }
}

// Vmes Connection Handler
function handleVmsConnection(ws, msg) {
    try {
        if (msg.length < 26) return false;
        const socket = {
            localClose: () => { ws.close(); },
            localMessage: (data) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(data);
            },
            remoteAddress: ws._socket.remoteAddress,
            remotePort: ws._socket.remotePort,
            app: {}
        };
        const remoteProtocol = (address, port, cmd, onconnect, onmessage, onclose) => {
            if (isBlockedDomain(address)) {
                onclose();
                return { message: () => { }, close: () => { } };
            }

            let remoteSocket = null;
            resolveHost(address).then(resolvedIP => {
                remoteSocket = net.connect({ host: resolvedIP, port }, () => {
                    onconnect();
                });
                remoteSocket.on('data', onmessage);
                remoteSocket.on('close', onclose);
                remoteSocket.on('error', onclose);
            }).catch(onclose);

            return {
                message: (data) => {
                    if (remoteSocket && !remoteSocket.destroyed) remoteSocket.write(data);
                },
                close: () => {
                    if (remoteSocket) remoteSocket.destroy();
                }
            };
        };

        const handler = vmsServer({
            tag: 'inbound',
            users: [vmsUser]
        }, remoteProtocol)(socket, ws._socket.remoteAddress);

        ws.on('message', (data) => {
            handler.message(data);
        });

        handler.message(msg);
        return true;
    } catch (error) {
        return false;
    }
}
const wss = new WebSocket.Server({ server: httpServer });
wss.on('connection', (ws, req) => {
    const url = req.url || '';
    const expectedPath = `/${WSPATH}`;
    if (!url.startsWith(expectedPath)) {
        ws.close();
        return;
    }
    ws.once('message', msg => {
        // VLE-SS (version byte 0 + 16 bytes UUID)
        if (msg.length > 17 && msg[0] === 0) {
            const id = msg.slice(1, 17);
            const isVless = id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16));
            if (isVless) {
                if (!handleVlsConnection(ws, msg)) {
                    ws.close();
                }
                return;
            }
        }
        // Tro-jan (58 bytes or more)
        if (msg.length >= 58) {
            if (handleTrojConnection(ws, msg)) {
                return;
            }
        }
        // SS (ATYP开头: 0x01, 0x03, 0x04)
        if (msg.length > 0 && (msg[0] === 0x01 || msg[0] === 0x03 || msg[0] === 0x04)) {
            if (handleSsConnection(ws, msg)) {
                return;
            }
        }
        // Vme-ss (26 bytes or more)
        if (msg.length >= 26) {
            if (handleVmsConnection(ws, msg)) {
                return;
            }
        }

        ws.close();
    }).on('error', () => { });
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
    if (!NEZHA_SERVER && !NEZHA_KEY) return;

    try {
        const url = getDownloadUrl();
        const response = await new Promise((resolve, reject) => {
            https.get(url, (res) => {
                resolve({ data: res });
            }).on('error', reject);
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
        // 进程不存在时继续运行nezha
    }

    await downloadFile();
    let command = '';
    let tlsPorts = ['443', '8443', '2096', '2087', '2083', '2053'];
    if (NEZHA_SERVER && NEZHA_PORT && NEZHA_KEY) {
        const NEZHA_TLS = tlsPorts.includes(NEZHA_PORT) ? '--tls' : '';
        command = `setsid nohup ./npm -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`;
    } else if (NEZHA_SERVER && NEZHA_KEY) {
        if (!NEZHA_PORT) {
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
        return;
    }
    const fullURL = `https://${DOMAIN}/${SUB_PATH}`;
    try {
        const res = await httpPost("https://oooo.serv00.net/add-url", {
            url: fullURL
        });
        console.log('Automatic Access Task added successfully');
    } catch (error) {
        // console.error('Error adding Task:', error.message);
    }
}

const delFiles = () => {
    ['npm', 'config.yaml'].forEach(file => fs.unlink(file, () => { }));
};

httpServer.listen(PORT, async () => {
    runnz();
    setTimeout(() => {
        delFiles();
    }, 180000);
    addAccessTask();
    console.log(`Server is running on port ${PORT}`);
});
