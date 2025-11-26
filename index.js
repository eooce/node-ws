const jsvms = require('jsvms');
const UUID = process.env.UUID || '8d6b237f-366f-439a-bbf2-a1fa1c0a6c11';
const protocol = process.env.PROROCOL || 'vmess';
const vmport = process.env.VMESS_PORT || 8080;
const wspath = process.env.WSPATH || '/ws';
const type = process.env.TYPE || 'ws';

const config = {
    inbounds: [{
        tag: 'vms-ws-in',
        protocol: protocol,
        networks: [{
            type: type,
            address: '0.0.0.0',
            port: vmport,
            option: {
                path: wspath
            }
        }],
        users: [{
            id: UUID,
            alterId: 0,
            security: 'auto'
        }]
    }],
    outbounds: [{
        protocol: 'freedom'
    }]
};

const server = jsvms.config(config);
server.start();
console.log(`${type} server is running on port ${vmport}`);
process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Shutting down server...');
    server.stop();
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
});
