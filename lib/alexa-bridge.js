/**
 * Alexa Smart Home Voice Bridge (Philips Hue Bridge Emulation)
 *
 * Implements SSDP UPnP multicast discovery (Port 1900 / 239.255.255.250)
 * and Philips Hue V1/V2 REST API endpoints so that Amazon Echo devices
 * (all generations) discover and control SmartBus G4 channels and Z-Audio zones.
 */

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const { OPCODES, encodeChannelControl } = require('./smartbus-protocol');
const hostNetwork = require('./host-network');

class AlexaBridge {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.externalPort = options.externalPort || (process.env.EXTERNAL_PORT ? parseInt(process.env.EXTERNAL_PORT) : 80);
    this.enabled = options.enabled !== undefined ? options.enabled : true;
    this.deviceManager = options.deviceManager;
    this.zaudio = options.zaudio;
    this.mqttQueueService = options.mqttQueueService || null;
    this.sendSmartBusUDP = options.sendSmartBusUDP || null;

    // Strict sequential Hue numeric string mapping: "1", "2", ...
    this.numericToDeviceMap = new Map();
    this.idToNumericMap = new Map();

    // Constant Philips Hue V1/V2 Bridge Identifiers
    this.macAddress = '00:17:88:09:d7:4d';
    this.bridgeId = '001788FFFE09D74D';
    this.bridgeUuid = '2f402f80-da50-11e1-9b23-00178809d74d';
    this.defaultUsername = '1028d6642673e4e5263164ece22821e';

    this.ssdpSocket = null;
    this.alexaHttpServer = null;

    if (this.enabled) {
      this.initSSDP();
    }
  }

  setQueueService(service) {
    this.mqttQueueService = service;
  }

  setSendSmartBusUDP(fn) {
    this.sendSmartBusUDP = fn;
  }

  setExternalPort(port) {
    this.externalPort = port;
  }

  /**
   * Retrieves local network IPv4 address for SSDP LOCATION response
   */
  getLocalIP() {
    // If HOST_IP environment variable is set to a specific IP (not 'auto')
    if (process.env.HOST_IP && process.env.HOST_IP.trim().toLowerCase() !== 'auto') {
      return process.env.HOST_IP.trim();
    }

    // Try central hostNetwork resolution (checks data/network.json and valid host IP)
    const resolved = hostNetwork.getHostIP();
    if (resolved && resolved !== '127.0.0.1' && !resolved.startsWith('172.')) {
      return resolved;
    }

    const interfaces = os.networkInterfaces();
    // Auto-detect primary LAN IPv4 address (avoiding Docker 172.x, WSL 172.x, and Link-Local 169.254.x)
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const addr = iface.address;
          if (
            !addr.startsWith('127.') &&
            !addr.startsWith('169.254.') &&
            !addr.startsWith('172.')
          ) {
            return addr;
          }
        }
      }
    }

    // Fallback: any non-internal IPv4
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('127.')) {
          return iface.address;
        }
      }
    }

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
          /M-SEARCH/i.test(message) &&
          (/ssdp:discover/i.test(message) ||
            /ssdp:all/i.test(message) ||
            /upnp:rootdevice/i.test(message) ||
            /basic:1/i.test(message) ||
            /device:basic/i.test(message))
        ) {
          console.log(`[Alexa Bridge] SSDP M-SEARCH received from ${rinfo.address}:${rinfo.port}`);
          this.respondSSDP(rinfo, message);
        }
      });

      this.ssdpSocket.bind(1900, () => {
        const localIP = this.getLocalIP();
        try {
          this.ssdpSocket.addMembership('239.255.255.250');
        } catch (e) {
          console.warn('[Alexa Bridge] SSDP default membership note:', e.message);
        }
        try {
          if (localIP && localIP !== '127.0.0.1') {
            this.ssdpSocket.addMembership('239.255.255.250', localIP);
          }
        } catch (e) {
          // Interface-specific join might fail if already joined
        }
        try {
          this.ssdpSocket.setMulticastTTL(4);
          this.ssdpSocket.setMulticastLoopback(true);
        } catch (e) {}

        console.log(`[Alexa Bridge] SSDP UPnP Multicast listener online on 239.255.255.250:1900 (Host IP: ${localIP}, Port: ${this.externalPort})`);
      });
    } catch (e) {
      console.warn('[Alexa Bridge] SSDP Init exception:', e.message);
    }
  }

  /**
   * Send UPnP SSDP Response to Alexa broadcast with correct Host IP and externalPort
   */
  respondSSDP(rinfo, message = '') {
    const localIP = this.getLocalIP();
    const port = this.externalPort || this.port;

    const baseHeaders = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=100',
      'EXT:',
      `LOCATION: http://${localIP}:${port}/description.xml`,
      'SERVER: FreeRTOS/7.4.2 UPnP/1.0 IpBridge/1.17.0',
      `hue-bridgeid: ${this.bridgeId}`
    ];

    const respBasic = [
      ...baseHeaders,
      'ST: urn:schemas-upnp-org:device:basic:1',
      `USN: uuid:${this.bridgeUuid}::urn:schemas-upnp-org:device:basic:1`,
      '', ''
    ].join('\r\n');

    const respRoot = [
      ...baseHeaders,
      'ST: upnp:rootdevice',
      `USN: uuid:${this.bridgeUuid}::upnp:rootdevice`,
      '', ''
    ].join('\r\n');

    const respUuid = [
      ...baseHeaders,
      `ST: uuid:${this.bridgeUuid}`,
      `USN: uuid:${this.bridgeUuid}`,
      '', ''
    ].join('\r\n');

    const packetsToSend = [];
    if (/basic:1/i.test(message)) {
      packetsToSend.push(respBasic);
    } else if (/rootdevice/i.test(message)) {
      packetsToSend.push(respRoot);
    } else {
      // ssdp:all or general search
      packetsToSend.push(respBasic, respRoot, respUuid);
    }

    if (this.ssdpSocket) {
      const sendBatch = () => {
        packetsToSend.forEach((resp) => {
          const buf = Buffer.from(resp);
          this.ssdpSocket.send(buf, 0, buf.length, rinfo.port, rinfo.address, () => {});
        });
      };

      // Transmit immediately, and repeat after 80ms to prevent Wi-Fi UDP packet loss
      sendBatch();
      setTimeout(sendBatch, 80);
    }
  }

  /**
   * Return XML device description for Alexa setup
   * Meets strict Philips Hue specifications for Amazon Echo
   */
  getDescriptionXML(hostIP) {
    const ip = (hostIP && hostIP !== 'localhost' && hostIP !== '127.0.0.1') ? hostIP.split(':')[0] : this.getLocalIP();
    const port = this.externalPort || this.port;

    return `<?xml version="1.0" encoding="UTF-8"?>
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
    <modelDescription>Philips hue Personal Wireless Lighting</modelDescription>
    <modelName>Philips hue bridge 2012</modelName>
    <modelNumber>929000226503</modelNumber>
    <modelURL>http://www.meethue.com</modelURL>
    <serialNumber>00178809d74d</serialNumber>
    <UDN>uuid:${this.bridgeUuid}</UDN>
    <serviceList>
      <service>
        <serviceType>(urn:schemas-upnp-org:service:dummy:1)</serviceType>
        <serviceId>(urn:schemas-upnp-org:serviceId:dummy)</serviceId>
        <controlURL>/api</controlURL>
        <eventSubURL>/api</eventSubURL>
        <SCPDURL>/api</SCPDURL>
      </service>
    </serviceList>
  </device>
</root>`;
  }

  /**
   * Format devices for Alexa Hue API discovery endpoint.
   * STRICT: Keys MUST BE sequential integer strings ("1", "2", "3"...)
   * without duplicates, matching standard Hue bridge specification.
   */
  getAlexaDevices() {
    const alexaDevices = {};
    this.numericToDeviceMap.clear();
    this.idToNumericMap.clear();

    const snapshot = this.deviceManager ? this.deviceManager.getSnapshot() : { devices: [] };
    const deviceList = Array.isArray(snapshot.devices) ? snapshot.devices : Object.values(snapshot.devices || {});

    let counter = 1;

    // 1. SmartBus Lighting & Switches
    deviceList.forEach((dev) => {
      const numericId = counter.toString();
      counter++;

      const hexIndex = counter.toString(16).padStart(4, '0');
      const b1 = hexIndex.slice(0, 2);
      const b2 = hexIndex.slice(2, 4);

      const deviceName = dev.room ? `${dev.room} ${dev.name}` : dev.name;

      this.numericToDeviceMap.set(numericId, {
        type: 'smartbus',
        id: dev.id,
        device: dev
      });
      this.idToNumericMap.set(dev.id, numericId);

      const briValue = Math.max(1, Math.min(254, Math.round(((dev.level !== undefined ? dev.level : 100) / 100) * 254)));

      alexaDevices[numericId] = {
        state: {
          on: Boolean(dev.power),
          bri: briValue,
          hue: 0,
          sat: 0,
          effect: 'none',
          xy: [0.5, 0.5],
          ct: 500,
          alert: 'none',
          colormode: 'hs',
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
    });

    // 2. Z-Audio Multi-Zone Controllers (if enabled)
    if (this.zaudio && this.zaudio.enabled && this.zaudio.zones) {
      Object.values(this.zaudio.zones).forEach((zone) => {
        const numericId = counter.toString();
        counter++;

        const hexIndex = (counter + 100).toString(16).padStart(4, '0');
        const b1 = hexIndex.slice(0, 2);
        const b2 = hexIndex.slice(2, 4);

        const zId = `zaudio_zone_${zone.id}`;
        this.numericToDeviceMap.set(numericId, {
          type: 'zaudio',
          id: zId,
          zone
        });
        this.idToNumericMap.set(zId, numericId);

        const briValue = Math.max(1, Math.min(254, Math.round(((zone.volume || 0) / 79) * 254)));

        alexaDevices[numericId] = {
          state: {
            on: Boolean(zone.power),
            bri: briValue,
            hue: 0,
            sat: 0,
            effect: 'none',
            xy: [0.5, 0.5],
            ct: 500,
            alert: 'none',
            colormode: 'hs',
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
   * Retrieves single light info by ID (numeric or dev.id)
   */
  getAlexaDevice(id) {
    const devices = this.getAlexaDevices();
    if (devices[id]) return devices[id];

    // Check if passed string dev.id
    const numericId = this.idToNumericMap.get(id);
    if (numericId && devices[numericId]) {
      return devices[numericId];
    }
    return null;
  }

  /**
   * Standard Hue Bridge Configuration payload
   */
  getConfig() {
    const localIP = this.getLocalIP();
    return {
      name: 'Philips hue',
      zigbeechannel: 15,
      bridgeid: this.bridgeId,
      mac: this.macAddress,
      dhcp: true,
      ipaddress: localIP,
      netmask: '255.255.255.0',
      gateway: '192.168.0.1',
      proxyaddress: 'none',
      proxyport: 0,
      UTC: new Date().toISOString(),
      localtime: new Date().toISOString().replace('Z', ''),
      timezone: 'auto',
      modelid: 'BSB002',
      datastoreversion: '90',
      swversion: '01036562',
      apiversion: '1.16.0',
      swupdate: {
        updatestate: 0,
        checkforupdate: false,
        devicetypes: { bridge: false, lights: [] },
        url: '',
        text: '',
        notify: false
      },
      linkbutton: false,
      portalservices: false,
      portalconnection: 'connected',
      portalstate: {
        signedon: true,
        incoming: false,
        outgoing: true,
        communication: 'connected'
      },
      factorynew: false,
      replacesbridgeid: null,
      touchlink: false,
      whitelist: {
        [this.defaultUsername]: {
          'last use date': new Date().toISOString(),
          'create date': new Date().toISOString(),
          name: 'Amazon Echo'
        },
        alexa: {
          'last use date': new Date().toISOString(),
          'create date': new Date().toISOString(),
          name: 'Amazon Echo'
        }
      }
    };
  }

  /**
   * Returns Full Hue Bridge state for GET /api/:username
   */
  getFullState(username) {
    const config = this.getConfig();
    if (username && !config.whitelist[username]) {
      config.whitelist[username] = {
        'last use date': new Date().toISOString(),
        'create date': new Date().toISOString(),
        name: 'Amazon Echo'
      };
    }
    return {
      lights: this.getAlexaDevices(),
      groups: {},
      config,
      schedules: {},
      scenes: {},
      rules: {},
      sensors: {}
    };
  }

  /**
   * Process Alexa control state update (PUT /api/alexa/lights/:id/state or PUT /api/:username/lights/:id/state)
   */
  async handleAlexaStateUpdate(deviceId, body = {}) {
    console.log(`[Alexa Bridge] Voice command received for device "${deviceId}":`, body);

    // Refresh devices to make sure maps are populated
    if (this.numericToDeviceMap.size === 0) {
      this.getAlexaDevices();
    }

    // Look up target mapping (by numeric ID "1", "2" or by string ID "dev_z3_l1")
    let target = this.numericToDeviceMap.get(String(deviceId));
    if (!target) {
      const numId = this.idToNumericMap.get(deviceId);
      if (numId) target = this.numericToDeviceMap.get(numId);
    }
    if (!target && this.deviceManager && this.deviceManager.devices[deviceId]) {
      target = { type: 'smartbus', id: deviceId, device: this.deviceManager.devices[deviceId] };
    }

    if (!target) {
      console.warn(`[Alexa Bridge] Target device "${deviceId}" not found in mapping.`);
      return [{ error: { type: 3, address: `/lights/${deviceId}`, description: 'Device not found' } }];
    }

    const successResponses = [];

    // 1. Z-Audio Zone Target
    if (target.type === 'zaudio') {
      const zoneId = target.zone.id;
      if (body.on !== undefined) {
        await this.zaudio.setPower(zoneId, Boolean(body.on));
        successResponses.push({ success: { [`/lights/${deviceId}/state/on`]: Boolean(body.on) } });
      }
      if (body.bri !== undefined) {
        const vol = Math.max(0, Math.min(79, Math.round((body.bri / 254) * 79)));
        await this.zaudio.setVolume(zoneId, vol);
        successResponses.push({ success: { [`/lights/${deviceId}/state/bri`]: body.bri } });
      }
      if (successResponses.length === 0) {
        successResponses.push({ success: { [`/lights/${deviceId}/state/on`]: true } });
      }
      return successResponses;
    }

    // 2. SmartBus Equipment Device Target
    const dev = target.device;
    const devUpdates = {};

    if (body.on !== undefined) {
      devUpdates.power = Boolean(body.on);
      if (devUpdates.power && (dev.level === 0 || dev.level === undefined)) {
        devUpdates.level = dev.type === 'fan' ? 2 : 100;
      } else if (!devUpdates.power) {
        devUpdates.level = 0;
      }
      successResponses.push({ success: { [`/lights/${deviceId}/state/on`]: devUpdates.power } });
    }

    if (body.bri !== undefined) {
      const percentage = Math.max(1, Math.min(100, Math.round((body.bri / 254) * 100)));
      devUpdates.level = percentage;
      devUpdates.power = percentage > 0;
      successResponses.push({ success: { [`/lights/${deviceId}/state/bri`]: body.bri } });
    }

    if (successResponses.length === 0) {
      successResponses.push({ success: { [`/lights/${deviceId}/state/on`]: true } });
    }

    // Command Dispatching to SmartBus Hardware & State Synchronization
    if (this.mqttQueueService) {
      this.mqttQueueService.enqueue({
        type: 'CONTROL_DEVICE',
        targetId: dev.id,
        payload: devUpdates,
        priority: 'HIGH',
        source: 'ALEXA'
      });
    } else {
      const updated = this.deviceManager.updateDevice(dev.id, devUpdates);
      if (updated && this.sendSmartBusUDP) {
        const payloadData = encodeChannelControl(updated.channel, updated.level);
        this.sendSmartBusUDP({
          srcSubnet: 1,
          srcDevice: 254,
          opcode: OPCODES.SINGLE_CHANNEL_CONTROL,
          targetSubnet: updated.subnet,
          targetDevice: updated.deviceId,
          data: payloadData
        });
      }
    }

    return successResponses;
  }

  /**
   * Starts a dedicated HTTP listener on port 80 (required by Amazon Echo devices)
   * if the main Express server is on a different port.
   */
  startPort80Listener(expressApp, wss) {
    const targetPort = this.externalPort || 80;

    // If main server is already on the target port, no need for second listener
    if (this.port === targetPort) {
      console.log(`[Alexa Bridge] Primary server is already on port ${this.port}. Port 80 dedicated listener not required.`);
      return;
    }

    try {
      this.alexaHttpServer = http.createServer(expressApp);

      if (wss) {
        this.alexaHttpServer.on('upgrade', (request, socket, head) => {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        });
      }

      this.alexaHttpServer.listen(targetPort, () => {
        console.log(`[Alexa Bridge] Dedicated Port ${targetPort} HTTP listener online for Amazon Echo discovery.`);
        this.externalPort = targetPort;
      });

      this.alexaHttpServer.on('error', (err) => {
        console.warn(`[Alexa Bridge] Notice: Could not bind port ${targetPort} (${err.message}).`);
        console.warn(`[Alexa Bridge] Note: Amazon Echo strictly requires port 80. If running on Linux/Raspberry Pi:`);
        console.warn(`[Alexa Bridge]   1. Run with privileges or set capability: sudo setcap 'cap_net_bind_service=+ep' $(which node)`);
        console.warn(`[Alexa Bridge]   2. Or redirect port 80 to ${this.port}: sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port ${this.port}`);
        this.externalPort = this.port;
      });
    } catch (e) {
      console.warn('[Alexa Bridge] Port 80 listener initialization exception:', e.message);
      this.externalPort = this.port;
    }
  }
}

module.exports = AlexaBridge;
