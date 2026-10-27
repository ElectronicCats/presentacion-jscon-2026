# JSCONF 2026 · Del enlace de radio a la red Meshtastic

Presentación de **Electronic Cats** para JSCONF 2026. Explica cómo se pasa de un
enlace LoRa al funcionamiento de una red Meshtastic, y cómo el badge JSCONF 2026
se integra como un nodo más de la malla.

El deck está separado en HTML, CSS y JavaScript para poder editarlo a mano sin
tocar los otros archivos. No tiene dependencias externas ni paso de compilación.
Incluye un esquemático animado del badge que se recorre con las mismas teclas de
la presentación.

## Contenido

41 diapositivas, en 10 bloques:

1. **Presentadores** (1–4) · 2. **Electronic Cats** (5) · 3. **El curso** (6)
4. **Tecnologías** (7–12): Meshtastic (7–10) y LoRa (11–12) · 5. **El badge** (13–17): qué es, qué hace, cada pantalla y el esquemático
6. **El badge y Meshtastic** (18–23): cada tecnología en su lugar y la app del celular
7. **Control con JavaScript** (24–30): Web Serial, tramas, paquete, llamadas, mensajes y capturas
8. **El skill** (31–32) · 9. **Taller** (33–40): preparación, ejemplos 1 y 2, proyecto libre y preguntas
10. **Contacto** (41, la última)

1. Apertura con el logo de Electronic Cats
2. Portada
3. Andrés Sabas
4. Heikki Isa Perea Esparza
5. ¿Quiénes somos?
6. Qué vamos a hacer
7. Las piezas que vamos a usar
8. Mensajes sin internet ni red celular
9. Cliente · Router · híbridos
10. Cómo viaja un mensaje
11. LoRa: Long Range
12. Lo que LoRa puede hacer
13. JSCONF 2026
14. ¿Qué puedes hacer con el badge?
15. Qué hace cada pantalla (1/2)
16. Qué hace cada pantalla (2/2)
17. Esquemático animado del badge JSCONF 2026
18. Cada tecnología, en su lugar
19. Tu celular, conectado a la malla LoRa
20. Conecta tu celular al badge
21. Nodos y conversaciones
22. Un mensaje, del celular al aire
23. Todo lo que puedes hacer desde la app
24. Cómo habla JavaScript con el badge
25. Abrir el puerto serie desde JavaScript
26. Enviar y leer tramas
27. Un paquete, byte a byte
28. Cinco llamadas, un badge
29. Enviado, serial y recibido
30. Capturar la pantalla del badge
31. Qué es el skill badge-web-control
32. Tu propia página, con un agente
33. Conexión y preparación
34. Conectar, escribir y pulsar
35. Así lo hicimos en Badge Studio
36. Cambiar el nombre y reconectar
37. El nombre y la reconexión, en Badge Studio
38. Una imagen de 428×142 por USB
39. Proyecto libre
40. ¿Preguntas?
41. Gracias, JSCONF

## Ver la presentación

Abre `index.html` en el navegador. También puedes servirla en local para evitar
restricciones de `file://` con el iframe del esquemático:

```bash
python3 -m http.server 8000
```

y visita <http://localhost:8000>.

Si el repositorio se publica con GitHub Pages, la raíz sirve `index.html`
directamente.

## Navegación

| Acción | Teclas / control |
| --- | --- |
| Siguiente | `→`, `Espacio`, `PageDown` |
| Anterior | `←`, `PageUp` |
| Primera / última diapositiva | `Home` / `End` |
| Salir del esquemático | `Esc` |
| Pantalla completa | `F11` o botón **FULLSCREEN** |
| Ir a una diapositiva | Puntos de la barra inferior |
| Navegar en móvil | Deslizar horizontalmente |

En la diapositiva 17, las flechas recorren primero los pasos del esquemático
(25 en total); al llegar a un extremo, la presentación avanza o retrocede de
diapositiva. Al entrar en esa diapositiva desde atrás empieza por el primer
paso; al volver desde delante, por el último.

## Estilo visual

El deck toma como referencia la plantilla de presentaciones de Electronic Cats:

- **Tipografía:** Oswald para títulos y Roboto para cuerpo y listas.
- **Colores:** verde `#00BA84`, verde profundo `#044D2C`, azul petróleo
  `#1A5157`, blanco y acentos dorados `#C98A00`.
- **Fondos:** `assets/theme/cover-bg.png` para la apertura,
  `assets/theme/content-bg.png` para contenido y `assets/theme/title-bg.png`
  para la portada.
- **Logo:** `assets/theme/ec-logo-horizontal.png` para contenido y
  `assets/theme/ec-logo-horizontal-white.png` para la portada. Va separado del
  fondo y con margen de seguridad para que no se corte al proyectar.

La paleta y las fuentes están centralizadas al inicio de `styles.css`, en `:root`
y en los `@font-face`. Las fuentes se sirven localmente desde `assets/fonts/`,
así que no hace falta conexión a internet.

## Estructura

```text
.
├── index.html                          # Estructura y contenido de las 41 diapositivas
├── styles.css                          # Colores, tipografía, layout y animaciones
├── app.js                              # Navegación, dots, fullscreen y SchAnim
├── assets/
│   ├── badge/                          # Fotos del badge sin fondo (WebP)
│   ├── people/                         # Fotos de presentadores
│   ├── phone/                          # Capturas de la app Meshtastic (WebP)
│   ├── studio/                         # Captura de Badge Studio
│   ├── fonts/                          # Oswald + Roboto (WOFF2, local)
│   ├── theme/                          # Fondos y logo de Electronic Cats
│   └── schanim/
│       ├── badge_jsc2026.player.html   # Reproductor autocontenido del esquemático
│       └── schanim-host.js             # Puente postMessage entre deck y reproductor
├── .claude/skills/badge-web-control/   # Skill para crear páginas de control del badge
└── README.md
```

El reproductor del esquemático es un export independiente que se comunica con
el deck mediante `postMessage` a través de `SchAnimHost`. Esto permite que las
teclas, los botones y los gestos funcionen igual dentro y fuera del iframe.

## Editar

- **Contenido y orden de las diapositivas:** `index.html`. Cada `<section class="slide">`
  tiene un comentario `<!-- Diapositiva NN -->` para ubicarla rápido.
- **Colores, tipografía, espaciado y animaciones:** `styles.css`.
- **Navegación, dots, fullscreen y control del esquemático:** `app.js`.
- **Esquemático:** el reproductor se regenera por separado y se coloca en
  `assets/schanim/badge_jsc2026.player.html`; no requiere cambios en el deck
  mientras conserve el mismo nombre e id (`sa-badge`).

## Skill para el taller

`.claude/skills/badge-web-control/` es un skill de Claude Code que escribe una página
web (HTML + JavaScript, Web Serial) para controlar el badge por USB: mostrar texto,
pulsar botones, cambiar el nombre, leer el estado, capturar la pantalla y subir una
imagen. Para usarlo, copia la carpeta a `.claude/skills/` de tu proyecto y pide la
idea a tu agente. Incluye las librerías, una plantilla y la guía del protocolo.

## Créditos

- **Presentadores:** Andrés Sabas y Heikki Isa Perea Esparza
- **Organización:** Electronic Cats
- **Evento:** JSCONF 2026
