/**
 * SmartBus G4 (HDL Buspro / S-Bus / SmartCloud) UDP Protocol Parser & Encoder
 *
 * Implements 100% byte-exact binary encoding matching the IP Gateway SMARTCLOUD protocol.
 */

const OPCODES = {
  SINGLE_CHANNEL_CONTROL: 0x0031,      // Request channel level (Relay / Dimmer)
  SINGLE_CHANNEL_RESPONSE: 0x0032,     // Channel level status response
  READ_CHANNEL_STATUS: 0x0033,         // Request channel status
  READ_CHANNEL_STATUS_RESP: 0x0034,    // Channel status response
  SCENE_CONTROL: 0x0002,               // Execute Scene
  SCENE_RESPONSE: 0x0003,              // Scene response
  ZAUDIO_CONTROL: 0x192E,              // Z-Audio Music / Source / Volume command
  ZAUDIO_RESPONSE: 0x192F,             // Z-Audio status response
  HVAC_CONTROL: 0xE014,                // Climate / AC control command
  HVAC_RESPONSE: 0xE015,               // Climate / AC status response
  CURTAIN_CONTROL: 0x001A,             // Motorized curtain / blinds control
  CURTAIN_RESPONSE: 0x001B,            // Curtain response
  DEVICE_SEARCH: 0x000E,               // Search broadcast request
  DEVICE_SEARCH_RESP: 0x000F          // Device search response
};

const DEVICE_TYPES = {
  MOBILE_APP: 0x0119,     // Official SmartG4 / HDL Mobile App transmitter code
  PC_SOFTWARE: 0x000E,    // HDL Buspro Setup Tool PC software
  PI_GATEWAY: 0xFFFE,     // Local gateway
  RELAY_MODULE: 0x0001,
  DIMMER_MODULE: 0x0002,
  ZAUDIO_MODULE: 0x192E,
  HVAC_MODULE: 0x0080,
  PANEL_MODULE: 0x0005
};

/**
 * Calculates standard HDL Buspro Additive Checksum (Sum of bytes + 0xAAAA).
 * Starts at the Length byte (startOffset) up to buffer.length - 2.
 */
function calculateHDLChecksum(buffer, startOffset = 0) {
  let sum = 0;
  const end = buffer.length - 2;

  for (let i = startOffset; i < end; i++) {
    sum += buffer[i];
  }
  sum = (sum + 0xAAAA) & 0xFFFF;
  return sum;
}

/**
 * Calculates CRC16-CCITT (Polynomial 0x1021) with initial value 0x0000 or 0xFFFF.
 */
function calculateCRC16CCITT(buffer, startOffset = 0, initialValue = 0x0000) {
  let crc = initialValue & 0xFFFF;
  const end = buffer.length - 2;

  for (let i = startOffset; i < end; i++) {
    crc ^= (buffer[i] << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc;
}

function computeChecksum(buffer, startOffset = 0, crcType = 'ADDITIVE') {
  if (crcType === 'CRC16_0000') {
    return calculateCRC16CCITT(buffer, startOffset, 0x0000);
  } else if (crcType === 'CRC16_FFFF') {
    return calculateCRC16CCITT(buffer, startOffset, 0xFFFF);
  }
  return calculateHDLChecksum(buffer, startOffset);
}

/**
 * Encodes SmartBus "SMARTCLOUD" IP Gateway UDP packet format with IP header.
 * Format: IP(4) + "SMARTCLOUD"(10) + 0xAAAA(2) + Length(1) + SrcSub + SrcDev + SrcType(2) + Opcode(2) + TgtSub + TgtDev + Payload + Checksum(2)
 */
function encodeSmartCloudIPPacket({
  ip = '192.168.0.200',
  srcSubnet = 1,
  srcDevice = 254,
  srcType = DEVICE_TYPES.MOBILE_APP,
  opcode,
  targetSubnet = 1,
  targetDevice = 1,
  data = [],
  crcType = 'ADDITIVE'
}) {
  const payload = Buffer.from(data);
  const ipParts = String(ip).split('.').map(p => parseInt(p, 10) || 0);
  const ipBuf = Buffer.from(ipParts.length === 4 ? ipParts : [192, 168, 0, 200]);
  const prefix = Buffer.from('SMARTCLOUD', 'ascii'); // 10 bytes
  const lengthFieldValue = 11 + payload.length;
  const totalLength = ipBuf.length + prefix.length + 2 + lengthFieldValue;

  const buf = Buffer.alloc(totalLength);
  ipBuf.copy(buf, 0);
  prefix.copy(buf, ipBuf.length);

  let offset = ipBuf.length + prefix.length;
  buf[offset] = 0xAA;
  buf[offset + 1] = 0xAA;
  buf[offset + 2] = lengthFieldValue & 0xFF;
  buf[offset + 3] = srcSubnet & 0xFF;
  buf[offset + 4] = srcDevice & 0xFF;
  buf.writeUInt16BE(srcType, offset + 5);
  buf.writeUInt16BE(opcode, offset + 7);
  buf[offset + 9] = targetSubnet & 0xFF;
  buf[offset + 10] = targetDevice & 0xFF;

  if (payload.length > 0) {
    payload.copy(buf, offset + 11);
  }

  const checksum = computeChecksum(buf, offset + 2, crcType);
  buf.writeUInt16BE(checksum, buf.length - 2);

  return buf;
}

/**
 * Encodes SmartBus "SMARTCLOUD" UDP packet format without IP header.
 * Format: "SMARTCLOUD"(10) + 0xAAAA(2) + Length(1) + SrcSub + SrcDev + SrcType(2) + Opcode(2) + TgtSub + TgtDev + Payload + Checksum(2)
 */
function encodeSmartCloudPacket({
  srcSubnet = 1,
  srcDevice = 254,
  srcType = DEVICE_TYPES.MOBILE_APP,
  opcode,
  targetSubnet = 1,
  targetDevice = 1,
  data = [],
  crcType = 'ADDITIVE'
}) {
  const payload = Buffer.from(data);
  const prefix = Buffer.from('SMARTCLOUD', 'ascii'); // 10 bytes
  const lengthFieldValue = 11 + payload.length;
  const totalLength = prefix.length + 2 + lengthFieldValue;

  const buf = Buffer.alloc(totalLength);
  prefix.copy(buf, 0);

  let offset = prefix.length;
  buf[offset] = 0xAA;
  buf[offset + 1] = 0xAA;
  buf[offset + 2] = lengthFieldValue & 0xFF;
  buf[offset + 3] = srcSubnet & 0xFF;
  buf[offset + 4] = srcDevice & 0xFF;
  buf.writeUInt16BE(srcType, offset + 5);
  buf.writeUInt16BE(opcode, offset + 7);
  buf[offset + 9] = targetSubnet & 0xFF;
  buf[offset + 10] = targetDevice & 0xFF;

  if (payload.length > 0) {
    payload.copy(buf, offset + 11);
  }

  const checksum = computeChecksum(buf, offset + 2, crcType);
  buf.writeUInt16BE(checksum, buf.length - 2);

  return buf;
}

/**
 * Encodes standard 0xAAAA SmartBus G4 UDP packet.
 */
function encodePacket({
  srcSubnet = 1,
  srcDevice = 254,
  srcType = DEVICE_TYPES.MOBILE_APP,
  opcode,
  targetSubnet = 1,
  targetDevice = 1,
  data = [],
  crcType = 'ADDITIVE'
}) {
  const payload = Buffer.from(data);
  const lengthFieldValue = 11 + payload.length;
  const totalLength = 2 + lengthFieldValue;

  const buf = Buffer.alloc(totalLength);
  buf[0] = 0xAA;
  buf[1] = 0xAA;
  buf[2] = lengthFieldValue & 0xFF;
  buf[3] = srcSubnet & 0xFF;
  buf[4] = srcDevice & 0xFF;
  buf.writeUInt16BE(srcType, 5);
  buf.writeUInt16BE(opcode, 7);
  buf[9] = targetSubnet & 0xFF;
  buf[10] = targetDevice & 0xFF;

  if (payload.length > 0) {
    payload.copy(buf, 11);
  }

  const checksum = computeChecksum(buf, 2, crcType);
  buf.writeUInt16BE(checksum, buf.length - 2);

  return buf;
}

/**
 * Decodes a raw SmartBus G4 / SMARTCLOUD UDP packet.
 */
function decodePacket(buffer) {
  if (!buffer || buffer.length < 11) {
    return null;
  }

  let offset = 0;
  if (buffer.length >= 27 && buffer.toString('ascii', 4, 14) === 'SMARTCLOUD') {
    offset = 14;
    if (buffer[offset] === 0xAA && buffer[offset + 1] === 0xAA) {
      offset += 2;
    }
  } else if (buffer.length >= 23 && buffer.toString('ascii', 0, 10) === 'SMARTCLOUD') {
    offset = 10;
    if (buffer[offset] === 0xAA && buffer[offset + 1] === 0xAA) {
      offset += 2;
    }
  } else if (buffer.toString('ascii', 0, 10) === 'SMARTCLOUD') {
    offset = 10;
  } else if (buffer[0] === 0xAA && buffer[1] === 0xAA) {
    offset = 2;
  } else {
    return null;
  }

  const length = buffer[offset];
  const srcSubnet = buffer[offset + 1];
  const srcDevice = buffer[offset + 2];
  const srcType = buffer.readUInt16BE(offset + 3);
  const opcode = buffer.readUInt16BE(offset + 5);
  const targetSubnet = buffer[offset + 7];
  const targetDevice = buffer[offset + 8];

  const payloadLength = buffer.length - (offset + 9 + 2);
  const data = payloadLength > 0 ? buffer.slice(offset + 9, offset + 9 + payloadLength) : Buffer.alloc(0);
  const crcReceived = buffer.readUInt16BE(buffer.length - 2);

  return {
    srcSubnet,
    srcDevice,
    srcType,
    opcode,
    opcodeHex: '0x' + opcode.toString(16).padStart(4, '0').toUpperCase(),
    targetSubnet,
    targetDevice,
    data: Array.from(data),
    dataHex: data.toString('hex').toUpperCase(),
    crc: crcReceived,
    rawHex: buffer.toString('hex').toUpperCase()
  };
}

/**
 * Encodes Single Channel Control command (Opcode 0x0031)
 */
function encodeChannelControl(channel, level, delaySeconds = 0) {
  return [
    channel & 0xFF,
    level & 0xFF,
    (delaySeconds >> 8) & 0xFF,
    delaySeconds & 0xFF
  ];
}

/**
 * Encodes Scene Execution command (Opcode 0x0002)
 */
function encodeSceneControl(area, scene) {
  return [area & 0xFF, scene & 0xFF];
}

/**
 * Encodes HVAC/Climate command (Opcode 0xE014)
 */
function encodeHVACControl(temp, mode = 0, speed = 0, power = true) {
  return [
    power ? 0x01 : 0x00,
    temp & 0xFF,
    mode & 0xFF,
    speed & 0xFF
  ];
}

module.exports = {
  OPCODES,
  DEVICE_TYPES,
  encodePacket,
  encodeSmartCloudPacket,
  encodeSmartCloudIPPacket,
  decodePacket,
  encodeChannelControl,
  encodeSceneControl,
  encodeHVACControl,
  calculateHDLChecksum
};

