/**
 * Central Host Network Configuration & Dynamic IP Resolver
 * --------------------------------------------------------
 * Manages host IP address resolution dynamically in one central location
 * so that changing DHCP assignments (e.g. between .18, .24, etc.) are detected
 * and shared centrally across Alexa Bridge, Home Assistant MQTT, and Web Services
 * with zero hardcoding.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const NETWORK_FILE = path.join(__dirname, '..', 'data', 'network.json');

class HostNetwork {
  constructor() {
    this.cachedIP = null;
    this.networkFile = NETWORK_FILE;
    this.loadFromFile();
  }

  /**
   * Reads dynamic host IP from shared data/network.json
   */
  loadFromFile() {
    try {
      if (fs.existsSync(this.networkFile)) {
        const raw = fs.readFileSync(this.networkFile, 'utf8');
        const data = JSON.parse(raw);
        if (data && data.hostIp && this.isValidIPv4(data.hostIp)) {
          this.cachedIP = data.hostIp.trim();
          return this.cachedIP;
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    return null;
  }

  /**
   * Persists dynamic host IP to shared data/network.json
   */
  saveToFile(ip) {
    if (!this.isValidIPv4(ip)) return;
    try {
      const data = {
        hostIp: ip,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.networkFile, JSON.stringify(data, null, 2), 'utf8');
      this.cachedIP = ip;
    } catch (e) {
      // Ignore filesystem permission notes
    }
  }

  /**
   * Validates non-internal, non-Docker IPv4 format
   */
  isValidIPv4(ip) {
    if (!ip || typeof ip !== 'string') return false;
    const trimmed = ip.trim();
    if (trimmed === 'localhost' || trimmed.startsWith('127.') || trimmed.startsWith('169.254.')) return false;
    // Exclude Docker virtual bridge subnets
    if (
      trimmed.startsWith('172.16.') ||
      trimmed.startsWith('172.17.') ||
      trimmed.startsWith('172.18.') ||
      trimmed.startsWith('172.19.') ||
      trimmed.startsWith('172.20.') ||
      trimmed.startsWith('172.21.') ||
      trimmed.startsWith('172.22.') ||
      trimmed.startsWith('172.23.') ||
      trimmed.startsWith('172.24.') ||
      trimmed.startsWith('172.25.') ||
      trimmed.startsWith('172.26.') ||
      trimmed.startsWith('172.27.') ||
      trimmed.startsWith('172.28.') ||
      trimmed.startsWith('172.29.') ||
      trimmed.startsWith('172.30.') ||
      trimmed.startsWith('172.31.')
    ) {
      return false;
    }
    const parts = trimmed.split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => {
      const n = parseInt(p, 10);
      return !isNaN(n) && n >= 0 && n <= 255;
    });
  }

  /**
   * Records host IP observed from incoming HTTP request headers (Host / X-Forwarded-Host)
   */
  recordFromRequest(req) {
    if (!req) return this.getHostIP();
    const hostHeader = req.headers ? (req.headers['x-forwarded-host'] || req.headers.host) : null;
    const candidate = hostHeader ? hostHeader.split(':')[0] : (req.hostname || null);
    if (this.isValidIPv4(candidate)) {
      if (this.cachedIP !== candidate) {
        this.saveToFile(candidate);
      }
      return candidate;
    }
    return this.getHostIP();
  }

  /**
   * Returns current host LAN IP using prioritized dynamic cascade:
   * 1. process.env.HOST_IP (if explicitly set and not 'auto')
   * 2. Shared data/network.json (written by host SSDP daemon or web traffic)
   * 3. In-memory cached IP
   * 4. Physical network interface scan
   */
  getHostIP(req = null) {
    if (req) {
      const fromReq = this.recordFromRequest(req);
      if (fromReq) return fromReq;
    }

    // 1. Explicit environment override
    const envIP = process.env.HOST_IP || process.env.ALEXA_BRIDGE_IP || process.env.SERVER_IP;
    if (envIP && envIP.trim() && envIP.trim() !== 'auto') {
      return envIP.trim();
    }

    // 2. Read from shared network.json
    const fromFile = this.loadFromFile();
    if (fromFile) return fromFile;

    // 3. Return memory cache if valid
    if (this.cachedIP && this.isValidIPv4(this.cachedIP)) {
      return this.cachedIP;
    }

    // 4. Auto-detect from system network interfaces
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          if (this.isValidIPv4(iface.address)) {
            this.saveToFile(iface.address);
            return iface.address;
          }
        }
      }
    }

    return '127.0.0.1';
  }

  /**
   * Calculates subnet directed broadcast IP (e.g. 192.168.0.255)
   */
  getSubnetBroadcast(ip = null) {
    const target = ip || this.getHostIP();
    const parts = (target || '').split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.255`;
    }
    return '255.255.255.255';
  }

  /**
   * Calculates default gateway IP (e.g. 192.168.0.1)
   */
  getDefaultGateway(ip = null) {
    const target = ip || this.getHostIP();
    const parts = (target || '').split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
    }
    return 'auto';
  }
}

module.exports = new HostNetwork();

