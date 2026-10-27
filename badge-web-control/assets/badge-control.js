/**
 * badge-control.js — control the Badge JSCONF 2026 from the browser over Web Serial.
 *
 * Builds on badge-canvas.js (load it first): it reuses its serial link, its 0x94 0xC3 framing and its
 * protobuf helpers. Everything here is the standard Meshtastic phone API; no custom messages exist.
 *
 *   ToRadio { packet: MeshPacket { to, decoded: Data { portnum, payload } } }
 *
 * Classic script (no modules), so it also works from file://. Exposes window.BadgeControl.
 */
(function (global) {
  'use strict';

  const { proto } = global.BadgeCanvas;
  const { fieldVarint, fieldBytes, decode } = proto;

  // ---------------------------------------------------------------- constants

  /** meshtastic.PortNum values this page uses. */
  const PORT = { TEXT_MESSAGE_APP: 1, ADMIN_APP: 6 };

  /** Destination meaning "everyone on the channel" (goes out over LoRa). */
  const BROADCAST = 0xffffffff;

  /**
   * Badge buttons as the firmware sees them (meshtastic_input_broker_event).
   * A button press is injected with AdminMessage.send_input_event; the badge reacts as if it were pressed.
   */
  const BUTTON = { UP: 29, DOWN: 28, SELECT: 10, BACK: 24 };

  /** Custom event of this firmware: the badge saves its current screen to /prefs/screen.bin (428x142 RGB565, big-endian). */
  const SCREENSHOT_EVENT = 0xe0;
  const SCREENSHOT_PATH = '/prefs/screen.bin';

  const REGION = { 0: 'UNSET', 1: 'US', 2: 'EU_433', 3: 'EU_868', 4: 'CN', 5: 'JP', 6: 'ANZ', 7: 'KR', 8: 'TW', 9: 'RU', 10: 'IN' };
  const PRESET = { 0: 'LONG_FAST', 1: 'LONG_SLOW', 3: 'MEDIUM_SLOW', 4: 'MEDIUM_FAST', 5: 'SHORT_SLOW', 6: 'SHORT_FAST', 7: 'LONG_MODERATE' };
  const ROLE = { 0: 'CLIENT', 1: 'CLIENT_MUTE', 2: 'ROUTER', 3: 'ROUTER_CLIENT', 4: 'REPEATER', 5: 'TRACKER', 6: 'SENSOR' };

  // ---------------------------------------------------------------- protobuf encoders

  /**
   * Fixed-width fields. MeshPacket.to / from / id are `fixed32`: wire type 5, four bytes, little-endian.
   * Key byte = (field number << 3) | 5.
   */
  function fieldFixed32(num, value) {
    return [(num << 3) | 5, value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
  }

  /**
   * Wrap an application payload in ToRadio.packet.
   *
   *   ToRadio.packet (1)     -> MeshPacket
   *   MeshPacket.to (2)      -> fixed32 destination node number
   *   MeshPacket.decoded (4) -> Data { portnum (1), payload (2) }
   *
   * `to` = the badge's own node number delivers the packet to the badge itself; BROADCAST sends it over LoRa.
   */
  function meshPacket({ to, portnum, payload, wantAck = false }) {
    const data = [...fieldVarint(1, portnum), ...fieldBytes(2, payload)];
    return fieldBytes(1, [...fieldFixed32(2, to), ...fieldBytes(4, data), ...fieldVarint(10, wantAck ? 1 : 0)]);
  }

  /** AdminMessage.send_input_event (27) -> InputEvent { event_code (1) }. */
  const adminInputEvent = (code) => fieldBytes(27, fieldVarint(1, code));

  /** AdminMessage.set_owner (32) -> User { long_name (2), short_name (3) }. The badge reboots afterwards. */
  const adminSetOwner = (longName, shortName) =>
    fieldBytes(32, [...fieldBytes(2, new TextEncoder().encode(longName)), ...fieldBytes(3, new TextEncoder().encode(shortName))]);

  /** AdminMessage.reboot_seconds (97). */
  const adminReboot = (seconds) => fieldVarint(97, seconds);

  /** Application payloads wrapped for the badge: text goes to the text app, the rest to the admin app. */
  const toRadioText = (to, text, wantAck = false) =>
    meshPacket({ to, portnum: PORT.TEXT_MESSAGE_APP, payload: new TextEncoder().encode(text), wantAck });
  const toRadioAdmin = (to, adminPayload) => meshPacket({ to, portnum: PORT.ADMIN_APP, payload: adminPayload });

  // ---------------------------------------------------------------- protobuf decoders

  const text = (bytes) => (bytes ? new TextDecoder().decode(bytes) : '');
  const first = (fields, num, fallback) => (fields[num] ? fields[num][0] : fallback);
  const u32le = (bytes) => (bytes ? new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) : 0);
  const f32le = (bytes) => (bytes ? new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0, true) : 0);
  const nodeId = (num) => '!' + (num >>> 0).toString(16).padStart(8, '0');

  /** FromRadio.packet (2) -> MeshPacket. Returns the readable parts, with the text when it is a text message. */
  function parseMeshPacket(bytes) {
    const p = decode(bytes);
    const out = {
      from: u32le(first(p, 1)),
      to: u32le(first(p, 2)),
      id: u32le(first(p, 6)),
      snr: p[8] ? f32le(p[8][0]) : null,
      rssi: p[12] ? first(p, 12) | 0 : null,
      hopLimit: first(p, 9, 0),
      portnum: 0,
      text: null,
    };
    if (p[4]) {
      const data = decode(p[4][0]);
      out.portnum = first(data, 1, 0);
      if (out.portnum === PORT.TEXT_MESSAGE_APP) out.text = text(first(data, 2));
    }
    return out;
  }

  /** FromRadio.node_info (4) -> NodeInfo { num (1), user (2), snr (4), last_heard (5), hops_away (9) }. */
  function parseNodeInfo(bytes) {
    const n = decode(bytes);
    const user = n[2] ? decode(n[2][0]) : {};
    return {
      num: first(n, 1, 0),
      id: nodeId(first(n, 1, 0)),
      longName: text(first(user, 2)),
      shortName: text(first(user, 3)),
      snr: n[4] ? f32le(n[4][0]) : null,
      lastHeard: first(n, 5, 0),
      hopsAway: n[9] ? first(n, 9, 0) : null,
    };
  }

  // ---------------------------------------------------------------- device

  /**
   * High-level control of one connected badge.
   *
   *   const device = new BadgeControl.Device(link);          // link: an open BadgeCanvas.BadgeLink
   *   const state = await device.readState();                // node id, name, firmware, radio, nearby nodes
   *   await device.sendText('Hola');                         // banner on the badge screen
   *   await device.press('DOWN');                            // like pressing the DOWN button
   */
  class Device {
    constructor(link) {
      this.link = link;
      this.node = 0;
    }

    /**
     * Read the device state with a want_config_id dump. The firmware answers get_* admin requests only
     * over BLE, so over USB the state is read from the config dump it sends after the handshake.
     */
    async readState() {
      const state = { node: 0, rebootCount: 0, firmware: '', hasBluetooth: null, role: '', user: null, lora: null, bluetooth: null, nodes: [], files: {} };
      const stop = this.link.addTap({
        onRx(_frame, f) {
          if (f[3]) {
            const mi = decode(f[3][0]);
            state.node = first(mi, 1, 0);
            state.rebootCount = first(mi, 8, 0);
          } else if (f[13]) {
            const md = decode(f[13][0]);
            state.firmware = text(first(md, 1));
            state.hasBluetooth = !!first(md, 5, 0);
          } else if (f[4]) {
            state.nodes.push(parseNodeInfo(f[4][0]));
          } else if (f[5]) {
            // FromRadio.config (5): device = 1, lora = 6, bluetooth = 7.
            const c = decode(f[5][0]);
            if (c[1]) state.role = ROLE[first(decode(c[1][0]), 1, 0)] || String(first(decode(c[1][0]), 1, 0));
            if (c[6]) {
              const l = decode(c[6][0]);
              state.lora = {
                region: REGION[first(l, 7, 0)] || String(first(l, 7, 0)),
                preset: PRESET[first(l, 2, 0)] || String(first(l, 2, 0)),
                hopLimit: first(l, 8, 0),
                txPower: first(l, 10, 0),
                txEnabled: !!first(l, 9, 0),
              };
            }
            if (c[7]) {
              const b = decode(c[7][0]);
              state.bluetooth = { enabled: !!first(b, 1, 0), mode: ['PIN aleatorio', 'PIN fijo', 'sin PIN'][first(b, 2, 0)] || '?' };
            }
          }
        },
      });
      let info;
      try {
        info = await this.link.handshake();
      } finally {
        stop();
      }
      state.files = info.files;
      this.node = state.node || info.node;
      // The first node_info is the badge itself; keep it apart from the neighbours.
      const self = state.nodes.find((n) => n.num === this.node);
      state.user = self || null;
      state.nodes = state.nodes.filter((n) => n.num !== this.node);
      return state;
    }

    /** Send a text. Default: to this badge, which shows it as a banner. `{ to: BROADCAST }` sends it over LoRa. */
    sendText(message, { to = this.node, wantAck = false } = {}) {
      this._needNode(to);
      return this.link.send(toRadioText(to, message, wantAck));
    }

    /** Press a button: 'UP' | 'DOWN' | 'SELECT' | 'BACK'. */
    press(button) {
      if (!(button in BUTTON)) throw new Error('Botón desconocido: ' + button);
      this._needNode();
      return this.link.send(toRadioAdmin(this.node, adminInputEvent(BUTTON[button])));
    }

    /** Send an input event with an arbitrary code (internal helper behind press() and screenshot()). */
    _inputEvent(code) {
      this._needNode();
      return this.link.send(toRadioAdmin(this.node, adminInputEvent(code)));
    }

    /**
     * Take a screenshot of the badge screen. The firmware saves the frame it just painted to flash and this
     * downloads it over XModem. Resolves with the RGB565 bytes (BadgeCanvas.BYTES); convert them with
     * BadgeCanvas.rgb565ToImageData. Needs the firmware build that handles SCREENSHOT_EVENT.
     */
    async screenshot({ onProgress, settleMs = 3000 } = {}) {
      this._needNode();
      await this.link.send(toRadioAdmin(this.node, adminInputEvent(SCREENSHOT_EVENT)));
      await new Promise((r) => setTimeout(r, settleMs));
      const bytes = await this.link.readFile(SCREENSHOT_PATH, { onProgress, expectedBytes: global.BadgeCanvas.BYTES });
      if (bytes.length !== global.BadgeCanvas.BYTES) {
        throw new Error('La captura mide ' + bytes.length + ' bytes; se esperaban ' + global.BadgeCanvas.BYTES + '. ¿El badge tiene el firmware con capturas?');
      }
      return bytes;
    }

    /** Change the name shown on the badge. The badge reboots and the USB port drops for a few seconds. */
    setOwner(longName, shortName) {
      this._needNode();
      return this.link.send(toRadioAdmin(this.node, adminSetOwner(longName, shortName)));
    }

    /** Reboot after `seconds`. */
    reboot(seconds = 2) {
      this._needNode();
      return this.link.send(toRadioAdmin(this.node, adminReboot(seconds)));
    }

    _needNode(to = this.node) {
      if (!to) throw new Error('Falta el número de nodo: llama primero a readState().');
    }
  }

  global.BadgeControl = {
    PORT, BUTTON, SCREENSHOT_EVENT, SCREENSHOT_PATH, BROADCAST, REGION, PRESET, ROLE,
    fieldFixed32, meshPacket, adminInputEvent, adminSetOwner, adminReboot, toRadioText, toRadioAdmin,
    parseMeshPacket, parseNodeInfo, nodeId, Device,
  };
})(window);
