# JSCON 2026 · Del enlace de radio a la red Meshtastic

Presentación de **Electronic Cats** para JSCON 2026. Explica cómo se pasa de un
enlace LoRa al funcionamiento de una red Meshtastic, y cómo el badge JSCON 2026
se integra como un nodo más de la malla.

El deck es un único archivo HTML autocontenido (CSS y JavaScript embebidos), sin
dependencias externas ni paso de compilación. Incluye un esquemático animado del
badge que se recorre con las mismas teclas de la presentación.

## Contenido

19 diapositivas:

1. Portada
2. Esquemático animado del badge JSCON 2026
3. Contenido de la presentación
4. ¿Qué es LoRa?
5. Chirp Spread Spectrum (CSS)
6. LoRaWAN: la capa de red
7. Lo que LoRa puede hacer
8. SF · BW · CR — la palanca de LoRa
9. Bluetooth — el enlace de corto alcance
10. USB — Serial Virtual (CDC)
11. Meshtastic — mensajería off-grid
12. Cliente · Router · (y híbridos)
13. Cada rol juega distinto
14. La malla se construye sola, salto a salto
15. Hardware + Software + Radio
16. Bluetooth: la interfaz humana del nodo
17. LoRa: la columna vertebral de la mesh
18. Del mensaje al chirp
19. El badge como nodo Meshtastic

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

En la diapositiva 2, las flechas recorren primero los pasos del esquemático
(25 en total); al llegar a un extremo, la presentación avanza o retrocede de
diapositiva. Al entrar en esa diapositiva desde atrás empieza por el primer
paso; al volver desde delante, por el último.

## Estructura

```text
.
├── index.html                          # Deck completo (19 diapositivas)
├── assets/
│   └── schanim/
│       ├── badge_jsc2026.player.html   # Reproductor autocontenido del esquemático
│       └── schanim-host.js             # Puente postMessage entre deck y reproductor
└── README.md
```

El reproductor del esquemático es un export independiente que se comunica con
el deck mediante `postMessage` a través de `SchAnimHost`. Esto permite que las
teclas, los botones y los gestos funcionen igual dentro y fuera del iframe.

## Editar

Todo el contenido y los estilos del deck están en `index.html`. El reproductor
del esquemático se regenera por separado y se coloca en
`assets/schanim/badge_jsc2026.player.html`; no requiere cambios en el deck
mientras conserve el mismo nombre e id (`sa-badge`).

## Créditos

- **Presentador:** Heikki Isa Perea Esparza
- **Organización:** Electronic Cats
- **Evento:** JSCON 2026
