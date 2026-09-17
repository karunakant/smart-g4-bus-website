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
        if (updated && this.broadcastWS) {
          this.broadcastWS({ type: 'CURTAIN_UPDATED', curtain: updated });
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
        connectTimeout: 10000
      });

      this.mqttClient.on('connect', () => {
        this.mqttStatus = 'connected';
        this.logMQTT(`[MQTT] Connected to broker successfully.`);
        this.notifyQueueUpdate();

        // Subscribe to Command Topics
        const prefix = this.mqttConfig.topicPrefix;
        this.mqttClient.subscribe([
          `${prefix}/cmd/device/+/set`,
          `${prefix}/cmd/scene/+/trigger`,
          `${prefix}/cmd/zaudio/+/set`,
          `${prefix}/cmd/hvac/+/set`,
          `${prefix}/cmd/queue/enqueue`,
          `${prefix}/cmd/raw`
        ], (err) => {
          if (err) console.warn('[MQTT] Subscription error:', err.message);
          else this.logMQTT(`[MQTT] Subscribed to ${prefix}/cmd/# topics.`);
        });

        // Publish Initial Auto-Discovery & System States
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

    let payloadObj = {};
    try { payloadObj = JSON.parse(payloadStr); } catch (e) { payloadObj = { raw: payloadStr }; }

    if (topic.startsWith(`${prefix}/cmd/device/`)) {
      const parts = topic.split('/');
      const deviceId = parts[3];

      let updates = {};
      if (typeof payloadObj === 'object' && (payloadObj.power !== undefined || payloadObj.level !== undefined)) {
        updates = payloadObj;
      } else {
        const valUpper = String(payloadStr).toUpperCase().trim();
        if (valUpper === 'ON' || valUpper === 'TRUE' || valUpper === '1') updates = { power: true };
        else if (valUpper === 'OFF' || valUpper === 'FALSE' || valUpper === '0') updates = { power: false };
        else if (!isNaN(parseInt(valUpper))) updates = { level: parseInt(valUpper) };
      }

      this.enqueue({
        type: 'CONTROL_DEVICE',
        targetId: deviceId,
        payload: updates,
        priority: payloadObj.priority || 'NORMAL',
        source: 'MQTT'
      });

    } else if (topic.startsWith(`${prefix}/cmd/scene/`)) {
      const sceneId = topic.split('/')[3];
      this.enqueue({
        type: 'TRIGGER_SCENE',
        targetId: sceneId,
        priority: 'HIGH',
        source: 'MQTT'
      });

    } else if (topic.startsWith(`${prefix}/cmd/zaudio/`)) {
      const zoneId = parseInt(topic.split('/')[3]) || 1;
      this.enqueue({
        type: 'CONTROL_ZAUDIO',
        targetId: zoneId,
        payload: { zoneId, action: payloadObj.action || 'volume', value: payloadObj.value },
        priority: 'NORMAL',
        source: 'MQTT'
      });

    } else if (topic.startsWith(`${prefix}/cmd/hvac/`)) {
      const hvacId = topic.split('/')[3];
      this.enqueue({
        type: 'CONTROL_HVAC',
        targetId: hvacId,
        payload: payloadObj,
        priority: 'NORMAL',
        source: 'MQTT'
      });

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

  publishAllStates() {
    if (!this.deviceManager) return;
    const snapshot = this.deviceManager.getSnapshot();

    snapshot.devices.forEach(dev => this.publishDeviceState(dev));
    snapshot.hvac.forEach(hvac => this.publishHVACState(hvac));

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
      fanSpeed: hvac.fanSpeed
    }, true);
  }

  publishMQTTQueueStatus() {
    const prefix = this.mqttConfig.topicPrefix;
    this.publishMQTT(`${prefix}/queue/status`, this.getQueueStatus(), false);
  }

  /**
   * Home Assistant MQTT Auto-Discovery Config Generator
   */
  publishHomeAssistantDiscovery() {
    if (!this.deviceManager) return;
    const haPrefix = this.mqttConfig.haPrefix;
    const prefix = this.mqttConfig.topicPrefix;

    const snapshot = this.deviceManager.getSnapshot();

    snapshot.devices.forEach(dev => {
      let component = 'switch';
      let payload = {
        name: dev.name,
        unique_id: `smartbus_${dev.id}`,
        state_topic: `${prefix}/device/${dev.id}/state`,
        command_topic: `${prefix}/cmd/device/${dev.id}/set`,
        value_template: '{{ value_json.power }}',
        device: {
          identifiers: [`smartbus_${dev.subnet}_${dev.deviceId}`],
          name: `SmartBus Module (Sub:${dev.subnet} Dev:${dev.deviceId})`,
          manufacturer: 'SmartBus G4 / HDL',
          model: dev.type === 'fan' ? 'Fan Speed Module' : 'Relay / Dimmer Module'
        }
      };

      if (dev.type === 'dimmer') {
        component = 'light';
        payload.brightness_state_topic = `${prefix}/device/${dev.id}/state`;
        payload.brightness_command_topic = `${prefix}/cmd/device/${dev.id}/set`;
        payload.brightness_value_template = '{{ value_json.level }}';
        payload.on_command_type = 'brightness';
      } else if (dev.type === 'fan') {
        component = 'fan';
        payload.percentage_state_topic = `${prefix}/device/${dev.id}/state`;
        payload.percentage_command_topic = `${prefix}/cmd/device/${dev.id}/set`;
        payload.percentage_value_template = '{{ (value_json.level / 5 * 100) | int }}';
      }

      this.publishMQTT(`${haPrefix}/${component}/${dev.id}/config`, payload, true);
    });

    this.logMQTT(`[MQTT] Published Home Assistant MQTT Discovery for ${snapshot.devices.length} devices.`);
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
