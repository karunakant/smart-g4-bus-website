const dgram = require('dgram');
const os = require('os');

class AlexaBridge {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.externalPort = options.externalPort || process.env.EXTERNAL_PORT || (process.env.PORT ? parseInt(process.env.PORT) : 3000);
    this.enabled = options.enabled !== undefined ? options.enabled : true;
    this.deviceManager = options.deviceManager;
    this.zaudio = options.zaudio;

    this.ssdpSocket = null;
    if (this.enabled) {
      this.initSSDP();
    }
  }

  /**
   * Retrieves local network IPv4 address for SSDP LOCATION response
   */
  getLocalIP() {
    if (process.env.HOST_IP) return process.env.HOST_IP;
    try {
      const interfaces = os.networkInterfaces();
      // First try to find a LAN IP (avoid Docker 172.x internal container subnets)
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('172.') && !iface.address.startsWith('127.')) {
            return iface.address;
          }
        }
      }
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
          }
        }
      }
    } catch (e) {}
    return '127.0.0.1';
  }

  /**
   * Initializes SSDP UDP Multicast listener on port 1900 to respond to Alexa "Discover Devices"
   */
  initSSDP() {
    try {
      this.ssdpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.ssdpSocket.on('error', (err) => {
        console.warn('[Alexa Bridge] SSDP socket error:', err.message);
      });

      this.ssdpSocket.on('message', (msg, rinfo) => {
        const message = msg.toString();
        // Check if SSDP M-SEARCH broadcast from Echo / Alexa device
        if (
          message.includes('M-SEARCH') &&
          (message.includes('ssdp:discover') ||
            message.includes('ssdp:all') ||
            message.includes('upnp:rootdevice') ||
            message.includes('basic:1') ||
            message.includes('device:basic:1'))
        ) {
          console.log(`[Alexa Bridge] SSDP M-SEARCH received from ${rinfo.address}:${rinfo.port}`);
          this.respondSSDP(rinfo);
        }
      });

      this.ssdpSocket.bind(1900, () => {
        try {
          this.ssdpSocket.addMembership('239.255.255.250');
          console.log(`[Alexa Bridge] SSDP UPnP Multicast listener online on 239.255.255.250:1900 (Host IP: ${this.getLocalIP()}, Port: ${this.externalPort})`);
        } catch (e) {
          console.warn('[Alexa Bridge] Add membership note:', e.message);
        }
      });
    } catch (e) {
      console.warn('[Alexa Bridge] SSDP Init exception:', e.message);
    }
  }

  /**
   * Send UPnP SSDP Response to Alexa broadcast with correct Host IP and externalPort
   */
  respondSSDP(rinfo) {
    const localIP = this.getLocalIP();
    const port = this.externalPort || this.port;

    const headers = [
      'HTTP/1.1 200 OK',
      'HOST: 239.255.255.250:1900',
      'CACHE-CONTROL: max-age=100',
      'EXT:',
      `LOCATION: http://${localIP}:${port}/description.xml`,
      'SERVER: FreeRTOS/7.4.2 UPnP/1.0 IpBridge/1.17.0',
      'hue-bridgeid: 001788FFFE09D74D'
    ];

    const responseBasic = [
      ...headers,
      'ST: urn:schemas-upnp-org:device:basic:1',
      'USN: uuid:2f402f80-da50-11e1-9b23-00178809d74d::urn:schemas-upnp-org:device:basic:1',
      '', ''
    ].join('\r\n');

    const responseRoot = [
      ...headers,
      'ST: upnp:rootdevice',
      'USN: uuid:2f402f80-da50-11e1-9b23-00178809d74d::upnp:rootdevice',
      '', ''
    ].join('\r\n');

    const responseAll = [
      ...headers,
      'ST: ssdp:all',
      'USN: uuid:2f402f80-da50-11e1-9b23-00178809d74d::ssdp:all',
      '', ''
    ].join('\r\n');

    if (this.ssdpSocket) {
      [responseBasic, responseRoot, responseAll].forEach(resp => {
        const buf = Buffer.from(resp);
        this.ssdpSocket.send(buf, 0, buf.length, rinfo.port, rinfo.address, () => {});
      });
    }
  }

  /**
   * Return XML device description for Alexa setup
   */
  getDescriptionXML(hostIP) {
    const ip = (hostIP && hostIP !== 'localhost' && hostIP !== '127.0.0.1') ? hostIP.split(':')[0] : this.getLocalIP();
    const port = this.externalPort || this.port;
    return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <URLBase>http://${ip}:${port}/</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>
    <friendlyName>Philips hue (${ip})</friendlyName>
    <manufacturer>Royal Philips Electronics</manufacturer>
    <manufacturerURL>http://www.philips.com</manufacturerURL>
    <modelDescription>SmartBus G4 &amp; Z-Audio Home Automation</modelDescription>
    <modelName>Philips hue bridge 2012</modelName>
    <modelNumber>929000226503</modelNumber>
    <modelURL>http://www.meethue.com</modelURL>
    <serialNumber>00178809d74d</serialNumber>
    <UDN>uuid:2f402f80-da50-11e1-9b23-00178809d74d</UDN>
  </device>
</root>`;
  }

  /**
   * Format devices for Alexa Hue API discovery endpoint
   */
  getAlexaDevices() {
    const alexaDevices = {};

    // 1. SmartBus Lighting & Switches
    const snapshot = this.deviceManager ? this.deviceManager.getSnapshot() : { devices: [] };
    const deviceList = Array.isArray(snapshot.devices) ? snapshot.devices : Object.values(snapshot.devices || {});

    deviceList.forEach((dev, index) => {
      const numericId = (index + 1).toString();
      const hexIndex = (index + 1).toString(16).padStart(4, '0');
      const b1 = hexIndex.slice(0, 2);
      const b2 = hexIndex.slice(2, 4);

      const deviceName = dev.room ? `${dev.room} ${dev.name}` : dev.name;

      alexaDevices[dev.id] = {
        state: {
          on: Boolean(dev.power),
          bri: Math.max(1, Math.round(((dev.level !== undefined ? dev.level : 100) / 100) * 254)),
          hue: 0,
          sat: 0,
          effect: 'none',
          xy: [0.5, 0.5],
          ct: 500,
          alert: 'select',
          colormode: 'ct',
          mode: 'homeautomation',
          reachable: true
        },
        type: dev.type === 'rgb' ? 'Extended color light' : 'Dimmable light',
        name: deviceName,
        modelid: dev.type === 'rgb' ? 'LCT001' : 'LWB004',
        manufacturername: 'Philips',
        productname: 'Eblight',
        uniqueid: `00:17:88:01:00:d4:${b1}:${b2}-0b`,
        swversion: '66012040'
      };

      // Also index by numericId for legacy Alexa requests
      if (dev.id !== numericId) {
        alexaDevices[numericId] = alexaDevices[dev.id];
      }
    });

    // 2. Z-Audio Multi-Zone Controllers (if enabled)
    if (this.zaudio && this.zaudio.enabled && this.zaudio.zones) {
      Object.values(this.zaudio.zones).forEach((zone, index) => {
        const id = `zaudio_zone_${zone.id}`;
        const hexIndex = (index + 100).toString(16).padStart(4, '0');
        const b1 = hexIndex.slice(0, 2);
        const b2 = hexIndex.slice(2, 4);

        alexaDevices[id] = {
          state: {
            on: Boolean(zone.power),
            bri: Math.max(1, Math.round(((zone.volume || 0) / 79) * 254)),
            hue: 0,
            sat: 0,
            effect: 'none',
            xy: [0.5, 0.5],
            ct: 500,
            alert: 'select',
            colormode: 'ct',
            mode: 'homeautomation',
            reachable: true
          },
          type: 'Dimmable light',
          name: `Z-Audio ${zone.name}`,
          modelid: 'LWB004',
          manufacturername: 'Philips',
          productname: 'Eblight',
          uniqueid: `00:17:88:01:00:za:${b1}:${b2}-0b`,
          swversion: '66012040'
        };
      });
    }

    return alexaDevices;
  }

  /**
   * Process Alexa control state update (PUT /api/alexa/lights/:id/state)
   */
  async handleAlexaStateUpdate(deviceId, body) {
    console.log(`[Alexa Bridge] Voice command received for device "${deviceId}":`, body);

    if (deviceId.startsWith('zaudio_zone_')) {
      const zoneId = parseInt(deviceId.replace('zaudio_zone_', ''));
      if (body.on !== undefined) {
        await this.zaudio.setPower(zoneId, body.on);
      }
      if (body.bri !== undefined) {
        const vol = Math.round((body.bri / 254) * 79);
        await this.zaudio.setVolume(zoneId, vol);
      }
      return [{ success: { [`/lights/${deviceId}/state/on`]: body.on !== undefined ? body.on : true } }];
    }

    // SmartBus Light Device
    const devUpdates = {};
    if (body.on !== undefined) devUpdates.power = body.on;
    if (body.bri !== undefined) devUpdates.level = Math.round((body.bri / 254) * 100);

    const updated = this.deviceManager.updateDevice(deviceId, devUpdates);
    return [{ success: { [`/lights/${deviceId}/state/on`]: updated ? updated.power : true } }];
  }
}

module.exports = AlexaBridge;
