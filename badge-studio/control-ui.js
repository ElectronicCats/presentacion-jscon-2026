/**
 * control-ui.js — the Control and Inspector tabs of Badge Studio.
 *
 * Needs badge-canvas.js and badge-control.js, and the bridge window.badgeApp that index.html publishes:
 *   badgeApp.link    the connected BadgeLink, or null
 *   badgeApp.log()   the shared log
 *   'badge-connect' / 'badge-disconnect' events on document
 */
(function () {
  'use strict';

  const { BROADCAST, Device, parseMeshPacket, nodeId } = BadgeControl;
  const app = window.badgeApp;
  const $ = (id) => document.getElementById(id);
  const clock = () => new Date().toLocaleTimeString('es-MX', { hour12: false });
  const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let device = null;
  let removeTap = null;

  // ---------------------------------------------------------------- Control tab

  const needLink = () => document.querySelectorAll('[data-needs-link]');
  const setEnabled = (on) => needLink().forEach((el) => { el.disabled = !on; });

  async function run(label, action) {
    if (!device) return;
    try {
      await action();
      app.log(label);
    } catch (err) {
      app.log('Error en «' + label + '»: ' + err.message);
      app.say(err.message, 'err');
    }
  }

  function showState(s) {
    $('s-node').textContent = nodeId(s.node);
    $('s-name').textContent = s.user ? s.user.longName + ' (' + s.user.shortName + ')' : '—';
    $('s-fw').textContent = s.firmware || '—';
    $('s-radio').textContent = s.lora
      ? s.lora.region + ' · ' + s.lora.preset + ' · ' + s.lora.txPower + ' dBm · ' + s.lora.hopLimit + ' saltos'
      : '—';
    $('s-role').textContent = s.role || '—';
    $('s-bt').textContent = s.bluetooth ? (s.bluetooth.enabled ? 'activado · ' + s.bluetooth.mode : 'desactivado') : '—';
    $('s-boot').textContent = s.rebootCount;
    if (s.user) {
      if (!$('c-long').value) $('c-long').value = s.user.longName;
      if (!$('c-short').value) $('c-short').value = s.user.shortName;
    }
    const box = $('c-nodes');
    if (!s.nodes.length) {
      box.innerHTML = '<p class="empty">Ningún otro nodo oído todavía.</p>';
      return;
    }
    const age = (t) => {
      if (!t || typeof t !== 'number') return '—';
      const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
      if (!Number.isFinite(m)) return '—';
      return m < 1 ? 'ahora' : m < 90 ? m + ' min' : Math.round(m / 60) + ' h';
    };
    box.innerHTML = '<table><tr><th>Nodo</th><th>SNR</th><th>Visto</th></tr>' +
      s.nodes.map((n) => '<tr><td>' + escapeHtml(n.longName || n.id) + '<br><span class="mono">' + n.id + '</span></td><td>' +
        (n.snr == null ? '—' : n.snr.toFixed(1) + ' dB') + '</td><td>' + age(n.lastHeard) + '</td></tr>').join('') + '</table>';
  }

  async function refresh() {
    if (!device) return;
    try {
      showState(await device.readState());
    } catch (err) {
      app.log('No se pudo leer el estado: ' + err.message);
    }
  }

  function addInbox(p) {
    const box = $('c-inbox');
    if (box.querySelector('.empty')) box.innerHTML = '';
    const item = document.createElement('div');
    item.className = 'item';
    const who = p.from === device.node ? 'Este badge' : nodeId(p.from);
    item.innerHTML = '<small>' + clock() + ' · de ' + who + (p.rssi ? ' · ' + p.rssi + ' dBm' : '') + '</small>' + escapeHtml(p.text);
    box.prepend(item);
  }

  function bytesOf(text) {
    return new TextEncoder().encode(text).length;
  }

  $('c-send-self').addEventListener('click', () => {
    const text = $('c-text').value.trim();
    if (!text) return $('c-text').focus();
    run('Mensaje al propio badge: «' + text + '»', () => device.sendText(text));
  });
  $('c-send-mesh').addEventListener('click', () => {
    const text = $('c-text').value.trim();
    if (!text) return $('c-text').focus();
    if (bytesOf(text) > 200) return app.say('El texto es demasiado largo.', 'err');
    if (!confirm('Esto transmite por radio LoRa a todos los nodos del canal que lo oigan. ¿Enviar «' + text + '»?')) return;
    run('Mensaje a la malla: «' + text + '»', () => device.sendText(text, { to: BROADCAST }));
  });
  $('c-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && device) $('c-send-self').click(); });

  function press(name) {
    const btn = document.querySelector('[data-press=' + name + ']');
    btn.classList.add('flash');
    setTimeout(() => btn.classList.remove('flash'), 160);
    run('Botón ' + name, () => device.press(name));
  }
  document.querySelectorAll('[data-press]').forEach((b) => b.addEventListener('click', () => press(b.dataset.press)));
  const KEYS = { ArrowUp: 'UP', ArrowDown: 'DOWN', Enter: 'SELECT', Escape: 'BACK' };
  document.addEventListener('keydown', (e) => {
    if (!$('c-keys').checked || $('p-control').hidden || !device) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || !KEYS[e.key]) return;
    e.preventDefault();
    press(KEYS[e.key]);
  });

  $('c-owner').addEventListener('click', () => {
    const long = $('c-long').value.trim();
    const short = $('c-short').value.trim();
    if (!long || !short) return app.say('Escribe el nombre largo y el corto.', 'err');
    if (!confirm('El badge se reiniciará para aplicar el nombre «' + long + '». ¿Continuar?')) return;
    app.expectReboot = true;
    run('Nombre: «' + long + '» / «' + short + '»', () => device.setOwner(long, short)).then(() => {
      // If the port never drops, do not leave the page waiting for a reboot that was not announced.
      setTimeout(() => { app.expectReboot = false; }, 15000);
    });
  });
  $('c-reboot').addEventListener('click', () => {
    if (!confirm('¿Reiniciar el badge?')) return;
    app.expectReboot = true;
    run('Reinicio', () => device.reboot(2)).then(() => setTimeout(() => { app.expectReboot = false; }, 15000));
  });
  $('c-shot-btn').addEventListener('click', async () => {
    const btn = $('c-shot-btn');
    const label = btn.textContent;
    btn.disabled = true;
    await run('Captura de pantalla', async () => {
      const bytes = await device.screenshot({
        onProgress: (sent, total) => { btn.textContent = 'Descargando… ' + Math.floor((100 * sent) / (total || 1)) + ' %'; },
      });
      const canvas = $('c-shot');
      canvas.getContext('2d').putImageData(window.BadgeCanvas.rgb565ToImageData(bytes), 0, 0);
      const save = $('c-shot-save');
      save.href = canvas.toDataURL('image/png');
      save.hidden = false;
    });
    btn.textContent = label;
    btn.disabled = !device;
  });
  $('c-refresh').addEventListener('click', refresh);

  // ---------------------------------------------------------------- Inspector tab

  const TO_RADIO = { 1: 'packet', 3: 'want_config_id', 4: 'disconnect', 5: 'xmodemPacket', 6: 'mqttClientProxyMessage', 7: 'heartbeat' };
  const FROM_RADIO = {
    1: 'id', 2: 'packet', 3: 'my_info', 4: 'node_info', 5: 'config', 6: 'log_record', 7: 'config_complete_id', 8: 'rebooted',
    9: 'moduleConfig', 10: 'channel', 11: 'queueStatus', 12: 'xmodemPacket', 13: 'metadata', 15: 'fileInfo',
    16: 'clientNotification', 17: 'deviceuiConfig',
  };
  const MAX_FRAMES = 400;
  const frames = [];
  let filter = 'all';
  let selected = null;
  let counter = 0;

  /**
   * Read a protobuf message keeping the wire type of every field (badge-canvas.js' decode() drops it).
   * Wire types: 0 varint, 1 fixed64, 2 length-delimited, 5 fixed32.
   */
  function fields(buf) {
    const out = [];
    let i = 0;
    const varint = () => {
      let v = 0, mul = 1;
      for (;;) {
        const b = buf[i++];
        if (b === undefined) throw new Error('truncated');
        v += (b & 0x7f) * mul;
        if (!(b & 0x80)) return v;
        mul *= 128;
      }
    };
    while (i < buf.length) {
      const key = varint();
      const num = Math.floor(key / 8), wire = key & 7;
      if (num === 0) throw new Error('bad field');
      if (wire === 0) out.push({ num, wire, value: varint() });
      else if (wire === 2) {
        const len = varint();
        if (i + len > buf.length) throw new Error('truncated');
        out.push({ num, wire, value: buf.subarray(i, i + len) });
        i += len;
      } else if (wire === 5 || wire === 1) {
        const len = wire === 5 ? 4 : 8;
        if (i + len > buf.length) throw new Error('truncated');
        out.push({ num, wire, value: buf.subarray(i, i + len) });
        i += len;
      } else throw new Error('wire ' + wire);
    }
    return out;
  }

  const printable = (b) => b.length > 0 && [...b].every((c) => c >= 32 && c < 127 || c === 10) ;

  /** Render a message as an indented tree. Length-delimited values are shown as a nested message, text or bytes. */
  function treeHtml(buf, names, depth = 0) {
    let list;
    try { list = fields(buf); } catch (_) { return '<div class="v">' + hex(buf) + '</div>'; }
    return list.map((f) => {
      const nm = names && names[f.num] ? ' <span class="nm">' + names[f.num] + '</span>' : '';
      const head = '<span class="k">' + f.num + '</span>' + nm + ' <span class="nm">(' + ['varint', 'fixed64', 'len', '', '', 'fixed32'][f.wire] + ')</span> ';
      if (f.wire === 0) return '<div>' + head + '<span class="v">' + f.value + '</span></div>';
      if (f.wire === 5) {
        const dv = new DataView(f.value.buffer, f.value.byteOffset, 4);
        return '<div>' + head + '<span class="v">' + dv.getUint32(0, true) + '</span> <span class="nm">= 0x' + dv.getUint32(0, true).toString(16) + '</span></div>';
      }
      if (f.wire === 1) return '<div>' + head + '<span class="v">' + hex(f.value) + '</span></div>';
      if (printable(f.value)) return '<div>' + head + '<span class="s">"' + escapeHtml(new TextDecoder().decode(f.value)) + '"</span></div>';
      let nested = '';
      try {
        if (depth < 5 && f.value.length) {
          fields(f.value);
          nested = treeHtml(f.value, null, depth + 1);
        }
      } catch (_) { nested = ''; }
      return '<div>' + head + (nested ? '<span class="nm">mensaje</span>' + nested : '<span class="v">' + hex(f.value) + '</span>') + '</div>';
    }).join('');
  }

  function describe(dir, payload) {
    let names = dir === 'tx' ? TO_RADIO : FROM_RADIO;
    try {
      const list = fields(payload);
      if (!list.length) return '(vacío)';
      const f = list[0];
      let label = names[f.num] || 'campo ' + f.num;
      if (dir === 'tx' && f.num === 1) {
        // ToRadio.packet -> MeshPacket -> Data.portnum
        const mp = fields(f.value);
        const data = mp.find((x) => x.num === 4);
        const port = data && fields(data.value).find((x) => x.num === 1);
        label += port ? ' · puerto ' + port.value + ({ 1: ' (texto)', 6: ' (admin)' }[port.value] || '') : '';
      }
      if (dir === 'rx' && f.num === 2) {
        const p = parseMeshPacket(f.value);
        label += ' · puerto ' + p.portnum + (p.text ? ' «' + p.text.slice(0, 24) + '»' : '');
      }
      return label;
    } catch (_) {
      return '(no es protobuf)';
    }
  }

  function record(dir, payload) {
    if (!$('i-capture').checked) return;
    // ToRadio payloads come out of the encoders as plain arrays; FromRadio frames are already Uint8Array.
    const bytes = Uint8Array.from(payload);
    frames.push({ n: ++counter, t: clock(), dir, payload: bytes, summary: describe(dir, bytes) });
    if (frames.length > MAX_FRAMES) frames.shift();
    scheduleRender();
  }

  // Redrawing the list on every frame froze the page under heavy traffic: draw at most once per animation frame.
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderList(); });
  }

  function renderList() {
    const list = frames.filter((f) => filter === 'all' || f.dir === filter);
    $('i-count').textContent = frames.length + ' tramas' + (counter > frames.length ? ' (se conservan las últimas ' + MAX_FRAMES + ')' : '');
    const box = $('i-list');
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.innerHTML = list.map((f) =>
      '<div class="frame ' + f.dir + '" role="option" tabindex="0" data-n="' + f.n + '" aria-selected="' + (selected === f.n) + '">' +
      '<span class="dir">' + (f.dir === 'tx' ? 'TX →' : '← RX') + '</span><span class="t">' + f.t + '</span>' +
      '<span>' + escapeHtml(f.summary) + '</span><span class="n">' + f.payload.length + ' B</span></div>').join('');
    if (stick) box.scrollTop = box.scrollHeight;
  }

  function showDetail(n) {
    const f = frames.find((x) => x.n === n);
    if (!f) return;
    selected = n;
    const len = f.payload.length;
    const wire = '<span class="hdr">94 c3</span> <span class="len">' + (len >> 8).toString(16).padStart(2, '0') + ' ' +
      (len & 255).toString(16).padStart(2, '0') + '</span> ' + hex(f.payload);
    $('i-detail').innerHTML =
      '<h3>En el cable (' + (len + 4) + ' bytes)</h3><div class="hex">' + wire + '</div>' +
      '<p class="hint"><span class="hex"><span class="hdr">94 c3</span></span> inicio de trama · ' +
      '<span class="hex"><span class="len">' + (len >> 8).toString(16).padStart(2, '0') + ' ' + (len & 255).toString(16).padStart(2, '0') + '</span></span> ' +
      'largo (' + len + ') · el resto es el protobuf ' + (f.dir === 'tx' ? 'ToRadio' : 'FromRadio') + '.</p>' +
      '<h3>Protobuf</h3><div class="tree">' + treeHtml(f.payload, f.dir === 'tx' ? TO_RADIO : FROM_RADIO) + '</div>' +
      '<div class="row"><button class="btn" id="i-copy">Copiar hexadecimal</button>' +
      (f.dir === 'tx' ? '<button class="btn" id="i-edit">Editar y reenviar</button>' : '') + '</div>';
    $('i-copy').onclick = () => navigator.clipboard && navigator.clipboard.writeText(hex(f.payload));
    if ($('i-edit')) $('i-edit').onclick = () => { $('i-hex').value = hex(f.payload); $('i-hex').focus(); };
    renderList();
  }

  $('i-list').addEventListener('click', (e) => {
    const row = e.target.closest('.frame');
    if (row) showDetail(+row.dataset.n);
  });
  $('i-list').addEventListener('keydown', (e) => {
    const row = e.target.closest('.frame');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showDetail(+row.dataset.n); }
  });
  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
    renderList();
  }));
  $('i-clear').addEventListener('click', () => {
    frames.length = 0;
    selected = null;
    $('i-detail').innerHTML = '<p class="empty">Elige una trama para ver sus bytes y el árbol protobuf.</p>';
    renderList();
  });

  $('i-send').addEventListener('click', () => {
    const text = $('i-hex').value.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
    if (!text || text.length % 2) return app.say('Escribe bytes en hexadecimal (pares de dígitos).', 'err');
    const bytes = Uint8Array.from(text.match(/../g), (h) => parseInt(h, 16));
    try { fields(bytes); } catch (_) { return app.say('Eso no es un protobuf válido.', 'err'); }
    run('ToRadio manual (' + bytes.length + ' B)', () => app.link.send(bytes));
  });

  // ---------------------------------------------------------------- connection

  document.addEventListener('badge-connect', async () => {
    device = new Device(app.link);
    setEnabled(true);
    removeTap = app.link.addTap({
      onTx: (payload) => record('tx', payload),
      onRx: (frame, f) => {
        record('rx', frame);
        if (f[2]) {
          try {
            const p = parseMeshPacket(f[2][0]);
            if (p.text) addInbox(p);
          } catch (_) {}
        }
      },
    });
    await refresh();
  });

  document.addEventListener('badge-disconnect', () => {
    if (removeTap) removeTap();
    removeTap = null;
    device = null;
    setEnabled(false);
    ['s-node', 's-name', 's-fw', 's-radio', 's-role', 's-bt', 's-boot'].forEach((id) => { $(id).textContent = '—'; });
    $('c-nodes').innerHTML = '<p class="empty">—</p>';
  });

  setEnabled(false);
  renderList();
})();
