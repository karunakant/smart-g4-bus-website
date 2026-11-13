/**
 * SmartBus G4 MQTT & Priority Queue Service
 *
 * Provides an asynchronous, rate-limited priority command queue (FIFO for HIGH, NORMAL, LOW priority jobs)
 * protecting the SmartBus G4 UDP gateway from packet drop/collision, along with full MQTT Broker integration,
 * Home Assistant Auto-Discovery, and real-time WebSocket telemetry.
 */

const EventEmitter = require('events');

let mqtt = null;
try {
  mqtt = require('mqtt');
} catch (err) {
  console.warn('[MQTT Service] "mqtt" npm package not installed. Operating in Queue-Only fallback mode.');
}

class MQTTQueueService extends EventEmitter {
  constructor() {
    super();

    // Priority Queues
    this.queues = {
      HIGH: [],
      NORMAL: [],
      LOW: []
    };

    // Queue Config & State
    this.isProcessing = false;
    this.isPaused = false;
    this.interCommandDelay = 100; // ms delay between UDP command dispatches
    this.maxRetries = 3;
    this.activeJob = null;
    this.recentJobs = []; // Completed/Failed job history log (max 50)
    
    // Statistics
    this.stats = {
      totalEnqueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      totalRetried: 0,
      startedAt: new Date().toISOString()
    };

    // MQTT Config & Client State
    this.mqttConfig = {
      enabled: true,
      brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
      clientId: process.env.MQTT_CLIENT_ID || `smartbus-pi-${Math.floor(Math.random() * 10000)}`,
      username: process.env.MQTT_USERNAME || '',
      password: process.env.MQTT_PASSWORD || '',
      topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'smartbus',
      haDiscovery: true,
      haPrefix: 'homeassistant'
    };

    this.mqttClient = null;
    this.mqttStatus = 'disconnected'; // 'connected' | 'connecting' | 'disconnected' | 'error'
    this.mqttLogs = [];

    // System References
    this.deviceManager = null;
    this.zaudio = null;
    this.sendSmartBusUDP = null;
    this.broadcastWS = null;
  }

  /**
   * Initializes Queue Service dependencies and connects MQTT Client
   */
  init({ deviceManager, zaudio, sendSmartBusUDP, broadcastWS }) {
    this.deviceManager = deviceManager;
    this.zaudio = zaudio;
    this.sendSmartBusUDP = sendSmartBusUDP;
    this.broadcastWS = broadcastWS;

    console.log('[QueueService] Initialized Priority Command Queue Engine.');

    if (this.mqttConfig.enabled && mqtt) {
      this.connectMQTT();
    }

    // Start Worker Processing Loop
    this.processQueueLoop();
  }

  // -------------------------------------------------------------------
  // PRIORITY QUEUE ENGINE
  // -------------------------------------------------------------------

  /**
   * Enqueues a command job with priority ('HIGH' | 'NORMAL' | 'LOW')
   */
  enqueue({ type, targetId, payload, priority = 'NORMAL', source = 'API', opcode = null, rawData = null }) {
    const validPriority = ['HIGH', 'NORMAL', 'LOW'].includes(priority) ? priority : 'NORMAL';

    const job = {
      id: `job_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type,         // 'CONTROL_DEVICE' | 'TRIGGER_SCENE' | 'CONTROL_ZAUDIO' | 'CONTROL_HVAC' | 'CONTROL_CURTAIN' | 'RAW_UDP'
      targetId,     // Device ID / Zone ID / Scene ID
      payload,      // Control arguments (e.g. { power: true, level: 100 })
      priority: validPriority,
      source,       // 'MQTT' | 'WEB' | 'ALEXA' | 'API' | 'SYSTEM'
      opcode,
      rawData,
      status: 'queued', // 'queued' | 'processing' | 'completed' | 'failed'
      retries: 0,
      enqueuedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null
    };

    this.queues[validPriority].push(job);
    this.stats.totalEnqueued++;

    this.logMQTT(`[Queue] Enqueued Job ${job.id} (${job.type} -> ${job.targetId}) [Priority: ${job.priority}]`);

    this.notifyQueueUpdate();
    this.publishMQTTQueueStatus();

    return job;
  }

  /**
   * Main Queue Worker Processing Loop
   */
  async processQueueLoop() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (true) {
      if (this.isPaused) {
        await this.sleep(200);
        continue;
      }

      const nextJob = this.getNextJob();
      if (!nextJob) {
        await this.sleep(100);
        continue;
      }

      this.activeJob = nextJob;
      nextJob.status = 'processing';
      nextJob.startedAt = new Date().toISOString();
      this.notifyQueueUpdate();

      try {
        const success = await this.executeJob(nextJob);

        if (success) {
          nextJob.status = 'completed';
          nextJob.completedAt = new Date().toISOString();
          this.stats.totalProcessed++;
          this.logMQTT(`[Queue] Completed Job ${nextJob.id} (${nextJob.type})`);
        } else {
          throw new Error('Command execution returned unsuccessful status');
        }
      } catch (err) {
        nextJob.retries++;
        this.stats.totalRetried++;
        console.warn(`[QueueService] Job ${nextJob.id} failed (Attempt ${nextJob.retries}/${this.maxRetries}):`, err.message);

        if (nextJob.retries < this.maxRetries) {
          // Re-enqueue job at top of priority queue after backoff delay
          await this.sleep(200 * nextJob.retries);
          this.queues[nextJob.priority].unshift(nextJob);
        } else {
          nextJob.status = 'failed';
          nextJob.error = err.message;
          nextJob.completedAt = new Date().toISOString();
          this.stats.totalFailed++;
          this.logMQTT(`[Queue] FAILED Job ${nextJob.id}: ${err.message}`);
        }
      }

      if (nextJob.status === 'completed' || nextJob.status === 'failed') {
        this.recentJobs.unshift(nextJob);
        if (this.recentJobs.length > 50) this.recentJobs.pop();
        this.activeJob = null;
      }

      this.notifyQueueUpdate();
      this.publishMQTTQueueStatus();

      // Inter-command throttling delay to protect UDP gateway
      await this.sleep(this.interCommandDelay);
    }
  }

  /**
   * Retrieves the next available job in FIFO order respecting HIGH > NORMAL > LOW priority
   */
  getNextJob() {
    if (this.queues.HIGH.length > 0) return this.queues.HIGH.shift();
    if (this.queues.NORMAL.length > 0) return this.queues.NORMAL.shift();
    if (this.queues.LOW.length > 0) return this.queues.LOW.shift();
    return null;
  }

  /**
   * Dispatches and executes command hardware logic
   */
  async executeJob(job) {
    if (!this.deviceManager) return true;

    switch (job.type) {
      case 'CONTROL_DEVICE': {
        const updated = this.deviceManager.updateDevice(job.targetId, job.payload);
        if (updated && this.sendSmartBusUDP) {
          const { encodeChannelControl, OPCODES, DEVICE_TYPES } = require('./smartbus-protocol');
          const payloadData = encodeChannelControl(updated.channel, updated.level);
          this.sendSmartBusUDP({
            srcSubnet: 1,
            srcDevice: 254,
            srcType: DEVICE_TYPES.MOBILE_APP,
            opcode: OPCODES.SINGLE_CHANNEL_CONTROL,
            targetSubnet: updated.subnet,
            targetDevice: updated.deviceId,
            data: payloadData
          });

          if (this.broadcastWS) this.broadcastWS({ type: 'DEVICE_UPDATED', device: updated });
          this.publishDeviceState(updated);
        }
        return Boolean(updated);
      }

      case 'TRIGGER_SCENE': {
        const success = this.deviceManager.triggerScene(job.targetId);
        if (success && this.sendSmartBusUDP) {
          const scene = this.deviceManager.scenes[job.targetId];
          if (scene) {
            const { encodeSceneControl, OPCODES } = require('./smartbus-protocol');
            const payloadData = encodeSceneControl(scene.area, scene.sceneId);
            this.sendSmartBusUDP({
              srcSubnet: 1,
              srcDevice: 254,
              opcode: OPCODES.SCENE_CONTROL,
              targetSubnet: scene.subnet,
              targetDevice: 255,
              data: payloadData
            });
          }
          if (this.broadcastWS) this.broadcastWS({ type: 'SNAPSHOT_UPDATED', snapshot: this.deviceManager.getSnapshot() });
        }
        return success;
      }

      case 'CONTROL_ZAUDIO': {
        if (!this.zaudio) return false;
        const { zoneId, action, value } = job.payload;
        if (action === 'volume') await this.zaudio.setVolume(zoneId, value);
        else if (action === 'power') await this.zaudio.setPower(zoneId, value);
        else if (action === 'mute') await this.zaudio.toggleMute(zoneId);
        else if (action === 'source') await this.zaudio.setSource(zoneId, value);
        else if (action === 'playback') await this.zaudio.controlPlayback(zoneId, value);
        else if (action === 'eq') await this.zaudio.setEqualizer(zoneId, value);

        if (this.broadcastWS) this.broadcastWS({ type: 'ZAUDIO_UPDATED', zaudio: this.zaudio.getAllStates() });
        this.publishZAudioState(zoneId);
        return true;
      }

      case 'CONTROL_HVAC': {
        const updated = this.deviceManager.updateHVAC(job.targetId, job.payload);
        if (updated && this.sendSmartBusUDP) {
          const { encodeHVACControl, OPCODES } = require('./smartbus-protocol');
          const payloadData = encodeHVACControl(
            updated.targetTemp,
            updated.mode === 'cool' ? 0 : 1,
            updated.fanSpeed === 'high' ? 1 : 0,
            updated.power
          );
          this.sendSmartBusUDP({
            srcSubnet: 1,
            srcDevice: 254,
            opcode: OPCODES.HVAC_CONTROL,
            targetSubnet: updated.subnet,
            targetDevice: updated.deviceId,
            data: payloadData
          });
          if (this.broadcastWS) this.broadcastWS({ type: 'HVAC_UPDATED', hvac: updated });
          this.publishHVACState(updated);
        }
        return Boolean(updated);
      }

      case 'CONTROL_CURTAIN': {
        const updated = this.deviceManager.updateCurtain(job.targetId, job.payload.position);
        if (updated) {
          if (this.sendSmartBusUDP) {
            const { OPCODES } = require('./smartbus-protocol');
            this.sendSmartBusUDP({
              srcSubnet: 1,
              srcDevice: 254,
              opcode: OPCODES.CURTAIN_CONTROL,
              targetSubnet: updated.subnet || 1,
              targetDevice: updated.deviceId || 1,
              data: [updated.channel || 1, updated.position]
            });
          }
          if (this.broadcastWS) {
            this.broadcastWS({ type: 'CURTAIN_UPDATED', curtain: updated });
          }
          this.publishCurtainState(updated);
        }
        return Boolean(updated);
      }

      case 'RAW_UDP': {
        if (this.sendSmartBusUDP && job.rawData) {
          this.sendSmartBusUDP(job.rawData);
          return true;
        }
        return false;
      }

      default:
        return true;
    }
  }

  purgeQueue() {
    this.queues.HIGH = [];
    this.queues.NORMAL = [];
    this.queues.LOW = [];
    this.activeJob = null;
    this.logMQTT('[Queue] Command queue purged by user.');
    this.notifyQueueUpdate();
    this.publishMQTTQueueStatus();
  }

  setPaused(paused) {
    this.isPaused = Boolean(paused);
    this.logMQTT(`[Queue] Worker state set to ${this.isPaused ? 'PAUSED' : 'RESUMED'}`);
    this.notifyQueueUpdate();
  }

  setInterCommandDelay(delayMs) {
    this.interCommandDelay = Math.max(10, Math.min(5000, parseInt(delayMs) || 100));
    this.notifyQueueUpdate();
  }

  // -------------------------------------------------------------------
  // MQTT CLIENT & TOPIC MANAGER
  // -------------------------------------------------------------------

  connectMQTT() {
    if (!mqtt) return;

    if (this.mqttClient) {
      try { this.mqttClient.end(true); } catch (e) {}
    }

    this.mqttStatus = 'connecting';
    this.logMQTT(`[MQTT] Connecting to broker at ${this.mqttConfig.brokerUrl}...`);

    try {
      this.mqttClient = mqtt.connect(this.mqttConfig.brokerUrl, {
        clientId: this.mqttConfig.clientId,
        username: this.mqttConfig.username || undefined,
        password: this.mqttConfig.password || undefined,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        will: {
          topic: `${this.mqttConfig.topicPrefix}/status`,
          payload: 'offline',
          retain: true,
          qos: 1
        }
      });

      this.mqttClient.on('connect', () => {
        this.mqttStatus = 'connected';
        this.logMQTT(`[MQTT] Connected to broker successfully.`);
        this.notifyQueueUpdate();

        // Subscribe to All Command Topics
        const prefix = this.mqttConfig.topicPrefix;
        this.mqttClient.subscribe([
          `${prefix}/cmd/#`
        ], (err) => {
          if (err) console.warn('[MQTT] Subscription error:', err.message);
          else this.logMQTT(`[MQTT] Subscribed to ${prefix}/cmd/# topics.`);
        });

        // Publish Online Status, Discovery & Initial States
        this.publishMQTT(`${prefix}/status`, 'online', true);

        if (this.mqttConfig.haDiscovery) {
          this.publishHomeAssistantDiscovery();
        }
        this.publishAllStates();
      });

      this.mqttClient.on('message', (topic, message) => {
        this.handleMQTTMessage(topic, message.toString());
      });

      this.mqttClient.on('error', (err) => {
        this.mqttStatus = 'error';
        this.logMQTT(`[MQTT] Connection error: ${err.message}`);
        this.notifyQueueUpdate();
      });

      this.mqttClient.on('offline', () => {
        this.mqttStatus = 'disconnected';
        this.logMQTT(`[MQTT] Broker client offline.`);
        this.notifyQueueUpdate();
      });

    } catch (err) {
      this.mqttStatus = 'error';
      this.logMQTT(`[MQTT] Client init exception: ${err.message}`);
    }
  }

  handleMQTTMessage(topic, payloadStr) {
    this.logMQTT(`[MQTT RX] ${topic} -> ${payloadStr}`);
    const prefix = this.mqttConfig.topicPrefix;
    const parts = topic.split('/');

    let payloadObj = {};
    try { payloadObj = JSON.parse(payloadStr); } catch (e) { payloadObj = { raw: payloadStr }; }

    // 1. Device Controls: smartbus/cmd/device/:id/:subAction
    if (topic.startsWith(`${prefix}/cmd/device/`)) {
      const deviceId = parts[3];
      const subAction = parts[4] || 'set';

      let updates = {};

      if (subAction === 'brightness') {
        const bri = parseInt(payloadStr);
        if (!isNaN(bri)) {
          const lvl = Math.max(0, Math.min(100, bri));
          updates = { level: lvl, power: lvl > 0 };
        }
      } else if (subAction === 'speed') {
        const pct = parseInt(payloadStr);
        if (!isNaN(pct)) {
          const speed = pct === 0 ? 0 : Math.max(1, Math.min(5, Math.ceil((pct / 100) * 5)));
          updates = { level: speed, power: speed > 0 };
        }
      } else if (subAction === 'rgb') {
        updates = { color: payloadStr.trim() };
      } else {
        // standard 'set' topic
        if (typeof payloadObj === 'object' && (payloadObj.power !== undefined || payloadObj.level !== undefined)) {
          updates = payloadObj;
        } else {
          const valUpper = String(payloadStr).toUpperCase().trim();
          if (valUpper === 'ON' || valUpper === 'TRUE' || valUpper === '1') updates = { power: true };
          else if (valUpper === 'OFF' || valUpper === 'FALSE' || valUpper === '0') updates = { power: false };
          else if (!isNaN(parseInt(valUpper))) {
            const num = parseInt(valUpper);
            updates = { level: num, power: num > 0 };
          }
        }
      }

      this.enqueue({
        type: 'CONTROL_DEVICE',
        targetId: deviceId,
        payload: updates,
        priority: payloadObj.priority || 'NORMAL',
        source: 'MQTT'
      });

    // 2. HVAC Controls: smartbus/cmd/hvac/:id/:subAction
    } else if (topic.startsWith(`${prefix}/cmd/hvac/`)) {
      const hvacId = parts[3];
      const subAction = parts[4] || 'set';

      const updates = {};
      if (subAction === 'mode') {
        const mode = payloadStr.toLowerCase().trim();
        if (mode === 'off') {
          updates.power = false;
        } else {
          updates.power = true;
          updates.mode = mode;
        }
      } else if (subAction === 'target_temp') {
        const temp = parseFloat(payloadStr);
        if (!isNaN(temp)) updates.targetTemp = temp;
      } else if (subAction === 'fan_speed') {
        updates.fanSpeed = payloadStr.toLowerCase().trim();
      } else if (subAction === 'power') {
        updates.power = payloadStr.toUpperCase().trim() === 'ON';
      } else {
        Object.assign(updates, typeof payloadObj === 'object' ? payloadObj : {});
      }

      this.enqueue({
        type: 'CONTROL_HVAC',
        targetId: hvacId,
        payload: updates,
        priority: 'NORMAL',
        source: 'MQTT'
      });

    // 3. Curtain Controls: smartbus/cmd/curtain/:id/:subAction
    } else if (topic.startsWith(`${prefix}/cmd/curtain/`)) {
      const curtainId = parts[3];
      const subAction = parts[4] || 'set';

      let position = 50;
      if (subAction === 'position') {
        position = Math.max(0, Math.min(100, parseInt(payloadStr) || 0));
      } else {
        const cmd = String(payloadStr).toUpperCase().trim();
        if (cmd === 'OPEN') position = 100;
        else if (cmd === 'CLOSE') position = 0;
        else if (cmd === 'STOP') position = 50;
        else if (!isNaN(parseInt(cmd))) position = parseInt(cmd);
      }

      this.enqueue({
        type: 'CONTROL_CURTAIN',
        targetId: curtainId,
        payload: { position },
        priority: 'NORMAL',
        source: 'MQTT'
      });

    // 4. Scene Controls: smartbus/cmd/scene/:id/trigger
    } else if (topic.startsWith(`${prefix}/cmd/scene/`)) {
      const sceneId = parts[3];
      this.enqueue({
        type: 'TRIGGER_SCENE',
        targetId: sceneId,
        priority: 'HIGH',
        source: 'MQTT'
      });

    // 5. Z-Audio Controls: smartbus/cmd/zaudio/:zoneId/set
    } else if (topic.startsWith(`${prefix}/cmd/zaudio/`)) {
      const zoneId = parseInt(parts[3]) || 1;
      this.enqueue({
        type: 'CONTROL_ZAUDIO',
        targetId: zoneId,
        payload: { zoneId, action: payloadObj.action || 'volume', value: payloadObj.value },
        priority: 'NORMAL',
        source: 'MQTT'
      });

    // 6. Generic Enqueue Queue
    } else if (topic === `${prefix}/cmd/queue/enqueue`) {
      if (payloadObj.type) {
        this.enqueue(payloadObj);
      }
    }
  }

  // -------------------------------------------------------------------
  // STATE PUBLISHING & HOME ASSISTANT DISCOVERY
  // -------------------------------------------------------------------

  publishMQTT(topic, payload, retain = false) {
    if (!this.mqttClient || this.mqttStatus !== 'connected') return;
    const body = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
    this.mqttClient.publish(topic, body, { retain, qos: 0 });
  }

  hexToRgb(hex) {
    if (!hex) return '255,255,255';
    const c = String(hex).replace('#', '');
    if (c.length === 6) {
      const r = parseInt(c.substring(0, 2), 16) || 255;
      const g = parseInt(c.substring(2, 4), 16) || 255;
      const b = parseInt(c.substring(4, 6), 16) || 255;
      return `${r},${g},${b}`;
    }
    return '255,255,255';
  }

  publishAllStates() {
    if (!this.deviceManager) return;
    const snapshot = this.deviceManager.getSnapshot();

    // Publish bridge availability status
    this.publishMQTT(`${this.mqttConfig.topicPrefix}/status`, 'online', true);

    (snapshot.devices || []).forEach(dev => this.publishDeviceState(dev));
    (snapshot.hvac || []).forEach(hvac => this.publishHVACState(hvac));
    (snapshot.curtains || []).forEach(curtain => this.publishCurtainState(curtain));

    if (this.zaudio) {
      Object.keys(this.zaudio.zones).forEach(zId => this.publishZAudioState(zId));
    }
  }

  publishDeviceState(dev) {
    const prefix = this.mqttConfig.topicPrefix;
    const topic = `${prefix}/device/${dev.id}/state`;
    this.publishMQTT(topic, {
      id: dev.id,
      name: dev.name,
      room: dev.room,
      type: dev.type,
      power: dev.power ? 'ON' : 'OFF',
      level: dev.level,
      speedName: dev.speedName,
      color: dev.color || '#ffffff',
      rgb: dev.color ? this.hexToRgb(dev.color) : '255,255,255',
      updatedAt: new Date().toISOString()
    }, true);
  }

  publishCurtainState(curtain) {
    const prefix = this.mqttConfig.topicPrefix;
    const topic = `${prefix}/curtain/${curtain.id}/state`;
    this.publishMQTT(topic, {
      id: curtain.id,
      name: curtain.name,
      room: curtain.room,
      position: curtain.position,
      state: curtain.position === 0 ? 'closed' : 'open',
      updatedAt: new Date().toISOString()
    }, true);
  }

  publishZAudioState(zoneId) {
    if (!this.zaudio) return;
    const zoneState = this.zaudio.getZoneState(zoneId);
    if (!zoneState) return;
    const prefix = this.mqttConfig.topicPrefix;
    this.publishMQTT(`${prefix}/zaudio/${zoneId}/state`, {
      zoneId,
      power: zoneState.power ? 'ON' : 'OFF',
      volume: zoneState.volume,
      mute: zoneState.mute,
      source: zoneState.source,
      sourceName: zoneState.sourceName,
      eq: zoneState.eq,
      updatedAt: new Date().toISOString()
    }, true);
  }

  publishHVACState(hvac) {
    const prefix = this.mqttConfig.topicPrefix;
    this.publishMQTT(`${prefix}/hvac/${hvac.id}/state`, {
      id: hvac.id,
      name: hvac.name,
      room: hvac.room,
      power: hvac.power ? 'ON' : 'OFF',
      targetTemp: hvac.targetTemp,
      currentTemp: hvac.currentTemp,
      mode: hvac.mode,
      fanSpeed: hvac.fanSpeed,
      updatedAt: new Date().toISOString()
    }, true);
  }

  publishMQTTQueueStatus() {
    const prefix = this.mqttConfig.topicPrefix;
    this.publishMQTT(`${prefix}/queue/status`, this.getQueueStatus(), false);
  }

  /**
   * Home Assistant MQTT Auto-Discovery Config Generator
   * Automatically discovers:
   * - SmartBus Lights (Dimmers & RGB Accent lights)
   * - SmartBus Switches (Relays, Appliances, Geysers, Outlets)
   * - SmartBus Fans (3-Speed ceiling fans with percentage/speed control)
   * - SmartBus Climate / HVAC (Air Conditioning thermostats with temp & modes)
   * - SmartBus Curtains / Covers (Motorized curtains with position)
   * - SmartBus Scenes (One-touch macros)
   */
  /**
   * Formats a clean, human-readable name without repeating room names
   * E.g. room: "Kitchen", name: "Spot 1" -> "Kitchen Spot 1"
   * E.g. room: "Kitchen", name: "Kitchen Fan" -> "Kitchen Fan" (NOT "Kitchen Kitchen Fan")
   */
  getCleanDeviceName(item) {
    if (!item) return 'SmartBus Device';
    const room = (item.room || '').trim();
    const rawName = (item.name || '').trim();
    if (!room) return rawName || 'SmartBus Device';
    if (!rawName) return room;

    // If rawName already starts with room name (case-insensitive), retain rawName
    if (rawName.toLowerCase().startsWith(room.toLowerCase())) {
      return rawName;
    }
    return `${room} ${rawName}`;
  }

  /**
   * Home Assistant MQTT Auto-Discovery Config Generator
   * Retains exact human-readable device and room names with zero distortion.
   * Discovers:
   * - SmartBus Lights (Dimmers, RGB accents, and Relay-controlled lighting)
   * - SmartBus Switches (Appliances, Sockets, Geysers, Exhaust Fans)
   * - SmartBus Fans (3-Speed ceiling fans with percentage/speed control)
   * - SmartBus Climate / HVAC (Air Conditioning thermostats with temp & modes)
   * - SmartBus Curtains / Covers (Motorized curtains with position)
   * - SmartBus Scenes (One-touch macros)
   */
  publishHomeAssistantDiscovery() {
    if (!this.deviceManager) return;
    const haPrefix = this.mqttConfig.haPrefix;
    const prefix = this.mqttConfig.topicPrefix;
    const availTopic = `${prefix}/status`;

    const snapshot = this.deviceManager.getSnapshot();
    let publishedCount = 0;

    // 1. Devices (Relays, Dimmers, Fans, RGB lights)
    (snapshot.devices || []).forEach(dev => {
      const cleanName = this.getCleanDeviceName(dev);
      const commonDevice = {
        identifiers: [`smartbus_eq_${dev.id}`],
        name: cleanName,
        manufacturer: 'SmartBus G4 / HDL Buspro',
        model: `${dev.type.charAt(0).toUpperCase() + dev.type.slice(1)} (Ch ${dev.channel}, Sub ${dev.subnet} Dev ${dev.deviceId})`,
        suggested_area: dev.room || undefined
      };

      if (dev.type === 'dimmer') {
        // Clear any old switch discovery topic for this device
        this.publishMQTT(`${haPrefix}/switch/${dev.id}/config`, '', true);

        const payload = {
          name: cleanName,
          unique_id: `smartbus_${dev.id}`,
          state_topic: `${prefix}/device/${dev.id}/state`,
          command_topic: `${prefix}/cmd/device/${dev.id}/set`,
          state_value_template: '{{ value_json.power }}',
          payload_on: 'ON',
          payload_off: 'OFF',
          brightness_state_topic: `${prefix}/device/${dev.id}/state`,
          brightness_command_topic: `${prefix}/cmd/device/${dev.id}/brightness`,
          brightness_value_template: '{{ value_json.level }}',
          brightness_scale: 100,
          on_command_type: 'brightness',
          availability_topic: availTopic,
          payload_available: 'online',
          payload_not_available: 'offline',
          device: commonDevice
        };
        this.publishMQTT(`${haPrefix}/light/${dev.id}/config`, payload, true);
        publishedCount++;

      } else if (dev.type === 'rgb') {
        // Clear any old switch discovery topic for this device
        this.publishMQTT(`${haPrefix}/switch/${dev.id}/config`, '', true);

        const payload = {
          name: cleanName,
          unique_id: `smartbus_${dev.id}`,
          state_topic: `${prefix}/device/${dev.id}/state`,
          command_topic: `${prefix}/cmd/device/${dev.id}/set`,
          state_value_template: '{{ value_json.power }}',
          payload_on: 'ON',
          payload_off: 'OFF',
          brightness_state_topic: `${prefix}/device/${dev.id}/state`,
          brightness_command_topic: `${prefix}/cmd/device/${dev.id}/brightness`,
          brightness_value_template: '{{ value_json.level }}',
          brightness_scale: 100,
          rgb_state_topic: `${prefix}/device/${dev.id}/state`,
          rgb_command_topic: `${prefix}/cmd/device/${dev.id}/rgb`,
          rgb_value_template: '{{ value_json.rgb }}',
          availability_topic: availTopic,
          payload_available: 'online',
          payload_not_available: 'offline',
          device: commonDevice
        };
        this.publishMQTT(`${haPrefix}/light/${dev.id}/config`, payload, true);
        publishedCount++;

      } else if (dev.type === 'fan') {
        const payload = {
          name: cleanName,
          unique_id: `smartbus_${dev.id}`,
          state_topic: `${prefix}/device/${dev.id}/state`,
          command_topic: `${prefix}/cmd/device/${dev.id}/set`,
          state_value_template: '{{ value_json.power }}',
          payload_on: 'ON',
          payload_off: 'OFF',
          percentage_state_topic: `${prefix}/device/${dev.id}/state`,
          percentage_command_topic: `${prefix}/cmd/device/${dev.id}/speed`,
          percentage_value_template: '{{ (value_json.level / 5 * 100) | round | int }}',
          speed_range_min: 1,
          speed_range_max: 5,
          availability_topic: availTopic,
          payload_available: 'online',
          payload_not_available: 'offline',
          device: commonDevice
        };
        this.publishMQTT(`${haPrefix}/fan/${dev.id}/config`, payload, true);
        publishedCount++;

      } else {
        // Standard Relay: Determine if it controls lighting or an appliance/socket
        const isLight = /spot|light|lamp|chandelier|celing|ceiling|downlight|bulb|led|showcase|dry area|entrance|shower|track/i.test(cleanName);
        const component = isLight ? 'light' : 'switch';
        const altComponent = isLight ? 'switch' : 'light';

        // Clear stale opposing component topic in broker
        this.publishMQTT(`${haPrefix}/${altComponent}/${dev.id}/config`, '', true);

        const payload = {
          name: cleanName,
          unique_id: `smartbus_${dev.id}`,
          state_topic: `${prefix}/device/${dev.id}/state`,
          command_topic: `${prefix}/cmd/device/${dev.id}/set`,
          value_template: '{{ value_json.power }}',
          state_value_template: '{{ value_json.power }}',
          payload_on: 'ON',
          payload_off: 'OFF',
          availability_topic: availTopic,
          payload_available: 'online',
          payload_not_available: 'offline',
          device: commonDevice
        };

        if (/socket|plug|power/i.test(cleanName)) {
          payload.device_class = 'outlet';
        } else if (/geyser|heater|water/i.test(cleanName)) {
          payload.icon = 'mdi:water-boiler';
        } else if (/washing|dishwasher/i.test(cleanName)) {
          payload.icon = 'mdi:washing-machine';
        } else if (/exaust|exhaust/i.test(cleanName)) {
          payload.icon = 'mdi:fan';
        }

        this.publishMQTT(`${haPrefix}/${component}/${dev.id}/config`, payload, true);
        publishedCount++;
      }
    });

    // 2. Climate / HVAC
    (snapshot.hvac || []).forEach(hvac => {
      const cleanName = this.getCleanDeviceName(hvac);
      const payload = {
        name: cleanName,
        unique_id: `smartbus_hvac_${hvac.id}`,
        mode_command_topic: `${prefix}/cmd/hvac/${hvac.id}/mode`,
        mode_state_topic: `${prefix}/hvac/${hvac.id}/state`,
        mode_state_template: '{{ value_json.mode if value_json.power == "ON" else "off" }}',
        modes: ['off', 'cool', 'heat', 'fan_only', 'dry', 'auto'],
        power_command_topic: `${prefix}/cmd/hvac/${hvac.id}/power`,
        temperature_command_topic: `${prefix}/cmd/hvac/${hvac.id}/target_temp`,
        temperature_state_topic: `${prefix}/hvac/${hvac.id}/state`,
        temperature_state_template: '{{ value_json.targetTemp }}',
        current_temperature_topic: `${prefix}/hvac/${hvac.id}/state`,
        current_temperature_template: '{{ value_json.currentTemp }}',
        fan_mode_command_topic: `${prefix}/cmd/hvac/${hvac.id}/fan_speed`,
        fan_mode_state_topic: `${prefix}/hvac/${hvac.id}/state`,
        fan_mode_state_template: '{{ value_json.fanSpeed }}',
        fan_modes: ['low', 'medium', 'high', 'auto'],
        min_temp: 16,
        max_temp: 30,
        temp_step: 1,
        temperature_unit: 'C',
        availability_topic: availTopic,
        payload_available: 'online',
        payload_not_available: 'offline',
        device: {
          identifiers: [`smartbus_hvac_${hvac.id}`],
          name: cleanName,
          manufacturer: 'SmartBus G4 / HDL Buspro',
          model: 'Air Conditioner (HVAC)',
          suggested_area: hvac.room || undefined
        }
      };
      this.publishMQTT(`${haPrefix}/climate/${hvac.id}/config`, payload, true);
      publishedCount++;
    });

    // 3. Motorized Curtains / Covers
    (snapshot.curtains || []).forEach(curtain => {
      const cleanName = this.getCleanDeviceName(curtain);
      const payload = {
        name: cleanName,
        unique_id: `smartbus_curtain_${curtain.id}`,
        command_topic: `${prefix}/cmd/curtain/${curtain.id}/set`,
        state_topic: `${prefix}/curtain/${curtain.id}/state`,
        position_topic: `${prefix}/curtain/${curtain.id}/state`,
        set_position_topic: `${prefix}/cmd/curtain/${curtain.id}/position`,
        position_template: '{{ value_json.position }}',
        device_class: 'curtain',
        payload_open: 'OPEN',
        payload_close: 'CLOSE',
        payload_stop: 'STOP',
        state_open: 'open',
        state_closed: 'closed',
        availability_topic: availTopic,
        payload_available: 'online',
        payload_not_available: 'offline',
        device: {
          identifiers: [`smartbus_curtain_${curtain.id}`],
          name: cleanName,
          manufacturer: 'SmartBus G4 / HDL Buspro',
          model: 'Motorized Curtain Controller',
          suggested_area: curtain.room || undefined
        }
      };
      this.publishMQTT(`${haPrefix}/cover/${curtain.id}/config`, payload, true);
      publishedCount++;
    });

    // 4. Automation Scenes
    (snapshot.scenes || []).forEach(scene => {
      const payload = {
        name: scene.name || `Scene ${scene.sceneId}`,
        unique_id: `smartbus_scene_${scene.id}`,
        command_topic: `${prefix}/cmd/scene/${scene.id}/trigger`,
        payload_on: 'ON',
        availability_topic: availTopic,
        payload_available: 'online',
        payload_not_available: 'offline',
        device: {
          identifiers: ['smartbus_scenes_controller'],
          name: 'SmartBus Scenes Engine',
          manufacturer: 'SmartBus G4 / HDL Buspro',
          model: 'Macro & Scene Controller'
        }
      };
      this.publishMQTT(`${haPrefix}/scene/${scene.id}/config`, payload, true);
      publishedCount++;
    });

    this.logMQTT(`[MQTT] Published Home Assistant MQTT Auto-Discovery for ${publishedCount} entities with preserved clean names.`);
  }

  // -------------------------------------------------------------------
  // HELPER METRICS & STATUS ENDPOINTS
  // -------------------------------------------------------------------

  getQueueStatus() {
    const queueLength = this.queues.HIGH.length + this.queues.NORMAL.length + this.queues.LOW.length;
    return {
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      interCommandDelay: this.interCommandDelay,
      queueLength,
      queuesBreakdown: {
        HIGH: this.queues.HIGH.length,
        NORMAL: this.queues.NORMAL.length,
        LOW: this.queues.LOW.length
      },
      activeJob: this.activeJob,
      stats: this.stats,
      mqtt: {
        status: this.mqttStatus,
        brokerUrl: this.mqttConfig.brokerUrl,
        clientId: this.mqttConfig.clientId,
        topicPrefix: this.mqttConfig.topicPrefix,
        haDiscovery: this.mqttConfig.haDiscovery
      },
      recentJobs: this.recentJobs.slice(0, 15),
      recentLogs: this.mqttLogs.slice(0, 30)
    };
  }

  updateConfig(newConfig = {}) {
    if (newConfig.brokerUrl !== undefined) this.mqttConfig.brokerUrl = newConfig.brokerUrl;
    if (newConfig.clientId !== undefined) this.mqttConfig.clientId = newConfig.clientId;
    if (newConfig.username !== undefined) this.mqttConfig.username = newConfig.username;
    if (newConfig.password !== undefined) this.mqttConfig.password = newConfig.password;
    if (newConfig.topicPrefix !== undefined) this.mqttConfig.topicPrefix = newConfig.topicPrefix;
    if (newConfig.haDiscovery !== undefined) this.mqttConfig.haDiscovery = Boolean(newConfig.haDiscovery);
    if (newConfig.interCommandDelay !== undefined) this.interCommandDelay = parseInt(newConfig.interCommandDelay) || 100;

    this.connectMQTT();
    this.notifyQueueUpdate();
  }

  logMQTT(message) {
    const logItem = {
      timestamp: new Date().toLocaleTimeString(),
      message
    };
    this.mqttLogs.unshift(logItem);
    if (this.mqttLogs.length > 100) this.mqttLogs.pop();
    this.emit('log', logItem);
  }

  notifyQueueUpdate() {
    if (this.broadcastWS) {
      this.broadcastWS({
        type: 'QUEUE_STATUS',
        status: this.getQueueStatus()
      });
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new MQTTQueueService();
