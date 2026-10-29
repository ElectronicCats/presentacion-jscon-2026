---
name: badge-web-control
description: Build a web page (HTML + JavaScript, Web Serial) that controls the JSCONF 2026 Electronic Cats badge over USB - show text on its screen, press its buttons, rename it, read its state, capture its screen, upload an image - and write the control logic the user asks for. Use when the user wants their own page, app or automation for the badge, mentions "badge JSCONF", "Meshtastic por USB", "Web Serial", "controlar el badge", "mi propia página" or "pantalla del badge", or asks to build the badge control logic with an agent.
---

# Skill: página web de control para el badge JSCONF 2026

Con este skill construyes una **página web propia** que controla el badge por USB, usando las librerías
del taller. El usuario describe lo que quiere ("que el badge muestre la hora cada minuto", "un panel
con mis frases", "un juego que use los botones") y tú escribes la página y la lógica.

No necesitas firmware nuevo, ni servidor, ni instalar nada: es Chrome o Edge de escritorio + el cable USB-C **de datos**.

## Archivos del skill

| Ruta | Para qué |
|---|---|
| `assets/badge-link.js` | Enlace serie, tramas `0x94 0xC3`, protobuf y subida de imagen (XModem). |
| `assets/badge-control.js` | `BadgeControl.Device`: texto, botones, nombre, reinicio, estado. |
| `assets/template.html` | Página mínima que ya conecta y controla. **Empieza siempre desde aquí.** |
| `references/protocolo.md` | Cómo se construyen los paquetes, byte a byte. Léelo si tienes que salirte del API. |

La página completa de referencia es Badge Studio (`tools/canvas-web/index.html` en el repositorio del taller: pestañas Imagen, Control e Inspector).

## Flujo de trabajo

1. **Pregunta lo mínimo** si falta: qué debe hacer la página y quién la usa. No preguntes lo que ya sabes:
   badge JSCONF 2026, Chrome/Edge, USB.
2. **Crea una carpeta** para el proyecto y copia en ella `assets/badge-link.js`, `assets/badge-control.js` y
   `assets/template.html` (renómbralo a `index.html`). Las tres piezas van juntas en la misma carpeta.
3. **Escribe la lógica** en el `<script>` de `index.html` usando solo el API de la sección siguiente.
   No reimplementes protobuf ni el puerto serie.
4. **Dale buen aspecto**: respeta el estilo de la plantilla (tarjetas oscuras, acento amarillo) o el que pida el usuario.
5. **Pruébala**: ábrela con `python3 -m http.server` o con doble clic (`file://` también sirve), conecta el
   badge, y recorre la lista de verificación del final. Si no puedes abrir un navegador con el badge, dilo y
   revisa al menos la sintaxis con `node --check` sobre el JavaScript.
6. **Explica** al usuario qué hace cada parte y qué debe pulsar para probarla.

## API que debes usar

```js
const link = await BadgeCanvas.BadgeLink.request();   // diálogo de puertos; SOLO desde un clic del usuario
const device = new BadgeControl.Device(link);
const state = await device.readState();               // OBLIGATORIO antes de lo demás (define device.node)
// BadgeControl.nodeId(state.node) -> '!8b8220db'
// state = { node, user:{longName,shortName}, firmware, lora:{region,preset,txPower,hopLimit}, role,
//           bluetooth:{enabled,mode}, nodes:[{id,longName,snr,lastHeard}], files, rebootCount }

await device.sendText('Hola');                         // aviso en la pantalla de ESTE badge (no sale por radio)
await device.press('DOWN');                            // 'UP' | 'DOWN' | 'SELECT' | 'BACK'
await device.setOwner('Ana Pérez', 'AP');             // cambia el nombre ¡y REINICIA el badge!
await device.reboot(2);
const rgb565 = await device.screenshot({ onProgress });   // captura de la pantalla (~10 s); solo con el firmware con capturas
// BadgeCanvas.rgb565ToImageData(rgb565) -> ImageData 428×142 para un <canvas>
await device.sendText('Hola malla', { to: BadgeControl.BROADCAST });   // por radio LoRa a todos

link.addTap({ onTx: (bytes) => {}, onRx: (frame, fields) => {} });     // ver tramas
const msg = BadgeControl.parseMeshPacket(fields[2][0]);                // en onRx: { from, text, portnum, ... }

await link.uploadCanvas(rgb565Bytes, { onProgress });  // imagen 428×142 RGB565 big-endian (121 552 bytes)
await link.close();
```

La subida de imagen y su conversión están en `BadgeCanvas` (`imageDataToRgb565`, `uploadCanvas`). Mira
`tools/canvas-web/index.html` del repositorio del taller si el usuario quiere editar o encuadrar imágenes.

## Reglas que no se rompen

1. **Gesto del usuario.** `BadgeLink.request()` solo funciona dentro de un manejador de clic.
2. **`readState()` primero.** Sin el handshake el badge no contesta bien y `device.node` es 0.
3. **`setOwner` y `reboot` reinician el badge.** El puerto cae unos segundos. Avisa al usuario, deshabilita
   los botones y reconecta: `navigator.serial.getPorts()` devuelve los puertos ya autorizados; reabre con
   `new BadgeCanvas.BadgeLink(port)`, `await link.open()` y `await link.handshake()`. Ver `index.html` (`reconnect`).
4. **No mandes ráfagas.** Deja ~1 s entre botones y no más de unos mensajes por segundo; la pantalla y el USB son lentos.
5. **`BROADCAST` sale por radio** y el canal usa la clave pública por defecto: **no es privado**. Pide confirmación al
   usuario antes de enviar y nunca pongas datos personales.
6. **La imagen NO viaja por LoRa.** Es solo USB y tarda ~8 s.
7. **Un solo programa por puerto.** Una pestaña o programa a la vez.
8. **Ver la pantalla del badge:** `screenshot` toma una captura (~10 s) y requiere el firmware del taller. No hay vista en vivo en el API.
9. **Limitaciones del hardware:** sin GPS, Wi-Fi, audio ni pantalla táctil. La pantalla es 428×142.
10. Cierra con `link.close()` en `pagehide` (envía `ToRadio.disconnect`).

## Ideas de lógica

- Reloj o recordatorio: `setInterval` + `sendText(hora)` (no más de uno por minuto).
- Panel de frases: botones que mandan textos predefinidos.
- Control remoto: atajos de teclado → `press(...)` para cambiar de página en una exposición.
- Monitor de vecinos: `readState()` cada 30 s y una tabla con `state.nodes`.
- Bandeja de entrada: `addTap` + `parseMeshPacket` para mostrar los textos que llegan.
- Tarjeta de nombre: formulario con `setOwner` y reconexión automática.
- Visor de pantalla: un botón que llama `screenshot()` y pinta el resultado en un `<canvas>` (una captura, no vídeo).

## Capturas de pantalla

`device.screenshot()` pide al badge que guarde lo que pintó (`send_input_event` con el código propio `0xE0`) y lo descarga por XModem. **No es parte de Meshtastic**: solo existe en el firmware del taller con `BadgeScreenshot`. Sin él falla con «El badge dejó de enviar». Para ver varias páginas: `press('DOWN')`, esperar ~1,5 s, capturar.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| La lista de puertos sale vacía | Cable solo de carga; navegador snap (Ubuntu); otra pestaña usa el puerto. |
| «El puerto está en uso» | Cierra otras pestañas, el monitor serie o el CLI de Meshtastic. |
| `readState` se queda esperando | Puerto equivocado o badge reiniciándose; reintenta tras 5 s. |
| «Se perdió la conexión» tras `setOwner` | Es normal: el badge se reinició; reconecta. |
| Linux: Chromium dice «device has been lost» | `stty -F /dev/ttyACM0 min 1`, o `tools/canvas-web/abrir-chromium.sh` del repositorio del taller. |
| El mensaje no aparece en la pantalla | Falta `readState()` (nodo 0), o el badge está en otra pantalla. |

## Lista de verificación antes de entregar

- [ ] Abre sin errores en la consola y el botón **Conectar** abre el diálogo.
- [ ] Tras conectar se ve el nombre y el nodo del badge.
- [ ] `sendText` muestra el aviso en el badge; `press('DOWN')` cambia de página.
- [ ] Si usa `setOwner` o `reboot`, la página se reconecta sola o explica cómo.
- [ ] Los botones están deshabilitados sin conexión y los errores se muestran en pantalla.
- [ ] No hay claves ni datos personales en el código, y `BROADCAST` pide confirmación.
