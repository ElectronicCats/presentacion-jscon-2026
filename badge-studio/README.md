# Badge Studio — imagen y control por USB

Página web para el Badge JSCONF 2026 con tres pestañas:

- **Imagen:** sube una imagen a color de 428 × 142 a la página **Canvas** del badge.
- **Control:** muestra textos, pulsa los botones, cambia el nombre, reinicia, lee el estado y **captura la pantalla del badge**.
- **Inspector:** muestra cada trama que se envía y se recibe (bytes y árbol protobuf) y permite enviar una propia.

Cómo lo hace JavaScript (puerto serie, protobuf, paquetes): **[PROTOCOLO.md](PROTOCOLO.md)**.

| Archivo | Qué es |
|---|---|
| `index.html` | App web (Web Serial). Abrir en Chrome o Edge de escritorio. |
| `badge-canvas.js` | Librería del protocolo (enlace serie, tramas, protobuf, XModem), sin dependencias. Expone `window.BadgeCanvas`. |
| `badge-control.js` | Paquetes de control y lectura de estado. Expone `window.BadgeControl`. |
| `control-ui.js` | Pestañas Control e Inspector. |
| `PROTOCOLO.md` | Guía del protocolo con el código que lo implementa. |
| `abrir-chromium.sh` | Lanzador para Linux sin Chrome instalado (ver Uso). |
| `../badgecanvas.py` | Equivalente en línea de comandos (requiere `pyserial`; `Pillow` para `--image`). |

## Uso

1. Abrir `index.html` en Chrome, Edge o Firefox ≥ 157 (doble clic, `file://`; no requiere servidor). Firefox pide permiso ("¿Quieres permitir que este archivo local acceda a
   tus puertos serie?"): elegir el puerto y *Permitir*.
   En Ubuntu, Firefox y Chromium vienen como snap y no tienen acceso a puertos serie: el selector
   sale vacío y no hay interfaz de snap que lo habilite. Opciones: `../firefox-snap-a-deb.sh` (cambia el
   Firefox snap por el .deb de Mozilla conservando el perfil; pide `sudo`), Google Chrome (.deb), o
   `./abrir-chromium.sh` (Chromium de `~/.cache/ms-playwright`, sin sandbox, solo para esta página).
   Con varios badges conectados, todos aparecen con el mismo nombre (*USB JTAG/serial debug unit*).
2. **Conectar por USB** y elegir el puerto *USB JTAG/serial debug unit* (Espressif, VID `0x303a`).
3. Elegir, arrastrar o pegar una imagen. Solo se sube el recorte de 428 × 142 de la vista previa.
   La imagen empieza a **tamaño real** (1 píxel de la imagen = 1 píxel del panel): arrastrarla dentro de
   la vista previa para elegir el área. Lo que el recorte no cubra con imagen se rellena con el color de
   *Fondo* (por ejemplo, alrededor de una imagen más chica que el panel). Atajos: *Tamaño real*,
   *Llenar panel* (escala la imagen hasta cubrir el panel) e *Imagen completa* (cabe entera). Zoom con la
   rueda (sobre el punto del cursor) o el deslizador, desde la imagen completa hasta 800 %; flechas para
   afinar (Mayús = pasos largos), `+`/`-` zoom, `0` tamaño real. La imagen se mueve en ambos ejes
   mientras el centro del panel siga sobre ella. El encuadre se bloquea durante la subida.
4. **Subir imagen** (~8 s). En el badge, ir a la página **Canvas** con los botones arriba / abajo.

```
python3 badgecanvas.py /dev/ttyACM0 --image foto.png [--fit cover|contain]
python3 badgecanvas.py /dev/ttyACM0 --raw imagen.rgb565     # 121552 bytes ya convertidos
python3 badgecanvas.py /dev/ttyACM0 --info | --delete
```

## Página Canvas en el badge

| Estado | Pantalla |
|---|---|
| `/prefs/canvas.bin` existe y mide 121552 bytes | La imagen a pantalla completa |
| Transferencia XModem en curso | "Recibiendo imagen por USB..." |
| Sin archivo o tamaño distinto | "Sin imagen" e instrucciones |

La página está siempre en el carrusel (entre Home y Games) y se repinta sola al terminar una carga.

## Formato de imagen

- 428 × 142 píxeles, fila por fila, de arriba a abajo.
- RGB565 **big-endian** (byte alto primero): `v = (R>>3)<<11 | (G>>2)<<5 | (B>>3)`.
- Tamaño exacto: 121552 bytes. Ruta en el badge: `/prefs/canvas.bin`.
- `0xF81F` (magenta puro) es la clave de transparencia de los sprites del badge: un píxel con ese
  valor deja ver el fondo. Los conversores lo cambian a `0xF81E`.

## Protocolo

Todo viaja sobre el API serie estándar de Meshtastic. No hay mensajes protobuf nuevos.

### Tramas

```
0x94 0xC3 LEN_HI LEN_LO <protobuf>     LEN big-endian, <= 512
```

Host → badge: `meshtastic.ToRadio`. Badge → host: `meshtastic.FromRadio`. Los bytes fuera de una trama
son texto de consola y se ignoran.

### Campos usados

| Mensaje | Campo | Nº | Tipo |
|---|---|---|---|
| `ToRadio` | `want_config_id` | 3 | uint32 |
| `ToRadio` | `disconnect` | 4 | bool |
| `ToRadio` | `xmodemPacket` | 5 | `XModem` |
| `FromRadio` | `my_info` | 3 | `MyNodeInfo` (`my_node_num` = 1, `reboot_count` = 8) |
| `FromRadio` | `config_complete_id` | 7 | uint32 |
| `FromRadio` | `xmodemPacket` | 12 | `XModem` |
| `FromRadio` | `fileInfo` | 15 | `FileInfo` (`file_name` = 1, `size_bytes` = 2) |
| `XModem` | `control` | 1 | enum: SOH 1, EOT 4, ACK 6, NAK 21, CAN 24 |
| `XModem` | `seq` | 2 | uint32 |
| `XModem` | `crc16` | 3 | uint32, CRC-16/XMODEM (poly 0x1021, init 0) del `buffer` |
| `XModem` | `buffer` | 4 | bytes, máximo 128 |

### Secuencia

```
host                                         badge
ToRadio{want_config_id=N}              ->
                                       <-    my_info, config..., fileInfo x <=64, config_complete_id=N
ToRadio{xmodem SOH seq=0 buffer=path}  ->                 (borra el archivo y lo abre para escribir)
                                       <-    xmodem ACK
ToRadio{xmodem SOH seq=k crc16 buffer} ->    k = 1..950, 128 bytes cada uno
                                       <-    xmodem ACK  (NAK si seq o CRC no cuadran: reenviar)
ToRadio{xmodem EOT}                    ->                 (flush + close: aquí se guarda)
                                       <-    xmodem ACK
ToRadio{want_config_id=M}              ->    verificación: fileInfo /prefs/canvas.bin = 121552
ToRadio{disconnect=true}               ->    al cerrar el puerto
```

Reglas:

- **Handshake obligatorio.** El badge solo envía respuestas XModem después de un `want_config_id`
  completo. Uno por conexión basta.
- **Stop-and-wait.** Enviar el paquete siguiente solo tras el ACK del anterior. Si se envían en
  ráfaga, el primer paquete perdido desincroniza `seq` y todos los siguientes reciben NAK.
- **EOT confirma la escritura.** Sin su ACK el archivo queda vacío.
- **`disconnect` al cerrar.** Sin él, el badge sigue considerando conectado al cliente durante 15 minutos
  y le envía tramas que nadie lee (el firmware deja de esperar por ellas tras la primera escritura sin
  salida, pero los clientes deben avisar igualmente). Después de un `disconnect` hace falta un
  `want_config_id` nuevo para volver a recibir respuestas.
- **CAN borra el archivo abierto.** Sirve para abortar una sesión colgada y para borrar:
  `SOH seq=0 path` + `CAN` elimina `path`.
- El manifiesto de `fileInfo` lista como máximo 64 archivos.

## API JavaScript

```html
<script src="badge-canvas.js"></script>
<script>
  const { BadgeLink, imageDataToRgb565, WIDTH, HEIGHT } = BadgeCanvas;

  const link = await BadgeLink.request();          // diálogo de puerto; requiere gesto del usuario
  const { node, rebootCount, files } = await link.handshake();

  const ctx = canvas.getContext('2d');             // canvas de 428 x 142
  const bytes = imageDataToRgb565(ctx.getImageData(0, 0, WIDTH, HEIGHT), true);
  const ctrl = new AbortController();
  await link.uploadCanvas(bytes, { onProgress: (sent, total) => {}, signal: ctrl.signal });

  await link.deleteCanvas();
  await link.close();
</script>
```

| Función | Descripción |
|---|---|
| `BadgeLink.request()` | Pide el puerto (filtro VID `0x303a`), lo abre a 115200 y devuelve el enlace. |
| `new BadgeLink(port)` + `open()` | Igual, con un `SerialPort` ya obtenido. |
| `handshake(timeoutMs = 20000)` | `want_config_id`. Devuelve `{ node, rebootCount, files }`; `files` es `{ ruta: bytes }`. |
| `uploadCanvas(bytes, { onProgress, signal })` | Sube 121552 bytes a `/prefs/canvas.bin`, verifica el tamaño y devuelve el resultado de `handshake()`. Lanza `Error` o `AbortError`. |
| `writeFile(path, bytes, { onProgress, signal, retries = 8 })` | Transferencia XModem genérica, sin verificación. |
| `deleteCanvas()` | Borra `/prefs/canvas.bin`. |
| `close()` | Libera y cierra el puerto. |
| `imageDataToRgb565(imageData, dither)` | `ImageData` 428 × 142 → `Uint8Array` en formato del badge. `dither` aplica Floyd–Steinberg. |
| `rgb565ToImageData(bytes)` | Inverso, para previsualizar exactamente lo que mostrará el panel. |
| `crc16(bytes)` | CRC-16/XMODEM. |

Constantes: `WIDTH` 428, `HEIGHT` 142, `BYTES` 121552, `PATH` `/prefs/canvas.bin`, `Control`.

## API de control (`badge-control.js`)

```html
<script src="badge-canvas.js"></script>
<script src="badge-control.js"></script>
<script>
  const link = await BadgeCanvas.BadgeLink.request();        // requiere un clic del usuario
  const device = new BadgeControl.Device(link);

  const state = await device.readState();                    // { node, user, firmware, lora, role, bluetooth, nodes, files }
  await device.sendText('Hola');                             // aviso en la pantalla del badge
  await device.press('DOWN');                                // 'UP' | 'DOWN' | 'SELECT' | 'BACK'
  await device.sendText('Hola malla', { to: BadgeControl.BROADCAST });   // por radio LoRa
  await device.setOwner('Ana Pérez', 'AP');                  // reinicia el badge
  await device.reboot(2);

  link.addTap({ onTx: (bytes) => {}, onRx: (frame, fields) => {} });     // ver todas las tramas
</script>
```

| Función | Descripción |
|---|---|
| `new Device(link)` | Control de un badge con un `BadgeLink` abierto. |
| `readState()` | Volcado `want_config_id`. Define `device.node`, necesario para los demás métodos. |
| `sendText(texto, { to, wantAck })` | `to` por omisión es el propio badge (aviso en pantalla). `BROADCAST` lo envía por LoRa. |
| `press(botón)` | Simula `UP`, `DOWN`, `SELECT` o `BACK`. |
| `setOwner(largo, corto)` | Cambia el nombre. El badge se reinicia y el puerto cae unos segundos. |
| `reboot(segundos)` | Reinicia el badge. |
| `link.send(bytes)` | Envía cualquier `ToRadio` ya codificado. |
| `link.addTap({ onTx, onRx })` | Observa todas las tramas; devuelve la función para quitarlo. |
| `meshPacket`, `adminInputEvent`, `adminSetOwner`, `adminReboot`, `toRadioText`, `toRadioAdmin` | Constructores de bajo nivel; ver [PROTOCOLO.md](PROTOCOLO.md). |
| `parseMeshPacket`, `parseNodeInfo` | Lectura de `FromRadio.packet` y `node_info`. |

## Firmware

| Archivo | Papel |
|---|---|
| `src/modules/badge/BadgeCanvasModule.{h,cpp}` | Página Canvas: comprueba el archivo, muestra estados, encola la imagen. |
| `src/graphics/BadgeSprites.{h,cpp}` | `BadgeSprite::filePath`: sprites leídos de flash fila a fila (856 B de RAM). |
| `src/graphics/Screen.cpp` | Registro de la página en el carrusel. |
| `src/modules/Modules.cpp` | Instancia el módulo. |

La transferencia usa `src/xmodem.cpp` sin modificaciones.

## Capturas de pantalla del badge

La pestaña **Control → Pantalla del badge** descarga lo que el badge tiene en su pantalla (428 × 142) y permite guardarlo como PNG (~10 s). No es parte de Meshtastic: necesita el firmware del taller con `BadgeScreenshot` (`jscon-2026-firmware/src/graphics/BadgeScreenshot.{h,cpp}`), que responde al `send_input_event` con el código `0xE0`. Cómo funciona: [PROTOCOLO.md](PROTOCOLO.md), sección 10. Desde código: `await device.screenshot()`.
