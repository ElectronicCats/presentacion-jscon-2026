/**
 * badge-canvas.js — upload a full-screen image to the Badge JSCON 2026 over Web Serial.
 *
 * Classic script (no modules) so the page also works when opened from file://.
 * Exposes window.BadgeCanvas = { WIDTH, HEIGHT, BYTES, PATH, BadgeLink, imageDataToRgb565, crc16 }.
 */
(function (global) {
  'use strict';

  const WIDTH = 428;
  const HEIGHT = 142;
  const BYTES = WIDTH * HEIGHT * 2;
  const PATH = '/prefs/canvas.bin';
  const CHUNK = 128; // meshtastic.XModem.buffer max_size
  const USB_VENDOR_ESPRESSIF = 0x303a;

  const Control = { NUL: 0, SOH: 1, STX: 2, EOT: 4, ACK: 6, NAK: 21, CAN: 24 };

  // ---------------------------------------------------------------- protobuf wire format

  function varint(n) {
    const out = [];
    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      out.push(b);
    } while (n > 0);
    return out;
  }

  function fieldVarint(num, value) {
    return value ? [...varint(num * 8), ...varint(value)] : [];
  }

  function fieldBytes(num, bytes) {
    return bytes && bytes.length ? [...varint(num * 8 + 2), ...varint(bytes.length), ...bytes] : [];
  }

  /** Decode one protobuf message into { fieldNumber: [values...] } (varints as numbers, len as Uint8Array). */
  function decode(buf) {
    const fields = {};
    let i = 0;
    const readVarint = () => {
      let value = 0;
      let mul = 1;
      for (;;) {
        const b = buf[i++];
        if (b === undefined) throw new Error('truncated varint');
        value += (b & 0x7f) * mul;
        if (!(b & 0x80)) return value;
        mul *= 128;
      }
    };
    while (i < buf.length) {
      const key = readVarint();
      const num = Math.floor(key / 8);
      const wire = key & 7;
      let value;
      if (wire === 0) value = readVarint();
      else if (wire === 2) {
        const len = readVarint();
        value = buf.subarray(i, i + len);
        i += len;
      } else if (wire === 5) {
        value = buf.subarray(i, i + 4);
        i += 4;
      } else if (wire === 1) {
        value = buf.subarray(i, i + 8);
        i += 8;
      } else throw new Error('unsupported wire type ' + wire);
      (fields[num] = fields[num] || []).push(value);
    }
    return fields;
  }

  // ToRadio: want_config_id = 3, disconnect = 4, xmodemPacket = 5.  XModem: control = 1, seq = 2, crc16 = 3, buffer = 4.
  const toRadioWantConfig = (nonce) => fieldVarint(3, nonce);
  const toRadioDisconnect = () => fieldVarint(4, 1);
  const toRadioXModem = (control, seq, crc, data) =>
    fieldBytes(5, [...fieldVarint(1, control), ...fieldVarint(2, seq), ...fieldVarint(3, crc), ...fieldBytes(4, data)]);

  /** CRC-16/XMODEM: poly 0x1021, init 0, no reflection, no final xor. */
  function crc16(data) {
    let crc = 0;
    for (let n = 0; n < data.length; n++) {
      crc ^= data[n] << 8;
      for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
  }

  // ---------------------------------------------------------------- image conversion

  /**
   * Convert a 428x142 ImageData to the badge format: RGB565, big-endian, row-major.
   * Pure magenta (0xF81F) is the badge's sprite transparency key, so it is nudged to 0xF81E.
   * With dither=true, Floyd–Steinberg error diffusion hides RGB565 banding in gradients.
   */
  function imageDataToRgb565(imageData, dither) {
    if (imageData.width !== WIDTH || imageData.height !== HEIGHT) throw new Error('image must be ' + WIDTH + 'x' + HEIGHT);
    const src = imageData.data;
    const work = new Float32Array(WIDTH * HEIGHT * 3);
    for (let p = 0, q = 0; p < src.length; p += 4, q += 3) {
      work[q] = src[p];
      work[q + 1] = src[p + 1];
      work[q + 2] = src[p + 2];
    }
    const out = new Uint8Array(BYTES);
    const levels = [31, 63, 31];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const q = (y * WIDTH + x) * 3;
        const c = [0, 0, 0];
        for (let ch = 0; ch < 3; ch++) {
          const v = Math.min(255, Math.max(0, work[q + ch]));
          c[ch] = Math.round((v * levels[ch]) / 255);
          if (dither) {
            const err = v - (c[ch] * 255) / levels[ch];
            if (x + 1 < WIDTH) work[q + 3 + ch] += (err * 7) / 16;
            if (y + 1 < HEIGHT) {
              if (x > 0) work[q + (WIDTH - 1) * 3 + ch] += (err * 3) / 16;
              work[q + WIDTH * 3 + ch] += (err * 5) / 16;
              if (x + 1 < WIDTH) work[q + (WIDTH + 1) * 3 + ch] += err / 16;
            }
          }
        }
        let v = (c[0] << 11) | (c[1] << 5) | c[2];
        if (v === 0xf81f) v = 0xf81e;
        out[(y * WIDTH + x) * 2] = v >> 8;
        out[(y * WIDTH + x) * 2 + 1] = v & 0xff;
      }
    }
    return out;
  }

  /** Expand badge RGB565 bytes back to an ImageData, to preview exactly what the panel shows. */
  function rgb565ToImageData(bytes) {
    const img = new ImageData(WIDTH, HEIGHT);
    for (let i = 0, p = 0; i < bytes.length; i += 2, p += 4) {
      const v = (bytes[i] << 8) | bytes[i + 1];
      img.data[p] = (((v >> 11) & 31) * 255) / 31;
      img.data[p + 1] = (((v >> 5) & 63) * 255) / 63;
      img.data[p + 2] = ((v & 31) * 255) / 31;
      img.data[p + 3] = 255;
    }
    return img;
  }

  // ---------------------------------------------------------------- serial link

  // Links opened by this page, by port: opening a port again closes the previous link first instead of
  // failing with "The port is already open".
  const openLinks = new Map();

  class BadgeLink {
    constructor(port) {
      this.port = port;
      this.rx = new Uint8Array(0);
      this.waiters = [];
      this.events = [];
      /** Listeners for every raw frame: { onRx(frame, fields), onTx(payload) }. See addTap(). */
      this.taps = [];
      this.closed = false;
      /** Called once if the connection drops on its own (badge reset or unplugged). */
      this.onDisconnect = () => {};
    }

    /** Ask the browser for an Espressif USB port and open it. */
    static async request() {
      if (!('serial' in navigator)) throw new Error('Este navegador no tiene Web Serial (usa Chrome o Edge de escritorio).');
      const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: USB_VENDOR_ESPRESSIF }] });
      const link = new BadgeLink(port);
      await link.open();
      return link;
    }

    async open() {
      const previous = openLinks.get(this.port);
      if (previous) await previous.close();
      try {
        await this.port.open({ baudRate: 115200 });
      } catch (err) {
        // Chromium opens serial ports exclusively: another window, tab or program holding it ends here.
        const busy = new Error(
          'El puerto está en uso. ¿Está la página abierta en otra ventana o pestaña, o el puerto abierto en otro ' +
            'programa (CLI de Meshtastic, monitor serie)? Desconéctalo allí y vuelve a intentarlo.'
        );
        busy.name = 'PortBusyError';
        busy.cause = err;
        throw busy;
      }
      openLinks.set(this.port, this);
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.reading = this._readLoop();
      this._onSerialDisconnect = (e) => {
        if (e.target === this.port) this._lost('el navegador avisó que el puerto se desconectó');
      };
      navigator.serial.addEventListener('disconnect', this._onSerialDisconnect);
    }

    /** Close the port. Safe to call more than once and after the connection was lost. */
    async close({ notify = true } = {}) {
      if (this.closed) return;
      if (notify) {
        // ToRadio.disconnect: without it the badge counts this client as connected for 15 minutes
        // and keeps writing frames that nobody reads.
        await Promise.race([this._send(toRadioDisconnect()).catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
      }
      this.closed = true;
      this._failWaiters();
      navigator.serial.removeEventListener('disconnect', this._onSerialDisconnect);
      try {
        await this.reader.cancel();
      } catch (_) {}
      await this.reading.catch(() => {});
      // Each lock is released on its own: a failure on one must not leave the port locked open.
      try {
        this.reader.releaseLock();
      } catch (_) {}
      try {
        this.writer.releaseLock();
      } catch (_) {}
      await this.port.close().catch(() => {});
      if (openLinks.get(this.port) === this) openLinks.delete(this.port);
    }

    /** Why the connection dropped on its own, for the page log. */
    _lost(reason) {
      if (this.closed) return;
      this.lostReason = reason;
      this.close({ notify: false }).finally(() => this.onDisconnect(reason));
    }

    // Pending replies can never arrive once the link is down: answer them now instead of timing out.
    _failWaiters() {
      this.waiters.splice(0).forEach((w) => w.resolve(null));
    }

    async _readLoop() {
      let reason = 'el navegador cerró el flujo de lectura';
      for (;;) {
        let chunk;
        try {
          chunk = await this.reader.read();
        } catch (err) {
          // Only a failing read means the port is gone (reset, unplugged, stream errored).
          reason = 'error de lectura: ' + err.name + ': ' + err.message;
          break;
        }
        if (chunk.done) break;
        const merged = new Uint8Array(this.rx.length + chunk.value.length);
        merged.set(this.rx);
        merged.set(chunk.value, this.rx.length);
        this.rx = merged;
        this._deframe();
      }
      if (!this.closed) this._lost(reason);
    }

    // Stream framing: 0x94 0xC3 LEN_HI LEN_LO <FromRadio protobuf>. Anything else is console text.
    _deframe() {
      for (;;) {
        let i = 0;
        while (i + 1 < this.rx.length && !(this.rx[i] === 0x94 && this.rx[i + 1] === 0xc3)) i++;
        if (i + 4 > this.rx.length) {
          this.rx = this.rx.slice(i);
          return;
        }
        const len = (this.rx[i + 2] << 8) | this.rx[i + 3];
        if (len > 512) {
          this.rx = this.rx.slice(i + 1);
          continue;
        }
        if (i + 4 + len > this.rx.length) {
          this.rx = this.rx.slice(i);
          return;
        }
        const frame = this.rx.slice(i + 4, i + 4 + len);
        this.rx = this.rx.slice(i + 4 + len);
        this._dispatch(frame);
      }
    }

    /** Observe every frame in both directions (used by the packet inspector and BadgeControl). Returns a remover. */
    addTap(tap) {
      this.taps.push(tap);
      return () => {
        const k = this.taps.indexOf(tap);
        if (k >= 0) this.taps.splice(k, 1);
      };
    }

    _tap(kind, ...args) {
      for (const tap of this.taps.slice()) {
        try {
          if (tap[kind]) tap[kind](...args);
        } catch (_) {
          // A faulty observer must not take the connection down.
        }
      }
    }

    // FromRadio: my_info = 3, config_complete_id = 7, xmodemPacket = 12, fileInfo = 15.
    _dispatch(frame) {
      let event = null;
      try {
        const f = decode(frame);
        this._tap('onRx', frame, f);
        if (f[7]) event = { kind: 'configComplete', nonce: f[7][0] };
        else if (f[3]) {
          const info = decode(f[3][0]);
          event = { kind: 'myInfo', node: (info[1] || [0])[0], rebootCount: (info[8] || [0])[0] };
        } else if (f[12]) {
          const xm = decode(f[12][0]);
          event = { kind: 'xmodem', control: (xm[1] || [0])[0], seq: (xm[2] || [0])[0], crc: (xm[3] || [0])[0], data: xm[4] ? xm[4][0] : new Uint8Array(0) };
        } else if (f[15]) {
          const fi = decode(f[15][0]);
          event = { kind: 'file', name: new TextDecoder().decode(fi[1] ? fi[1][0] : new Uint8Array()), size: (fi[2] || [0])[0] };
        }
      } catch (err) {
        // A frame this client cannot parse is skipped; it must not take the connection down.
        this.skippedFrames = (this.skippedFrames || 0) + 1;
        this.lastFrameError = err.message;
        return;
      }
      if (!event) return;
      const w = this.waiters.findIndex((x) => x.match(event));
      if (w >= 0) this.waiters.splice(w, 1)[0].resolve(event);
      else this.events.push(event);
    }

    _assertOpen() {
      if (this.closed) {
        const err = new Error('Se perdió la conexión con el badge (¿se reinició o se desconectó?). Vuelve a conectar.');
        err.name = 'ConnectionLostError';
        throw err;
      }
    }

    /** Send one ToRadio protobuf (already encoded) inside a 0x94 0xC3 frame. */
    send(payload) {
      return this._send(payload);
    }

    async _send(payload) {
      this._assertOpen();
      this._tap('onTx', payload);
      const bytes = new Uint8Array([0x94, 0xc3, payload.length >> 8, payload.length & 0xff, ...payload]);
      try {
        await this.writer.write(bytes);
      } catch (err) {
        this._lost('error de escritura: ' + err.name + ': ' + err.message);
        this._assertOpen();
      }
    }

    _next(match, timeoutMs) {
      const queued = this.events.findIndex(match);
      if (queued >= 0) return Promise.resolve(this.events.splice(queued, 1)[0]);
      if (this.closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        const waiter = { match, resolve };
        this.waiters.push(waiter);
        setTimeout(() => {
          const k = this.waiters.indexOf(waiter);
          if (k >= 0) {
            this.waiters.splice(k, 1);
            resolve(null);
          }
        }, timeoutMs);
      });
    }

    /**
     * want_config_id handshake. The device only sends XModem replies once the phone API has
     * finished a config dump, so this must run before any transfer. Returns node info and the
     * file manifest (the firmware lists at most 64 files).
     */
    async handshake(timeoutMs = 20000) {
      this.events = this.events.filter((e) => e.kind !== 'file' && e.kind !== 'myInfo');
      const nonce = (Date.now() & 0x7fffffff) || 1;
      const result = { node: 0, rebootCount: 0, files: {} };
      const collect = this._collect(result);
      await this._send(toRadioWantConfig(nonce));
      const done = await this._next((e) => e.kind === 'configComplete' && e.nonce === nonce, timeoutMs);
      collect.stop();
      if (!done) {
        this._assertOpen();
        throw new Error('El badge no respondió al handshake (¿puerto correcto?).');
      }
      return result;
    }

    _collect(result) {
      const take = (e) => {
        if (e.kind === 'myInfo') {
          result.node = e.node;
          result.rebootCount = e.rebootCount;
        } else if (e.kind === 'file') result.files[e.name] = e.size;
        return false;
      };
      const waiter = { match: take, resolve: () => {} };
      this.waiters.unshift(waiter);
      return {
        stop: () => {
          const k = this.waiters.indexOf(waiter);
          if (k >= 0) this.waiters.splice(k, 1);
        },
      };
    }

    async _xmodem(control, seq = 0, data = new Uint8Array(0), timeoutMs = 3000) {
      this.events = this.events.filter((e) => e.kind !== 'xmodem');
      await this._send(toRadioXModem(control, seq, data.length ? crc16(data) : 0, data));
      const reply = await this._next((e) => e.kind === 'xmodem', timeoutMs);
      if (!reply) this._assertOpen();
      return reply ? reply.control : null;
    }

    /**
     * Write `bytes` to `path` on the badge. Stop-and-wait: every 128-byte packet waits for its ACK,
     * and a NAK or a timeout resends it. onProgress(sentBytes, totalBytes).
     */
    async writeFile(path, bytes, { onProgress = () => {}, signal, retries = 8 } = {}) {
      const name = new TextEncoder().encode(path);
      if ((await this._xmodem(Control.SOH, 0, name)) !== Control.ACK) {
        // A previous aborted session can leave the device receiving; CAN resets it.
        await this._xmodem(Control.CAN);
        if ((await this._xmodem(Control.SOH, 0, name)) !== Control.ACK) throw new Error('El badge no abrió ' + path);
      }
      const packets = Math.ceil(bytes.length / CHUNK);
      for (let n = 0; n < packets; n++) {
        if (signal && signal.aborted) {
          await this._xmodem(Control.CAN);
          throw new DOMException('Cancelado', 'AbortError');
        }
        const chunk = bytes.subarray(n * CHUNK, (n + 1) * CHUNK);
        let ok = false;
        for (let attempt = 0; attempt < retries && !ok; attempt++) {
          const reply = await this._xmodem(Control.SOH, (n + 1) & 0xffff, chunk);
          if (reply === Control.CAN) throw new Error('El badge canceló la transferencia');
          ok = reply === Control.ACK;
        }
        if (!ok) {
          await this._xmodem(Control.CAN);
          throw new Error('Paquete ' + (n + 1) + ' sin confirmar tras ' + retries + ' intentos');
        }
        onProgress(Math.min((n + 1) * CHUNK, bytes.length), bytes.length);
      }
      // EOT makes the device flush and close the file; without its ACK nothing is committed.
      for (let attempt = 0; attempt < retries; attempt++) {
        if ((await this._xmodem(Control.EOT)) === Control.ACK) return;
      }
      throw new Error('EOT sin confirmar: la imagen puede no haberse guardado');
    }

    /**
     * Download `path` from the badge (XModem STX). The device sends 128-byte packets and waits for each ACK;
     * a packet whose CRC fails is answered with NAK so it is sent again. Resolves with the file bytes.
     */
    async readFile(path, { onProgress = () => {}, expectedBytes = 0, retries = 8, timeoutMs = 3000 } = {}) {
      const name = new TextEncoder().encode(path);
      this.events = this.events.filter((e) => e.kind !== 'xmodem');
      await this._send(toRadioXModem(Control.STX, 0, crc16(name), name));
      let resets = 0;
      const parts = [];
      let total = 0;
      let expectSeq = 1;
      let bad = 0;
      for (;;) {
        const e = await this._next((x) => x.kind === 'xmodem', timeoutMs);
        if (!e) {
          this._assertOpen();
          // Silence: ask for the current packet again (NAK) a few times before giving up.
          if (++bad > retries) throw new Error('El badge dejó de enviar ' + path);
          await this._send(toRadioXModem(Control.NAK, 0, 0, new Uint8Array(0)));
          continue;
        }
        if (e.control === Control.EOT) {
          await this._send(toRadioXModem(Control.ACK, 0, 0, new Uint8Array(0)));
          break;
        }
        if (e.control === Control.NAK || e.control === Control.CAN) {
          // A download that was cut short leaves the device in «transmitting» and it refuses a new STX with NAK.
          // A stray data packet makes it cancel the old transfer (it answers CAN and keeps the file); then ask again.
          // Never send CAN to reset it: on the device CAN also deletes the file.
          if (parts.length === 0 && e.control === Control.NAK && resets++ < 2) {
            const junk = new Uint8Array(1);
            await this._send(toRadioXModem(Control.SOH, 1, crc16(junk), junk));
            await this._next((x) => x.kind === 'xmodem', 1500);
            this.events = this.events.filter((x) => x.kind !== 'xmodem');
            await this._send(toRadioXModem(Control.STX, 0, crc16(name), name));
            continue;
          }
          throw new Error('El badge no pudo enviar ' + path);
        }
        if (e.control !== Control.SOH) continue;
        if (e.seq === expectSeq - 1 && parts.length) {
          // A duplicate of the previous packet: acknowledge it again and keep waiting.
          await this._send(toRadioXModem(Control.ACK, 0, 0, new Uint8Array(0)));
          continue;
        }
        if (e.seq !== expectSeq || crc16(e.data) !== e.crc) {
          if (++bad > retries) throw new Error('Demasiados paquetes dañados al leer ' + path);
          await this._send(toRadioXModem(Control.NAK, 0, 0, new Uint8Array(0)));
          continue;
        }
        parts.push(e.data);
        total += e.data.length;
        expectSeq++;
        onProgress(total, expectedBytes);
        await this._send(toRadioXModem(Control.ACK, 0, 0, new Uint8Array(0)));
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) {
        out.set(p, off);
        off += p.length;
      }
      return out;
    }

    /**
     * Upload a canvas image (Uint8Array of BYTES) and verify its size from the file manifest.
     * Resolves with the handshake result taken for that verification.
     */
    async uploadCanvas(bytes, options = {}) {
      if (bytes.length !== BYTES) throw new Error('La imagen debe medir ' + BYTES + ' bytes');
      await this.writeFile(PATH, bytes, options);
      const info = await this.handshake();
      if (info.files[PATH] !== BYTES) throw new Error('Verificación fallida: ' + PATH + ' mide ' + info.files[PATH]);
      return info;
    }

    /** Remove the canvas: XModem has no delete, but cancelling an opened session removes the file. */
    async deleteCanvas() {
      if ((await this._xmodem(Control.SOH, 0, new TextEncoder().encode(PATH))) === Control.ACK) await this._xmodem(Control.CAN);
    }
  }

  // The protobuf helpers are shared with badge-control.js, which builds the other ToRadio messages.
  const proto = { varint, fieldVarint, fieldBytes, decode };

  global.BadgeCanvas = { WIDTH, HEIGHT, BYTES, PATH, Control, BadgeLink, imageDataToRgb565, rgb565ToImageData, crc16, proto };
})(window);
