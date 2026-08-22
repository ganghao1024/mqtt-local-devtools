(function installMqttWebSocketHook() {
  "use strict";

  if (window.__MQTT_LOCAL_DEVTOOLS_HOOKED__) return;
  window.__MQTT_LOCAL_DEVTOOLS_HOOKED__ = true;

  const decoder = window.__MQTT_LOCAL_DEVTOOLS_DECODER__;
  const NativeWebSocket = window.WebSocket;
  if (!decoder || !NativeWebSocket) return;

  const MARKER = "__MQTT_LOCAL_DEVTOOLS_EVENT_V1__";
  const BRIDGE_MARKER = "__MQTT_LOCAL_DEVTOOLS_BRIDGE_V1__";
  const sessionId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const socketStates = new WeakMap();
  let connectionSequence = 0;
  let eventSequence = 0;

  function emit(kind, data) {
    window.postMessage(
      {
        marker: MARKER,
        event: {
          id: `${sessionId}:${++eventSequence}`,
          kind,
          timestamp: Date.now(),
          pageUrl: location.href,
          ...data
        }
      },
      "*"
    );
  }

  function protocolLooksLikeMqtt(protocols) {
    return protocols.some((protocol) => String(protocol).toLowerCase().includes("mqtt"));
  }

  function normalizeProtocols(value) {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string") return [value];
    return [];
  }

  async function toBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      return new Uint8Array(await data.arrayBuffer());
    }
    if (typeof data === "string") return new TextEncoder().encode(data);
    return null;
  }

  function emitConnection(state, status, extra = {}) {
    emit("connection", {
      connection: {
        id: state.id,
        url: state.socket.url || state.url,
        protocols: state.protocols,
        selectedProtocol: state.socket.protocol || "",
        mqtt: state.mqtt,
        protocolVersion: state.protocolVersion,
        clientId: state.clientId,
        status,
        createdAt: state.createdAt,
        ...extra
      }
    });
  }

  async function capturePacket(state, direction, data) {
    try {
      const bytes = await toBytes(data);
      if (!bytes || bytes.length === 0) return;

      const decoded = decoder.decodeMany(bytes, state.protocolVersion);
      if (!decoded.packets.length) {
        if (state.mqtt && decoded.error) {
          emit("decode-error", {
            connectionId: state.id,
            direction,
            error: decoded.error,
            byteLength: bytes.length
          });
        }
        return;
      }

      for (const packet of decoded.packets) {
        const confirmsMqtt = packet.type === 1 || packet.type === 2;
        if (!state.mqtt && !confirmsMqtt) continue;

        if (packet.protocolVersion) state.protocolVersion = packet.protocolVersion;
        if (packet.clientId !== undefined) state.clientId = packet.clientId;
        if (!state.mqtt) {
          state.mqtt = true;
          emitConnection(state, state.socket.readyState === NativeWebSocket.OPEN ? "open" : "connecting");
        }

        emit("packet", {
          connectionId: state.id,
          direction,
          packet
        });
      }
    } catch (error) {
      if (state.mqtt) {
        emit("decode-error", {
          connectionId: state.id,
          direction,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  function observeSocket(socket, constructorArgs) {
    const protocols = normalizeProtocols(constructorArgs[1]);
    const state = {
      id: `${sessionId}:ws-${++connectionSequence}`,
      socket,
      url: String(constructorArgs[0]),
      protocols,
      mqtt: protocolLooksLikeMqtt(protocols),
      protocolVersion: null,
      clientId: "",
      createdAt: Date.now()
    };
    socketStates.set(socket, state);

    if (state.mqtt) emitConnection(state, "connecting");

    socket.addEventListener("open", () => {
      if (state.mqtt) emitConnection(state, "open", { openedAt: Date.now() });
    });
    socket.addEventListener("message", (event) => {
      void capturePacket(state, "incoming", event.data);
    });
    socket.addEventListener("error", () => {
      if (state.mqtt) emitConnection(state, "error", { erroredAt: Date.now() });
    });
    socket.addEventListener("close", (event) => {
      if (state.mqtt) {
        emitConnection(state, "closed", {
          closedAt: Date.now(),
          closeCode: event.code,
          closeReason: event.reason,
          wasClean: event.wasClean
        });
      }
    });

    const nativeSend = socket.send;
    Object.defineProperty(socket, "send", {
      configurable: true,
      writable: true,
      value(data) {
        void capturePacket(state, "outgoing", data);
        return nativeSend.call(this, data);
      }
    });

    return socket;
  }

  const WrappedWebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args, NewTarget) {
      const socket = Reflect.construct(Target, args, NewTarget === WrappedWebSocket ? Target : NewTarget);
      return observeSocket(socket, args);
    }
  });

  try {
    window.WebSocket = WrappedWebSocket;
    emit("hook-ready", { sessionId });
    window.addEventListener("message", (messageEvent) => {
      if (
        messageEvent.source === window &&
        messageEvent.data?.marker === BRIDGE_MARKER &&
        messageEvent.data?.command === "bridge-ready"
      ) {
        emit("hook-ready", { sessionId });
      }
    });
    setTimeout(() => emit("hook-ready", { sessionId }), 0);
  } catch (error) {
    emit("hook-error", { error: error instanceof Error ? error.message : String(error) });
  }
})();
