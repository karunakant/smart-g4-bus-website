/**
 * SmartBus G4 & Z-Audio UDP Bus Simulator
 *
 * Provides a virtual bus hardware emulator for offline local testing.
 * Automatically replies with appropriate S-Bus packet responses and logs diagnostic events.
 */

const { OPCODES, encodePacket, decodePacket } = require('./smartbus-protocol');

class SmartBusSimulator {
  constructor(options = {}) {
    this.enabled = options.enabled !== undefined ? options.enabled : true;
    this.logCallback = options.logCallback || null;

    // Simulated SmartBus Modules online on subnet 1
    this.virtualModules = [
      { subnet: 1, deviceId: 10, name: '12-Ch Relay & Dimmer (Living Room)', type: 0x0002 },
      { subnet: 1, deviceId: 11, name: '6-Ch Dimmer (Master Bedroom)', type: 0x0002 },
      { subnet: 1, deviceId: 12, name: '4-Ch Relay (Kitchen & Dining)', type: 0x0001 },
      { subnet: 1, deviceId: 14, name: 'Outdoor Relay Controller', type: 0x0001 },
      { subnet: 1, deviceId: 15, name: 'DMX / RGB Driver', type: 0x0003 },
      { subnet: 1, deviceId: 50, name: 'HDL Z-Audio Multi-Zone (Subnet 1 • Device 50)', type: 0x192E },
      { subnet: 1, deviceId: 80, name: 'HVAC AC Controller (Living Room)', type: 0x0080 }
    ];
  }

  log(direction, ip, port, hexData, details) {
    const event = {
      timestamp: new Date().toLocaleTimeString(),
      direction, // 'RX' or 'TX' or 'SIM'
      ip,
      port,
      hex: hexData,
      details
    };
    if (typeof this.logCallback === 'function') {
      this.logCallback(event);
    }
  }

  /**
   * Process incoming packet buffer and return response packet if simulated.
   */
  handleIncomingBuffer(buffer, rinfo) {
    if (!this.enabled) return null;

    const parsed = decodePacket(buffer);
    if (!parsed) return null;

    this.log('RX', rinfo ? rinfo.address : '127.0.0.1', rinfo ? rinfo.port : 6000, parsed.rawHex, `Opcode: ${parsed.opcodeHex}`);

    let responseBuffer = null;

    switch (parsed.opcode) {
      case OPCODES.SINGLE_CHANNEL_CONTROL: {
        const ch = parsed.data[0] || 1;
        const level = parsed.data[1] || 0;
        this.log('SIM', 'BUS', 6000, '', `Relay/Dimmer [Sub:${parsed.targetSubnet} Dev:${parsed.targetDevice}] Ch:${ch} -> Level:${level}%`);
        
        responseBuffer = encodePacket({
          srcSubnet: parsed.targetSubnet,
          srcDevice: parsed.targetDevice,
          srcType: 0x0002,
          opcode: OPCODES.SINGLE_CHANNEL_RESPONSE,
          targetSubnet: parsed.srcSubnet,
          targetDevice: parsed.srcDevice,
          data: [ch, 0x01, level] // Success status, channel, level
        });
        break;
      }

      case OPCODES.ZAUDIO_CONTROL: {
        const asciiCmd = Buffer.from(parsed.data).toString('ascii').trim();
        this.log('SIM', '192.168.0.200', 6000, parsed.dataHex, `Z-Audio Executed: "${asciiCmd}"`);
        
        responseBuffer = encodePacket({
          srcSubnet: parsed.targetSubnet,
          srcDevice: parsed.targetDevice,
          srcType: 0x192E,
          opcode: OPCODES.ZAUDIO_RESPONSE,
          targetSubnet: parsed.srcSubnet,
          targetDevice: parsed.srcDevice,
          data: Buffer.from(`*ACK:${asciiCmd}`, 'ascii')
        });
        break;
      }

      case OPCODES.SCENE_CONTROL: {
        const area = parsed.data[0] || 1;
        const scene = parsed.data[1] || 1;
        this.log('SIM', 'BUS', 6000, '', `Scene Triggered: Area ${area}, Scene ${scene}`);
        
        responseBuffer = encodePacket({
          srcSubnet: parsed.targetSubnet,
          srcDevice: parsed.targetDevice,
          srcType: 0x0005,
          opcode: OPCODES.SCENE_RESPONSE,
          targetSubnet: parsed.srcSubnet,
          targetDevice: parsed.srcDevice,
          data: [area, scene, 0x01]
        });
        break;
      }

      case OPCODES.DEVICE_SEARCH: {
        this.log('SIM', 'BUS', 6000, '', `Search Broadcast Received. Responding with ${this.virtualModules.length} online modules.`);
        break;
      }
    }

    if (responseBuffer) {
      const respParsed = decodePacket(responseBuffer);
      if (respParsed) {
        this.log('TX', '127.0.0.1', 6000, respParsed.rawHex, `Feedback Response for ${parsed.opcodeHex}`);
      }
    }

    return responseBuffer;
  }
}

module.exports = SmartBusSimulator;
