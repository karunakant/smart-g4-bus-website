/**
 * SmartBus G4 Home Automation & Z-Audio RSIP Server
 *
 * Core backend application serving Express REST API, WebSocket real-time relay,
 * SmartBus UDP socket listener (Port 6000), Z-Audio controller via IP Gateway (192.168.0.200),
 * Alexa Voice Bridge, and Subnet Scanner.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const dgram = require('dgram');
const cors = require('cors');

const { OPCODES, DEVICE_TYPES, encodePacket, encodeSmartCloudPacket, encodeSmartCloudIPPacket, decodePacket, encodeChannelControl, encodeHVACControl, encodeSceneControl } = require('./lib/smartbus-protocol');
const ZAudioController = require('./lib/zaudio-controller');
const deviceManager = require('./lib/device-manager');
const SmartBusSimulator = require('./lib/smartbus-simulator');
const AlexaBridge = require('./lib/alexa-bridge');
const mqttQueueService = require('./lib/mqtt-queue-service');

const PORT = process.env.PORT || 3000;
const UDP_PORT = process.env.UDP_PORT || 6000;
const GATEWAY_DEFAULT_IP = process.env.GATEWAY_IP || '192.168.0.200';
let currentGatewayIp = GATEWAY_DEFAULT_IP;
const ZAUDIO_DEFAULT_IP = process.env.ZAUDIO_IP || GATEWAY_DEFAULT_IP;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Packet Logs Buffer
const recentLogs = [];
function addLogEntry(log) {
  recentLogs.unshift(log);
  if (recentLogs.length > 100) recentLogs.pop();
  broadcast({ type: 'BUS_LOG', log });
}

// 1. Initialize Z-Audio Driver (Disabled / Closed by default)
const zaudio = new ZAudioController({
  ip: ZAUDIO_DEFAULT_IP,
  port: 6000,
  subnet: 1,
  deviceId: 50,
  enabled: false,
  simulationMode: false
});

// 2. Initialize SmartBus Hardware Simulator
const simulator = new SmartBusSimulator({
  enabled: false,
  logCallback: (logEvent) => addLogEntry(logEvent)
});

// 3. Initialize Alexa Smart Home Voice Bridge
const alexaBridge = new AlexaBridge({
  port: PORT,
  enabled: true,
  deviceManager,
  zaudio
});

// 4. Initialize Primary SmartBus UDP Socket
let udpSocket = null;
try {
  udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  udpSocket.on('listening', () => {
    const address = udpSocket.address();
    console.log(`[SmartBus UDP] Listening on ${address.address}:${address.port}`);
    try {
      udpSocket.setBroadcast(true);
    } catch (e) {
      console.warn('[SmartBus UDP] Broadcast set warning:', e.message);
    }
  });

  udpSocket.on('message', (msg, rinfo) => {
    const parsed = decodePacket(msg);
    if (parsed) {
      if (parsed.srcDevice !== 254) {
        addLogEntry({
          timestamp: new Date().toLocaleTimeString(),
          direction: 'RX',
          ip: rinfo.address,
          port: rinfo.port,
          hex: parsed.rawHex,
          details: `Opcode ${parsed.opcodeHex} from Sub:${parsed.srcSubnet} Dev:${parsed.srcDevice}`
        });
      }
    }

    if (simulator.enabled) {
      const resp = simulator.handleIncomingBuffer(msg, rinfo);
      if (resp && udpSocket) {
        udpSocket.send(resp, 0, resp.length, rinfo.port, rinfo.address);
      }
    }
  });

  udpSocket.on('error', (err) => {
    console.warn('[SmartBus UDP] Socket error:', err.message);
  });

  udpSocket.bind(UDP_PORT);
} catch (e) {
  console.warn('[SmartBus UDP] Could not bind UDP socket:', e.message);
}

// 5. Initialize MQTT & Priority Queue Service
mqttQueueService.init({
  deviceManager,
  zaudio,
  sendSmartBusUDP,
  broadcastWS: broadcast
});

/**
 * Transmits UDP binary packets to physical network targets
 * Dispatches to Directed Broadcast (192.168.0.255), 255.255.255.255, Gateway (192.168.0.200) and LAN IPs
 */
function sendSmartBusUDP(packetOptions) {
  if (!udpSocket) return false;

  const baseOpts = {
    srcType: DEVICE_TYPES.MOBILE_APP,
    ...packetOptions
  };

  const crcTypes = ['ADDITIVE', 'CRC16_0000', 'CRC16_FFFF'];
  const srcTypes = [DEVICE_TYPES.MOBILE_APP, DEVICE_TYPES.PC_SOFTWARE];
  const payloads = [baseOpts.data || []];

  if (baseOpts.opcode === OPCODES.SINGLE_CHANNEL_CONTROL && baseOpts.data && baseOpts.data.length >= 2) {
    const ch = baseOpts.data[0];
    const lvl = baseOpts.data[1];
    payloads.push([ch, lvl]);
    payloads.push([ch, lvl, 0, 0]);
  }

  const packetsToSend = [];
  const addedHexes = new Set();

  srcTypes.forEach(srcType => {
    crcTypes.forEach(crcType => {
      payloads.forEach(data => {
        const opts = { ...baseOpts, srcType, crcType, data };
        
        const p1 = encodeSmartCloudIPPacket({ ip: currentGatewayIp, ...opts });
        const p2 = encodeSmartCloudPacket(opts);
        const p3 = encodePacket(opts);

        [p1, p2, p3].forEach(p => {
          const hex = p.toString('hex').toUpperCase();
          if (!addedHexes.has(hex)) {
            addedHexes.add(hex);
            packetsToSend.push(p);
          }
        });
      });
    });
  });

  const parsed = decodePacket(packetsToSend[0]);
  if (parsed) {
    addLogEntry({
      timestamp: new Date().toLocaleTimeString(),
      direction: 'TX',
      ip: currentGatewayIp,
      port: UDP_PORT,
      hex: parsed.rawHex,
      details: `Sending Opcode ${parsed.opcodeHex} to Sub:${parsed.targetSubnet} Dev:${parsed.targetDevice} Ch:${parsed.data[0] || 1}`
    });
  }

  const ipParts = currentGatewayIp.split('.');
  const subnetBroadcastIp = (ipParts.length === 4) ? `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.255` : '192.168.0.255';

  const targetIPs = [
    ...new Set([
      currentGatewayIp,
      subnetBroadcastIp,
      '255.255.255.255',
      '192.168.0.255'
    ])
  ];

  targetIPs.forEach(targetIP => {
    try {
      packetsToSend.forEach(pkt => {
        udpSocket.send(pkt, 0, pkt.length, UDP_PORT, targetIP, () => {});
      });
    } catch (err) {
      console.warn(`[SmartBus UDP] Transmit error to ${targetIP}:`, err.message);
    }
  });

  return true;
}

// -------------------------------------------------------------
// WebSocket Realtime Connection Handling
// -------------------------------------------------------------
function broadcast(messageObj) {
  const json = JSON.stringify(messageObj);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected.');

  ws.send(JSON.stringify({
    type: 'INITIAL_STATE',
    data: {
      devices: deviceManager.getSnapshot(),
      zaudio: zaudio.getAllStates(),
      queue: mqttQueueService.getQueueStatus(),
      system: {
        serverTime: new Date().toISOString(),
        zaudioIp: zaudio.ip,
        gatewayIp: GATEWAY_DEFAULT_IP,
        udpPort: UDP_PORT,
        simulatorEnabled: simulator.enabled,
        alexaEnabled: true
      }
    }
  }));

  ws.on('message', async (message) => {
    try {
      const payload = JSON.parse(message);
      await handleWebSocketMessage(payload, ws);
    } catch (e) {
      console.error('[WebSocket] Parsing error:', e.message);
    }
  });
});

async function handleWebSocketMessage(msg, ws) {
  switch (msg.action) {
    case 'CONTROL_DEVICE': {
      mqttQueueService.enqueue({
        type: 'CONTROL_DEVICE',
        targetId: msg.id,
        payload: msg.updates,
        priority: msg.priority || 'HIGH',
        source: 'WEB'
      });
      break;
    }

    case 'ADD_DEVICE': {
      const newDev = deviceManager.addDevice(msg.deviceData);
      broadcast({ type: 'SNAPSHOT_UPDATED', snapshot: deviceManager.getSnapshot() });
      mqttQueueService.publishHomeAssistantDiscovery();
      break;
    }

    case 'DELETE_DEVICE': {
      deviceManager.deleteDevice(msg.id);
      broadcast({ type: 'SNAPSHOT_UPDATED', snapshot: deviceManager.getSnapshot() });
      break;
    }

    case 'START_SCANNER': {
      sendSmartBusUDP({
        srcSubnet: 1,
        srcDevice: 254,
        opcode: OPCODES.DEVICE_SEARCH,
        targetSubnet: 255,
        targetDevice: 255,
        data: []
      });

      const results = deviceManager.runSubnetScan(msg.subnet || 1);
      broadcast({ type: 'SCAN_COMPLETED', results });
      break;
    }

    case 'TRIGGER_SCENE': {
      mqttQueueService.enqueue({
        type: 'TRIGGER_SCENE',
        targetId: msg.sceneId,
        priority: 'HIGH',
        source: 'WEB'
      });
      break;
    }

    case 'CONTROL_ZAUDIO': {
      const { zoneId, type, value } = msg;
      mqttQueueService.enqueue({
        type: 'CONTROL_ZAUDIO',
        targetId: zoneId,
        payload: { zoneId, action: type, value },
        priority: 'HIGH',
        source: 'WEB'
      });
      break;
    }

    case 'CONTROL_HVAC': {
      mqttQueueService.enqueue({
        type: 'CONTROL_HVAC',
        targetId: msg.id,
        payload: msg.updates,
        priority: 'HIGH',
        source: 'WEB'
      });
      break;
    }

    case 'CONTROL_CURTAIN': {
      mqttQueueService.enqueue({
        type: 'CONTROL_CURTAIN',
        targetId: msg.id,
        payload: { position: msg.position },
        priority: 'NORMAL',
        source: 'WEB'
      });
      break;
    }

    case 'PURGE_QUEUE': {
      mqttQueueService.purgeQueue();
      break;
    }

    case 'SET_QUEUE_PAUSED': {
      mqttQueueService.setPaused(msg.paused);
      break;
    }

    case 'UPDATE_MQTT_CONFIG': {
      if (msg.config) {
        mqttQueueService.updateConfig(msg.config);
      }
      break;
    }

    case 'UPDATE_SETTINGS': {
      if (msg.settings) {
        const ip = msg.settings.gatewayIp || msg.settings.zaudioIp;
        if (ip) {
          currentGatewayIp = ip;
          zaudio.updateConfig({ ip });
        }
        if (msg.settings.simulationMode !== undefined) {
          simulator.enabled = Boolean(msg.settings.simulationMode);
          zaudio.updateConfig({ simulationMode: simulator.enabled });
        }
        broadcast({
          type: 'SETTINGS_UPDATED',
          settings: {
            gatewayIp: currentGatewayIp,
            simulationMode: simulator.enabled
          }
        });
      }
      break;
    }
  }
}

// -------------------------------------------------------------
// Alexa Smart Home & Hue Bridge Emulation Endpoints
// -------------------------------------------------------------
app.get('/description.xml', (req, res) => {
  res.type('application/xml');
  res.send(alexaBridge.getDescriptionXML(req.hostname || alexaBridge.getLocalIP()));
});

app.post('/api', (req, res) => {
  res.json([{ success: { username: '1028d6642673e4e5263164ece22821e' } }]);
});

app.get('/api/:username', (req, res) => {
  const username = req.params.username;
  if (username === 'alexa' || username.length > 5) {
    return res.json({
      lights: alexaBridge.getAlexaDevices(),
      groups: {},
      schedules: {},
      scenes: {},
      rules: {},
      sensors: {},
      config: {
        name: 'Philips hue',
        mac: '00:17:88:09:d7:4d',
        dhcp: true,
        ipaddress: alexaBridge.getLocalIP(),
        netmask: '255.255.255.0',
        gateway: '192.168.0.1',
        bridgeid: '001788FFFE09D74D',
        modelid: 'BSB002',
        swversion: '1935144020'
      }
    });
  }
  res.status(404).json({ error: 'Device not found' });
});

app.get(['/api/alexa/lights', '/api/:username/lights'], (req, res) => {
  res.json(alexaBridge.getAlexaDevices());
});

app.get(['/api/alexa/lights/:id', '/api/:username/lights/:id'], (req, res) => {
  const devices = alexaBridge.getAlexaDevices();
  const dev = devices[req.params.id];
  if (dev) return res.json(dev);
  res.status(404).json({ error: 'Device not found' });
});

app.put(['/api/alexa/lights/:id/state', '/api/:username/lights/:id/state'], async (req, res) => {
  const result = await alexaBridge.handleAlexaStateUpdate(req.params.id, req.body);
  broadcast({ type: 'SNAPSHOT_UPDATED', snapshot: deviceManager.getSnapshot() });
  broadcast({ type: 'ZAUDIO_UPDATED', zaudio: zaudio.getAllStates() });
  res.json(result);
});

// -------------------------------------------------------------
// REST API Routes
// -------------------------------------------------------------
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    system: 'SmartBus G4 Home Automation System',
    hardwareHost: 'ZAudio RSIP',
    zaudioRsipHost: true,
    serverTime: new Date().toISOString(),
    alexaBridge: {
      enabled: true,
      discoveredDevicesCount: Object.keys(alexaBridge.getAlexaDevices()).length
    },
    zaudio: {
      ip: zaudio.ip,
      online: true,
      zonesCount: Object.keys(zaudio.zones).length
    },
    smartbus: {
      udpPort: UDP_PORT,
      simulationMode: simulator.enabled
    },
    queueService: mqttQueueService.getQueueStatus()
  });
});

app.get('/api/snapshot', (req, res) => {
  res.json({
    devices: deviceManager.getSnapshot(),
    zaudio: zaudio.getAllStates()
  });
});

app.post('/api/devices/add', (req, res) => {
  const dev = deviceManager.addDevice(req.body);
  broadcast({ type: 'SNAPSHOT_UPDATED', snapshot: deviceManager.getSnapshot() });
  res.json({ success: true, device: dev });
});

app.delete('/api/devices/:id', (req, res) => {
  const ok = deviceManager.deleteDevice(req.params.id);
  if (ok) {
    broadcast({ type: 'SNAPSHOT_UPDATED', snapshot: deviceManager.getSnapshot() });
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Device not found' });
});

app.post('/api/scanner/start', (req, res) => {
  const results = deviceManager.runSubnetScan(req.body.subnet || 1);
  broadcast({ type: 'SCAN_COMPLETED', results });
  res.json({ success: true, results });
});

app.get('/api/logs', (req, res) => {
  res.json(recentLogs);
});

app.post('/api/device/control', (req, res) => {
  const { id, updates } = req.body;
  const dev = deviceManager.updateDevice(id, updates);
  if (dev) {
    const payloadData = encodeChannelControl(dev.channel, dev.level);
    sendSmartBusUDP({
      srcSubnet: 1,
      srcDevice: 254,
      opcode: OPCODES.SINGLE_CHANNEL_CONTROL,
      targetSubnet: dev.subnet,
      targetDevice: dev.deviceId,
      data: payloadData
    });
    broadcast({ type: 'DEVICE_UPDATED', device: dev });
    return res.json({ success: true, device: dev });
  }
  res.status(404).json({ error: 'Device not found' });
});

app.post('/api/zaudio/control', async (req, res) => {
  const { zoneId, action, value } = req.body;

  if (action === 'volume') await zaudio.setVolume(zoneId, value);
  else if (action === 'source') await zaudio.setSource(zoneId, value);
  else if (action === 'playback') await zaudio.controlPlayback(zoneId, value);
  else if (action === 'power') await zaudio.setPower(zoneId, value);

  broadcast({ type: 'ZAUDIO_UPDATED', zaudio: zaudio.getAllStates() });
  res.json({ success: true, zaudio: zaudio.getAllStates() });
});

app.post('/api/scene/trigger', (req, res) => {
  const { sceneId } = req.body;
  const job = mqttQueueService.enqueue({
    type: 'TRIGGER_SCENE',
    targetId: sceneId,
    priority: 'HIGH',
    source: 'API'
  });
  res.json({ success: true, sceneId, jobId: job.id });
});

// -------------------------------------------------------------
// Queue Service & MQTT REST API Endpoints
// -------------------------------------------------------------
app.get('/api/queue/status', (req, res) => {
  res.json(mqttQueueService.getQueueStatus());
});

app.post('/api/queue/config', (req, res) => {
  mqttQueueService.updateConfig(req.body);
  res.json({ success: true, config: mqttQueueService.getQueueStatus().mqtt });
});

app.post('/api/queue/enqueue', (req, res) => {
  const job = mqttQueueService.enqueue({
    type: req.body.type || 'CONTROL_DEVICE',
    targetId: req.body.targetId,
    payload: req.body.payload || {},
    priority: req.body.priority || 'NORMAL',
    source: req.body.source || 'API'
  });
  res.json({ success: true, job });
});

app.post('/api/queue/purge', (req, res) => {
  mqttQueueService.purgeQueue();
  res.json({ success: true, message: 'Queue purged' });
});

app.post('/api/queue/pause', (req, res) => {
  mqttQueueService.setPaused(true);
  res.json({ success: true, paused: true });
});

app.post('/api/queue/resume', (req, res) => {
  mqttQueueService.setPaused(false);
  res.json({ success: true, paused: false });
});

// Start HTTP Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` SmartBus G4 & Z-Audio Home Automation Server`);
  console.log(` Web App URL  : http://localhost:${PORT}`);
  console.log(` Gateway IP   : ${GATEWAY_DEFAULT_IP}:${UDP_PORT}`);
  console.log(` Z-Audio LAN  : ${zaudio.ip}:${zaudio.port}`);
  console.log(` Directed Subnet Broadcast: 192.168.0.255:6000`);
  console.log(`=======================================================`);
});
