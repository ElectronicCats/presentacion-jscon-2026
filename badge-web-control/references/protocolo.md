# Cómo controla JavaScript al badge

Guía del protocolo de **Badge Studio** (`index.html`). Explica, con el código que lo hace, cómo
JavaScript abre el puerto serie, cómo arma los mensajes protobuf, cómo los mete en un paquete de
Meshtastic y cómo el badge responde.

Todo lo que se ve aquí usa el **API serie estándar de Meshtastic**: no hay mensajes ni firmware
nuevos. Probado el 27-oct-2026 con el firmware `2.8.0.e000e4d`.

| Archivo | Qué contiene |
|---|---|
| `badge-link.js` | Enlace serie (`BadgeLink`), tramas `0x94 0xC3`, protobuf a mano, XModem (imagen). |
| `badge-control.js` | Paquetes de control (texto, botones, nombre, reinicio) y lectura del estado. |
| `control-ui.js` | Pestañas **Control** e **Inspector**. |
| `index.html` | La página: pestañas, conexión y subida de imagen. |

---

## 1. Las capas

```
  Tu código JS                 badge.press('DOWN')
        │
  Admin / texto                AdminMessage { send_input_event { event_code = 28 } }
        │                      Data { portnum = 6 (ADMIN_APP), payload = <AdminMessage> }
  Paquete de malla             MeshPacket { to = <este nodo>, decoded = Data }
        │
  Mensaje del API              ToRadio { packet = MeshPacket }          ← protobuf
        │
  Trama                        94 c3 | LEN (2 bytes) | <ToRadio>        ← lo que viaja
        │
  Web Serial → USB CDC         115200 baudios (el baud es virtual)
        │
  ESP32-S3 (USB nativo)  →  firmware Meshtastic  →  hace lo que pide
```

El badge responde por el mismo camino con `FromRadio`. Un `FromRadio` puede ser un `packet` (algo que
llegó por radio o del propio nodo), `node_info`, `config`, `my_info`, etc.

---

## 2. Web Serial: abrir el puerto

El navegador pide el puerto al usuario (hace falta un clic) y lo abre en exclusiva.
Filtramos por el fabricante: el ESP32-S3 se presenta como *USB JTAG/serial debug unit*,
VID `0x303a` (Espressif).

```js
// badge-link.js · BadgeLink.request / open
const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
await port.open({ baudRate: 115200 });
this.writer = this.port.writable.getWriter();   // para enviar
this.reader = this.port.readable.getReader();   // para recibir
this.reading = this._readLoop();                // bucle de lectura en segundo plano
```

- El **baud** (`115200`) no importa en USB nativo, pero `open()` lo exige.
- Un puerto solo lo puede tener abierto **una** pestaña o programa a la vez.
- Si el badge se reinicia, el puerto desaparece y vuelve a enumerarse. Por eso la página, tras un reinicio
  pedido por ella misma, llama a `navigator.serial.getPorts()` (puertos ya autorizados) y reabre.

---

## 3. Tramas: `94 c3 LEN`

El flujo serie es una secuencia de bytes sin límites. El API de Meshtastic los marca con una cabecera
de **4 bytes**:

```
0x94  0xC3  LEN_HI  LEN_LO  <protobuf de LEN bytes>
```

`LEN` va en big-endian y vale como máximo 512. Lo que quede fuera de una trama es texto de consola del
firmware y se ignora.

**Enviar** (`badge-link.js`, `_send`):

```js
const bytes = new Uint8Array([0x94, 0xc3, payload.length >> 8, payload.length & 0xff, ...payload]);
await this.writer.write(bytes);
```

**Recibir** (`_deframe`): se acumulan los bytes que llegan, se busca `94 c3`, se lee el largo y se corta
cuando ya hay una trama completa. El bucle se repite porque en un mismo `read()` pueden venir varias
tramas o media trama.

```js
while (i + 1 < this.rx.length && !(this.rx[i] === 0x94 && this.rx[i + 1] === 0xc3)) i++;   // buscar 94 c3
const len = (this.rx[i + 2] << 8) | this.rx[i + 3];
if (i + 4 + len > this.rx.length) { /* incompleta: esperar más bytes */ }
const frame = this.rx.slice(i + 4, i + 4 + len);                                           // el FromRadio
```

---

## 4. Protobuf a mano

No usamos librerías: protobuf es lo bastante simple para escribirlo en 30 líneas. Un mensaje es una
lista de campos; cada campo es **clave + valor**.

**Clave** = `(número de campo << 3) | tipo`, codificada como varint. Los tipos que necesitamos:

| Tipo | Nombre | Se usa para | Valor |
|---|---|---|---|
| 0 | varint | enteros, enums, booleanos | varint |
| 2 | length-delimited | texto, bytes, mensajes anidados | largo (varint) + bytes |
| 5 | fixed32 | `MeshPacket.to`, `from`, `id` | 4 bytes, little-endian |

**Varint**: 7 bits por byte, el bit alto indica "sigue".

```js
// badge-link.js
function varint(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;        // hay más bytes
    out.push(b);
  } while (n > 0);
  return out;
}
const fieldVarint = (num, value) => value ? [...varint(num * 8), ...varint(value)] : [];
const fieldBytes  = (num, bytes) => bytes && bytes.length ? [...varint(num * 8 + 2), ...varint(bytes.length), ...bytes] : [];
```

Los campos con valor 0 no se escriben (así lo hace protobuf3), por eso `fieldVarint` devuelve `[]` si el
valor es 0.

```js
// badge-control.js — el único campo de ancho fijo que necesitamos
function fieldFixed32(num, value) {
  return [(num << 3) | 5, value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}
```

---

## 5. Un paquete, byte a byte

Mandar el texto `Hola` **al propio badge** (nodo `!8b8220db` = `0x8b8220db`):

```js
// badge-control.js
function meshPacket({ to, portnum, payload, wantAck = false }) {
  const data = [...fieldVarint(1, portnum), ...fieldBytes(2, payload)];           // Data
  return fieldBytes(1, [...fieldFixed32(2, to), ...fieldBytes(4, data), ...fieldVarint(10, wantAck ? 1 : 0)]);
}
const toRadioText = (to, text) => meshPacket({ to, portnum: 1, payload: new TextEncoder().encode(text) });
```

Resultado:

```
0a 0f  15 db 20 82 8b  22 08  08 01  12 04  48 6f 6c 61
│  │   └───────┬─────┘  │  │   └─┬─┘  └─┬─┘  └────┬────┘
│  │     to = 0x8b8220db │  │  portnum=1 │     "Hola"
│  │     (fixed32, LE)   │  │  (texto)   └ payload (campo 2, 4 bytes)
│  └ largo del MeshPacket (15)  └ Data: largo 8
└ ToRadio.packet (campo 1, length-delimited)
```

| Bytes | Significado |
|---|---|
| `0a 0f` | Campo 1 de `ToRadio` (`packet`), 15 bytes de contenido |
| `15 db 20 82 8b` | `MeshPacket.to` (campo 2, fixed32): `0x8b8220db` en little-endian |
| `22 08` | `MeshPacket.decoded` (campo 4), un `Data` de 8 bytes |
| `08 01` | `Data.portnum` = 1 (`TEXT_MESSAGE_APP`) |
| `12 04 48 6f 6c 61` | `Data.payload` = `"Hola"` |

En el cable va precedido de `94 c3 00 11` (largo 17). Con `to = 0xffffffff` (`BROADCAST`) el mismo paquete
sale por radio a todos los nodos: solo cambian los cuatro bytes del destino.

**Al propio nodo:** con `to` igual al número del badge, el mensaje no sale por LoRa; el badge lo recibe
como cualquier texto y lo muestra como aviso en la pantalla (se comprobó mirando el badge).

---

## 6. Botones: `send_input_event`

El badge no tiene un API de "dibuja esto", pero el firmware acepta un mensaje de **administración**
que simula un botón. Va en el puerto `ADMIN_APP = 6` y contiene un `AdminMessage`.

```js
// badge-control.js
const BUTTON = { UP: 29, DOWN: 28, SELECT: 10, BACK: 24 };           // eventos del firmware
const adminInputEvent = (code) => fieldBytes(27, fieldVarint(1, code));   // AdminMessage.send_input_event = 27
const toRadioAdmin = (to, adminPayload) => meshPacket({ to, portnum: 6, payload: adminPayload });

device.press('DOWN');   // = link.send(toRadioAdmin(node, adminInputEvent(28)))
```

```
0a 10  15 db 20 82 8b  22 09  08 06  12 05  da 01 02 08 1c
                              └─┬─┘  └─┬─┘  └───────┬───────┘
                          portnum=6   payload   AdminMessage:
                          (ADMIN)     (5 bytes) campo 27 (da 01), largo 2,
                                                InputEvent.event_code = 28 (DOWN)
```

`da 01` es la clave del campo 27: `27 × 8 + 2 = 218 = 0xDA`, y como pasa de 127 necesita dos bytes de varint.

| Botón | Evento | Valor |
|---|---|---|
| ARRIBA | `ALT_PRESS` | 29 |
| ABAJO | `USER_PRESS` | 28 |
| SELECT | `SELECT` | 10 |
| BACK | `CANCEL` | 24 |

---

## 7. Nombre y reinicio

```js
// AdminMessage.set_owner = 32 -> User { long_name = 2, short_name = 3 }
const adminSetOwner = (longName, shortName) =>
  fieldBytes(32, [...fieldBytes(2, enc.encode(longName)), ...fieldBytes(3, enc.encode(shortName))]);

// AdminMessage.reboot_seconds = 97
const adminReboot = (seconds) => fieldVarint(97, seconds);
```

```
set_owner("Ana", "AN")
0a 17 15 db 20 82 8b 22 10 08 06 12 0c  82 02 09  12 03 41 6e 61  1a 02 41 4e
                                         └──┬───┘  └────┬─────┘  └───┬────┘
                                  campo 32, largo 9  long_name "Ana"  short_name "AN"

reboot(2)
0a 0e 15 db 20 82 8b 22 07 08 06 12 03  88 06 02
                                         └─┬─┘ └ 2 segundos
                                    campo 97 (varint)
```

**`set_owner` reinicia el badge**, igual que `reboot_seconds`. El puerto desaparece unos segundos; el
contador de reinicios de `my_info` sube en uno. Un script debe esperar y repetir el handshake.

---

## 8. Leer el estado: `want_config_id`

Los *getters* de administración (`get_config_request`, etc.) **no responden por USB**. El estado se lee
como lo hace la app del celular: se pide un volcado completo con `ToRadio.want_config_id`.

```js
// badge-link.js
const toRadioWantConfig = (nonce) => fieldVarint(3, nonce);     // ToRadio.want_config_id = 3
// … y se espera FromRadio.config_complete_id (7) con el mismo número
```

El badge contesta con una serie de `FromRadio`, una por trama:

| Campo `FromRadio` | Nº | Contiene |
|---|---|---|
| `my_info` | 3 | `my_node_num` (1), `reboot_count` (8) |
| `node_info` | 4 | un nodo conocido: `num` (1), `user` (2: `long_name` 2, `short_name` 3), `snr` (4), `last_heard` (5) |
| `config` | 5 | `device` (1: `role`), `lora` (6), `bluetooth` (7) |
| `channel` | 10 | canales |
| `metadata` | 13 | `firmware_version` (1), `hasBluetooth` (5) |
| `fileInfo` | 15 | archivos: `file_name` (1), `size_bytes` (2) |
| `config_complete_id` | 7 | fin del volcado |

`LoRaConfig` (dentro de `config.lora`): `modem_preset` (2), `region` (7), `hop_limit` (8),
`tx_enabled` (9), `tx_power` (10). El nodo `my_info.my_node_num` es el número que se usa como `to`.

`Device.readState()` hace exactamente esto: se engancha a las tramas con `link.addTap({ onRx })`, llama a
`handshake()` y junta los campos.

```js
const stop = this.link.addTap({ onRx(_frame, f) {
  if (f[3])  { const mi = decode(f[3][0]); state.node = first(mi, 1, 0); state.rebootCount = first(mi, 8, 0); }
  else if (f[4]) state.nodes.push(parseNodeInfo(f[4][0]));
  // …
}});
const info = await this.link.handshake();
stop();
```

---

## 9. Recibir mensajes

Cada `FromRadio` con el campo 2 (`packet`) es un `MeshPacket`. Si su `Data.portnum` es 1, el payload es texto.

```js
// badge-control.js
function parseMeshPacket(bytes) {
  const p = decode(bytes);
  const out = { from: u32le(first(p, 1)), to: u32le(first(p, 2)), portnum: 0, text: null };
  if (p[4]) {                                       // decoded = Data
    const data = decode(p[4][0]);
    out.portnum = first(data, 1, 0);
    if (out.portnum === 1) out.text = new TextDecoder().decode(first(data, 2));
  }
  return out;
}
```

El Inspector muestra también los demás paquetes (por ejemplo `puerto 67`, telemetría del propio nodo).

---

## 10. Capturar la pantalla del badge

El panel no se puede leer de vuelta, así que el firmware del taller guarda **lo que acaba de pintar**. Son tres pasos y los tres usan piezas que ya conoces:

1. **Pedir la captura.** Un `send_input_event` con un código propio, `0xE0` (224). En el protobuf es `da 01 03 08 e0 01` dentro del `AdminMessage`; el resto del paquete es idéntico al de un botón.
2. **El badge repinta y guarda.** `TFTDisplay::display()` fuerza un repintado completo y, fila a fila, escribe cada trozo de 28 filas en `/prefs/screen.bin` (428 × 142 píxeles, RGB565 *big-endian*, 121 552 bytes, el mismo formato que `canvas.bin`). No hace falta un búfer de la pantalla entera: el badge no tiene PSRAM.
3. **Descargar el archivo.** XModem en sentido contrario al de la imagen: el cliente manda `STX` con la ruta y el badge responde con paquetes de 128 bytes; cada uno se confirma con `ACK` y, si el CRC falla, con `NAK`.

```js
// badge-control.js
async screenshot({ onProgress, settleMs = 3000 } = {}) {
  await this.link.send(toRadioAdmin(this.node, adminInputEvent(SCREENSHOT_EVENT))); // 0xe0
  await new Promise((r) => setTimeout(r, settleMs));                                // el badge repinta y guarda
  return this.link.readFile(SCREENSHOT_PATH, { onProgress, expectedBytes: BYTES }); // XModem STX
}
```

```js
// badge-link.js · readFile (resumen)
await this._send(toRadioXModem(Control.STX, 0, crc16(name), name));   // «dame /prefs/screen.bin»
for (;;) {
  const e = await this._next((x) => x.kind === 'xmodem', timeoutMs);
  if (e.control === Control.EOT) { await ack(); break; }               // terminó
  if (e.seq !== esperado || crc16(e.data) !== e.crc) { await nak(); continue; }
  partes.push(e.data); esperado++; await ack();                        // paquete bueno
}
```

La descarga tarda unos 10 s. Para ver el resultado: `BadgeCanvas.rgb565ToImageData(bytes)` y `putImageData` en un `<canvas>`; Badge Studio lo hace en la pestaña **Control → Pantalla del badge**.

> Esto **no es parte de Meshtastic**: es una función añadida a este firmware (`src/graphics/BadgeScreenshot.cpp`). Con otro firmware el código `0xE0` se ignora y la descarga falla con «El badge dejó de enviar».

## 11. Reglas que conviene recordar

1. **Handshake primero.** Hasta que no haces `want_config_id`, el badge no contesta a XModem y no manda
   nodos ni configuración. Uno por conexión basta.
2. **`ToRadio.disconnect` al cerrar.** Sin él, el badge sigue considerando conectado al cliente durante 15 minutos.
   `BadgeLink.close()` lo envía.
3. **Nombre o reinicio ⇒ el puerto cae.** Reconecta con `getPorts()` y repite el handshake.
4. **El canal usa la clave por defecto.** Un mensaje enviado a la malla lo puede leer cualquiera con Meshtastic.
5. **La imagen no viaja por LoRa.** Es solo USB (XModem a `/prefs/canvas.bin`); ver `README.md`.
6. **Un puerto, un programa.** Cierra otras pestañas, el CLI de Meshtastic o el monitor serie.
7. **Un campo con valor 0 no se escribe.** Es la regla de protobuf3, no un error.

---

## 12. Estado de las pruebas

Probado con un badge real (`!8b8220db`, firmware `2.8.0.e000e4d`), el 27-oct-2026:

| Función | Cómo se probó | Resultado |
|---|---|---|
| Leer estado (`readState`) | USB, volcado `want_config_id` | ✅ nodo, nombre, firmware, radio, rol, Bluetooth, vecinos |
| Texto al propio badge | USB, tramas idénticas a las que el 26-oct hicieron aparecer el banner | ✅ aviso en pantalla (verificado antes con el mismo paquete) |
| Botones UP / DOWN | USB | ✅ la trama sale y coincide con la verificada; ver el cambio de página en el badge |
| SELECT / BACK | USB | ⚠️ mismo mensaje, otros códigos; sin comprobar el efecto en pantalla |
| `set_owner` | USB, nombre cambiado y restaurado | ✅ el nombre cambió y el badge se reinició (contador 291 → 292 → 293) |
| `reboot_seconds` | USB | ✅ contador 290 → 291 |
| Reconexión tras reinicio | Página en Chrome, caída simulada | ✅ reabre el puerto y repite el handshake |
| Enviar a la malla (`to = BROADCAST`) | No probado | ⚠️ sale por radio: confírmalo con tu grupo antes |
| Brillo, canned messages, `store_ui_config` | No probado | ⏳ fuera de esta versión |

Las pruebas con el badge usaron un puente Node (`navigator.serial` simulado sobre `/dev/ttyACM0`)
y la página real en Chrome; Web Serial real exige el selector de puerto del navegador.
