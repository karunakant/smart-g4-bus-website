/**
 * Z-Audio Multi-Zone Controller Driver (IP: 192.168.0.200)
 *
 * Interfacing driver for HDL SmartBus Z-Audio Multi-Zone Controller over S-Bus gateway.
 * Handles volume control, playback transport, audio source switching, EQ presets,
 * zone state tracking, and network connectivity checks.
 */

const dgram = require('dgram');
const { OPCODES, encodePacket } = require('./smartbus-protocol');

class ZAudioController {
  /**
   * @param {Object} config
   * @param {string} [config.ip='192.168.0.200'] Target SmartBus IP Gateway address
   * @param {number} [config.port=6000] Target UDP port
   * @param {number} [config.subnet=1] SmartBus Subnet ID
   * @param {number} [config.deviceId=50] SmartBus Device ID for Z-Audio
   * @param {boolean} [config.simulationMode=true] Enable simulator if unreachable
   */
  constructor(config = {}) {
    this.ip = config.ip || '192.168.0.200';
    this.port = config.port || 6000;
    this.subnet = config.subnet || 1;
    this.deviceId = config.deviceId || 50;
    this.simulationMode = config.simulationMode !== undefined ? config.simulationMode : false;
    this.enabled = config.enabled !== undefined ? config.enabled : false;

    // Default internal state for Z-Audio Zones (All zones default to powered OFF / Standby)
    this.zones = {
      1: {
        id: 1,
        name: 'Main Living Room',
        power: false,
        volume: 0,
        muted: true,
        source: 2,
        sourceName: 'AUX / Line-In',
        playbackState: 'stopped',
        currentTrack: 'System Standby / Closed',
        artist: 'Z-Audio Closed',
        eq: 'Normal'
      },
      2: {
        id: 2,
        name: 'Master Bedroom',
        power: false,
        volume: 0,
        muted: true,
        source: 2,
        sourceName: 'AUX / Line-In',
        playbackState: 'stopped',
        currentTrack: 'System Standby / Closed',
        artist: 'Z-Audio Closed',
        eq: 'Normal'
      },
      3: {
        id: 3,
        name: 'Garden Terrace',
        power: false,
        volume: 0,
        muted: true,
        source: 2,
        sourceName: 'AUX / Line-In',
        playbackState: 'stopped',
        currentTrack: 'System Standby / Closed',
        artist: 'Z-Audio Closed',
        eq: 'Normal'
      },
      4: {
        id: 4,
        name: 'Dining Area',
        power: false,
        volume: 0,
        muted: true,
        source: 2,
        sourceName: 'AUX / Line-In',
        playbackState: 'stopped',
        currentTrack: 'System Standby / Closed',
        artist: 'Z-Audio Closed',
        eq: 'Normal'
      }
    };

    this.sources = {
      1: 'SD Card',
      2: 'AUX / Line-In',
      3: 'Bluetooth',
      4: 'Web Radio',
      5: 'NAS / Network Server'
    };

    this.isOnline = false;
    this.socket = null;
    this.initSocket();
  }

  initSocket() {
    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket.on('error', (err) => {
        console.warn(`[Z-Audio] UDP Socket warning (${this.ip}):`, err.message);
      });
    } catch (e) {
      console.warn('[Z-Audio] Socket initialization error:', e.message);
    }
  }

  /**
   * Transmits command to Z-Audio module via UDP binary SmartBus packet & ASCII fallback.
   */
  async sendCommand(commandString, rawData = []) {
    if (!this.enabled) {
      console.log(`[Z-Audio] Disabled / Closed. Command bypassed: ${commandString}`);
      return false;
    }
    const payload = Buffer.from(commandString + '\r\n', 'ascii');
    
    // 1. Send as SmartBus Binary Packet (Opcode 0x192E)
    const packet = encodePacket({
      srcSubnet: 1,
      srcDevice: 254,
      opcode: OPCODES.ZAUDIO_CONTROL,
      targetSubnet: this.subnet,
      targetDevice: this.deviceId,
      data: payload
    });

    if (this.socket) {
      const targets = [this.ip, '192.168.0.200', '192.168.0.255'];
      const uniqueTargets = [...new Set(targets)];

      uniqueTargets.forEach(targetIp => {
        this.socket.send(packet, 0, packet.length, this.port, targetIp, (err) => {
          if (!err) {
            this.isOnline = true;
          }
        });

        // Send direct ASCII payload for Z-Audio modules accepting direct UDP text
        this.socket.send(payload, 0, payload.length, this.port, targetIp, (err) => {
          if (!err) {
            this.isOnline = true;
          }
        });
      });
      console.log(`[Z-Audio] Command sent to ${uniqueTargets.join(', ')}:${this.port} -> ${commandString}`);
    }

    return true;
  }

  /**
   * Set Zone Volume (0 to 79)
   */
  async setVolume(zoneId, volume) {
    const vol = Math.max(0, Math.min(79, parseInt(volume) || 0));
    if (this.zones[zoneId]) {
      this.zones[zoneId].volume = vol;
      this.zones[zoneId].muted = vol === 0;
    }
    const cmd = `*Z${zoneId}VOL${vol}`;
    await this.sendCommand(cmd);
    return this.getZoneState(zoneId);
  }

  /**
   * Set Zone Power State
   */
  async setPower(zoneId, power) {
    const isPowerOn = Boolean(power);
    if (this.zones[zoneId]) {
      this.zones[zoneId].power = isPowerOn;
      if (!isPowerOn) {
        this.zones[zoneId].playbackState = 'paused';
      }
    }
    const cmd = `*Z${zoneId}${isPowerOn ? 'ON' : 'OFF'}`;
    await this.sendCommand(cmd);
    return this.getZoneState(zoneId);
  }

  /**
   * Toggle Mute
   */
  async toggleMute(zoneId) {
    if (this.zones[zoneId]) {
      this.zones[zoneId].muted = !this.zones[zoneId].muted;
      const cmd = `*Z${zoneId}${this.zones[zoneId].muted ? 'MUTE' : 'UNMUTE'}`;
      await this.sendCommand(cmd);
    }
    return this.getZoneState(zoneId);
  }

  /**
   * Select Audio Source (1 to 5)
   */
  async setSource(zoneId, sourceId) {
    const src = parseInt(sourceId);
    if (this.sources[src] && this.zones[zoneId]) {
      this.zones[zoneId].source = src;
      this.zones[zoneId].sourceName = this.sources[src];
      const cmd = `*Z${zoneId}SRC${src}`;
      await this.sendCommand(cmd);
    }
    return this.getZoneState(zoneId);
  }

  /**
   * Playback Controls: play, pause, stop, next, prev
   */
  async controlPlayback(zoneId, action) {
    const zone = this.zones[zoneId];
    if (!zone) return null;

    let cmd = '';
    switch (action.toLowerCase()) {
      case 'play':
        zone.playbackState = 'playing';
        zone.power = true;
        cmd = `*S${zone.source}PLAY`;
        break;
      case 'pause':
        zone.playbackState = 'paused';
        cmd = `*S${zone.source}PAUSE`;
        break;
      case 'stop':
        zone.playbackState = 'stopped';
        cmd = `*S${zone.source}STOP`;
        break;
      case 'next':
        zone.playbackState = 'playing';
        cmd = `*S${zone.source}NEXT`;
        // Simulate next track title
        zone.currentTrack = `Track 0${Math.floor(Math.random() * 9) + 1} - Modern Grooves`;
        break;
      case 'prev':
        zone.playbackState = 'playing';
        cmd = `*S${zone.source}PREV`;
        zone.currentTrack = `Track 0${Math.floor(Math.random() * 9) + 1} - Acoustic Echoes`;
        break;
    }

    if (cmd) {
      await this.sendCommand(cmd);
    }
    return this.getZoneState(zoneId);
  }

  /**
   * Set Equalizer Mode
   */
  async setEqualizer(zoneId, eqMode) {
    if (this.zones[zoneId]) {
      this.zones[zoneId].eq = eqMode;
      const cmd = `*Z${zoneId}EQ_${eqMode.toUpperCase()}`;
      await this.sendCommand(cmd);
    }
    return this.getZoneState(zoneId);
  }

  /**
   * Return specific zone state
   */
  getZoneState(zoneId) {
    return this.zones[zoneId] || null;
  }

  /**
   * Return full multi-zone controller state & IP info
   */
  getAllStates() {
    return {
      enabled: this.enabled,
      ip: this.ip,
      port: this.port,
      subnet: this.subnet,
      deviceId: this.deviceId,
      isOnline: this.enabled && (this.isOnline || this.simulationMode),
      simulationMode: this.simulationMode,
      sources: this.sources,
      zones: this.zones
    };
  }

  /**
   * Updates configuration live from UI settings
   */
  updateConfig(newConfig = {}) {
    if (newConfig.ip && newConfig.ip !== this.ip) {
      this.ip = newConfig.ip;
      console.log(`[Z-Audio] IP updated to ${this.ip}`);
    }
    if (newConfig.port) this.port = parseInt(newConfig.port);
    if (newConfig.subnet) this.subnet = parseInt(newConfig.subnet);
    if (newConfig.deviceId) this.deviceId = parseInt(newConfig.deviceId);
    if (newConfig.enabled !== undefined) this.enabled = Boolean(newConfig.enabled);
    if (newConfig.simulationMode !== undefined) this.simulationMode = Boolean(newConfig.simulationMode);
  }
}

module.exports = ZAudioController;
