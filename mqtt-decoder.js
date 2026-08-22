(function installMqttDecoder(globalObject) {
  "use strict";

  const PACKET_NAMES = [
    "RESERVED",
    "CONNECT",
    "CONNACK",
    "PUBLISH",
    "PUBACK",
    "PUBREC",
    "PUBREL",
    "PUBCOMP",
    "SUBSCRIBE",
    "SUBACK",
    "UNSUBSCRIBE",
    "UNSUBACK",
    "PINGREQ",
    "PINGRESP",
    "DISCONNECT",
    "AUTH"
  ];

  const REQUIRED_FLAGS = new Map([
    [1, 0],
    [2, 0],
    [4, 0],
    [5, 0],
    [6, 2],
    [7, 0],
    [8, 2],
    [9, 0],
    [10, 2],
    [11, 0],
    [12, 0],
    [13, 0],
    [14, 0],
    [15, 0]
  ]);

  const textDecoder = new TextDecoder("utf-8");
  const strictTextDecoder = new TextDecoder("utf-8", { fatal: true });
  const MAX_TEXT_PREVIEW = 200000;
  const MAX_HEX_PREVIEW = 512;

  function asBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new TypeError("MQTT decoder expects binary data");
  }

  function readVariableByteInteger(bytes, offset) {
    let multiplier = 1;
    let value = 0;

    for (let index = 0; index < 4; index += 1) {
      if (offset + index >= bytes.length) return { incomplete: true };
      const encoded = bytes[offset + index];
      value += (encoded & 0x7f) * multiplier;
      if ((encoded & 0x80) === 0) {
        return { value, next: offset + index + 1 };
      }
      multiplier *= 128;
    }

    return { error: "Malformed variable byte integer" };
  }

  function readUInt16(bytes, offset) {
    if (offset + 2 > bytes.length) return { incomplete: true };
    return { value: bytes[offset] * 256 + bytes[offset + 1], next: offset + 2 };
  }

  function readBinary(bytes, offset) {
    const length = readUInt16(bytes, offset);
    if (length.incomplete) return length;
    const end = length.next + length.value;
    if (end > bytes.length) return { incomplete: true };
    return { value: bytes.subarray(length.next, end), next: end };
  }

  function readUtf8(bytes, offset) {
    const binary = readBinary(bytes, offset);
    if (binary.incomplete) return binary;
    return { value: textDecoder.decode(binary.value), next: binary.next };
  }

  function skipProperties(bytes, offset) {
    const length = readVariableByteInteger(bytes, offset);
    if (length.incomplete || length.error) return length;
    const next = length.next + length.value;
    if (next > bytes.length) return { incomplete: true };
    return { next, length: length.value };
  }

  function toHex(bytes, limit = MAX_HEX_PREVIEW) {
    const visible = bytes.subarray(0, Math.min(bytes.length, limit));
    const result = Array.from(visible, (value) => value.toString(16).padStart(2, "0")).join(" ");
    return bytes.length > visible.length ? `${result} …` : result;
  }

  function isReadableText(text) {
    if (!text) return true;
    let controls = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
        controls += 1;
      }
    }
    return controls / text.length < 0.02;
  }

  function describePayload(payload) {
    const description = {
      payloadSize: payload.length,
      payloadHex: toHex(payload)
    };

    if (payload.length === 0) {
      description.payloadText = "";
      description.payloadEncoding = "utf-8";
      return description;
    }

    try {
      const decoded = strictTextDecoder.decode(payload.subarray(0, MAX_TEXT_PREVIEW));
      if (isReadableText(decoded)) {
        description.payloadText = decoded;
        description.payloadEncoding = "utf-8";
        description.payloadTruncated = payload.length > MAX_TEXT_PREVIEW;
      } else {
        description.payloadEncoding = "binary";
      }
    } catch {
      description.payloadEncoding = "binary";
    }

    return description;
  }

  function validateFlags(type, flags) {
    if (type === 3) {
      const qos = (flags >> 1) & 0x03;
      return qos !== 3;
    }
    return REQUIRED_FLAGS.get(type) === flags;
  }

  function decodeConnect(body, packet) {
    let cursor = 0;
    const protocolName = readUtf8(body, cursor);
    if (protocolName.incomplete) throw new Error("Incomplete CONNECT protocol name");
    cursor = protocolName.next;
    if (cursor + 4 > body.length) throw new Error("Incomplete CONNECT header");

    packet.protocolName = protocolName.value;
    packet.protocolVersion = body[cursor];
    const connectFlags = body[cursor + 1];
    packet.cleanStart = Boolean(connectFlags & 0x02);
    packet.keepAlive = body[cursor + 2] * 256 + body[cursor + 3];
    cursor += 4;

    if (packet.protocolVersion === 5) {
      const properties = skipProperties(body, cursor);
      if (properties.incomplete || properties.error) throw new Error("Incomplete CONNECT properties");
      cursor = properties.next;
    }

    const clientId = readUtf8(body, cursor);
    if (clientId.incomplete) throw new Error("Incomplete CONNECT client id");
    packet.clientId = clientId.value;
    cursor = clientId.next;

    if (connectFlags & 0x04) {
      if (packet.protocolVersion === 5) {
        const willProperties = skipProperties(body, cursor);
        if (willProperties.incomplete || willProperties.error) throw new Error("Incomplete Will properties");
        cursor = willProperties.next;
      }
      const willTopic = readUtf8(body, cursor);
      if (willTopic.incomplete) throw new Error("Incomplete Will topic");
      packet.willTopic = willTopic.value;
      cursor = willTopic.next;
      const willPayload = readBinary(body, cursor);
      if (willPayload.incomplete) throw new Error("Incomplete Will payload");
      cursor = willPayload.next;
    }

    if (connectFlags & 0x80) {
      const username = readUtf8(body, cursor);
      if (username.incomplete) throw new Error("Incomplete CONNECT username");
      packet.username = username.value;
      cursor = username.next;
    }

    if (connectFlags & 0x40) {
      const password = readBinary(body, cursor);
      if (password.incomplete) throw new Error("Incomplete CONNECT password");
      packet.hasPassword = true;
    }
  }

  function decodePublish(body, packet, protocolVersion) {
    let cursor = 0;
    const topic = readUtf8(body, cursor);
    if (topic.incomplete) throw new Error("Incomplete PUBLISH topic");
    packet.topic = topic.value;
    cursor = topic.next;

    packet.dup = Boolean(packet.flags & 0x08);
    packet.qos = (packet.flags >> 1) & 0x03;
    packet.retain = Boolean(packet.flags & 0x01);

    if (packet.qos > 0) {
      const packetId = readUInt16(body, cursor);
      if (packetId.incomplete) throw new Error("Incomplete PUBLISH packet id");
      packet.packetId = packetId.value;
      cursor = packetId.next;
    }

    if (protocolVersion === 5) {
      const properties = skipProperties(body, cursor);
      if (properties.incomplete || properties.error) throw new Error("Incomplete PUBLISH properties");
      cursor = properties.next;
    }

    Object.assign(packet, describePayload(body.subarray(cursor)));
  }

  function decodeSubscribe(body, packet, protocolVersion, unsubscribe = false) {
    let cursor = 0;
    const packetId = readUInt16(body, cursor);
    if (packetId.incomplete) throw new Error("Incomplete subscription packet id");
    packet.packetId = packetId.value;
    cursor = packetId.next;

    if (protocolVersion === 5) {
      const properties = skipProperties(body, cursor);
      if (properties.incomplete || properties.error) throw new Error("Incomplete subscription properties");
      cursor = properties.next;
    }

    packet.topics = [];
    while (cursor < body.length) {
      const topic = readUtf8(body, cursor);
      if (topic.incomplete) throw new Error("Incomplete subscription topic");
      cursor = topic.next;
      if (unsubscribe) {
        packet.topics.push({ topic: topic.value });
      } else {
        if (cursor >= body.length) throw new Error("Missing subscription options");
        const options = body[cursor];
        cursor += 1;
        packet.topics.push({
          topic: topic.value,
          qos: options & 0x03,
          noLocal: Boolean(options & 0x04),
          retainAsPublished: Boolean(options & 0x08),
          retainHandling: (options >> 4) & 0x03
        });
      }
    }
  }

  function decodeAck(body, packet, protocolVersion) {
    let cursor = 0;
    const packetId = readUInt16(body, cursor);
    if (packetId.incomplete) throw new Error("Incomplete acknowledgement packet id");
    packet.packetId = packetId.value;
    cursor = packetId.next;
    if (protocolVersion === 5 && cursor < body.length) {
      packet.reasonCode = body[cursor];
    }
  }

  function decodePacket(bytesInput, offset = 0, protocolVersion = null) {
    const bytes = asBytes(bytesInput);
    if (offset >= bytes.length) return { incomplete: true };

    const first = bytes[offset];
    const type = first >> 4;
    const flags = first & 0x0f;
    if (type < 1 || type > 15 || !validateFlags(type, flags)) {
      return { error: "Not a valid MQTT fixed header" };
    }

    const remaining = readVariableByteInteger(bytes, offset + 1);
    if (remaining.incomplete || remaining.error) return remaining;
    const end = remaining.next + remaining.value;
    if (end > bytes.length) return { incomplete: true };

    const body = bytes.subarray(remaining.next, end);
    const packet = {
      type,
      typeName: PACKET_NAMES[type],
      flags,
      remainingLength: remaining.value,
      rawHex: toHex(bytes.subarray(offset, end), 128)
    };

    try {
      switch (type) {
        case 1:
          decodeConnect(body, packet);
          break;
        case 2:
          if (body.length < 2) throw new Error("Incomplete CONNACK");
          packet.sessionPresent = Boolean(body[0] & 0x01);
          packet.reasonCode = body[1];
          break;
        case 3:
          decodePublish(body, packet, protocolVersion);
          break;
        case 4:
        case 5:
        case 6:
        case 7:
        case 9:
        case 11:
          decodeAck(body, packet, protocolVersion);
          break;
        case 8:
          decodeSubscribe(body, packet, protocolVersion, false);
          break;
        case 10:
          decodeSubscribe(body, packet, protocolVersion, true);
          break;
        case 14:
        case 15:
          if (protocolVersion === 5 && body.length > 0) packet.reasonCode = body[0];
          break;
        default:
          break;
      }
    } catch (error) {
      return { error: error.message, next: end };
    }

    return { packet, next: end };
  }

  function decodeMany(bytesInput, protocolVersion = null) {
    const bytes = asBytes(bytesInput);
    const packets = [];
    let offset = 0;
    let detectedProtocolVersion = protocolVersion;

    while (offset < bytes.length) {
      const decoded = decodePacket(bytes, offset, detectedProtocolVersion);
      if (decoded.incomplete) {
        return { packets, incomplete: true, consumed: offset, protocolVersion: detectedProtocolVersion };
      }
      if (decoded.error) {
        return {
          packets,
          error: decoded.error,
          consumed: decoded.next || offset,
          protocolVersion: detectedProtocolVersion
        };
      }
      packets.push(decoded.packet);
      if (decoded.packet.protocolVersion) detectedProtocolVersion = decoded.packet.protocolVersion;
      offset = decoded.next;
    }

    return { packets, consumed: offset, protocolVersion: detectedProtocolVersion };
  }

  const api = Object.freeze({ decodePacket, decodeMany, describePayload, PACKET_NAMES });
  globalObject.__MQTT_LOCAL_DEVTOOLS_DECODER__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
