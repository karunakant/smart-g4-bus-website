const fs = require('fs');
const path = require('path');
const os = require('os');

class HostNetwork {
  constructor() {
    this.recordedIp = null;
    this.networkJsonPath = path.join(__dirname, '..', 'data', 'network.json');
  }

  recordFromRequest(req) {
    if (!req) return;
    const hostHeader = req.headers && req.headers.host;
    if (hostHeader) {
      const ip = hostHeader.split(':')[0];
      if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
        this.recordedIp = ip;
      }
    }
  }

  getSubnetBroadcast(gatewayIp) {
    if (!gatewayIp) return '255.255.255.255';
    const parts = gatewayIp.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.255`;
    }
    return '255.255.255.255';
  }

  getHostIP(req) {
    // 1. If HOST_IP is explicitly configured and not 'auto'
    if (process.env.HOST_IP && process.env.HOST_IP !== 'auto') {
      return process.env.HOST_IP.trim();
    }

    // 2. Request host header if available and not localhost
    if (req && req.headers && req.headers.host) {
      const ip = req.headers.host.split(':')[0];
      if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
        return ip;
      }
    }

    // 3. Central dynamic sync file data/network.json (written by alexa-ssdp-discovery.py)
    try {
      if (fs.existsSync(this.networkJsonPath)) {
        const raw = fs.readFileSync(this.networkJsonPath, 'utf8');
        const data = JSON.parse(raw);
        if (data && data.hostIp && data.hostIp !== '127.0.0.1') {
          return data.hostIp;
        }
      }
    } catch (e) {}

    // 4. Recorded IP from previous valid requests
    if (this.recordedIp) {
      return this.recordedIp;
    }

    // 5. Fallback to physical IPv4 network interface
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          if (!iface.address.startsWith('172.') && !iface.address.startsWith('169.254.')) {
            return iface.address;
          }
        }
      }
    }

    return '127.0.0.1';
  }
}

module.exports = new HostNetwork();
