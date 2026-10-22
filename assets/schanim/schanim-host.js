/* SchAnim · control de un reproductor incrustado desde la página anfitriona (sin dependencias).
   const sa = SchAnimHost.attach(iframe, { onReady, onState, onEdge, onError });
   sa.next() · sa.prev() · sa.goto(n) (0 = la primera) · sa.first() · sa.last() · sa.state (último estado conocido)
   onEdge(dir, state): el reproductor no tiene más pasos en esa dirección ('next' o 'prev'): la página decide (p. ej. su
   siguiente diapositiva). state = { slide, slides, step, steps, name, atStart, atEnd }. */
(function (g) {
  function attach(iframe, opts) {
    opts = opts || {};
    var api = {
      iframe: iframe, state: null, ready: false,
      send: function (cmd, extra) { var w = iframe.contentWindow; if (w) w.postMessage(Object.assign({ schanim: cmd }, extra || {}), '*'); },
      next: function () { api.send('next'); }, prev: function () { api.send('prev'); },
      first: function () { api.send('first'); }, last: function () { api.send('last'); },
      goto: function (slide, animate) { api.send('goto', { slide: slide, animate: animate !== false }); },
      // devuelve el foco a la página (las teclas vuelven a ir a la presentación anfitriona)
      release: function () { try { iframe.blur(); } catch (_) { } window.focus(); }
    };
    window.addEventListener('message', function (ev) {
      var m = ev.data; if (ev.source !== iframe.contentWindow || !m || m.schanim !== true) return;
      if (m.state) api.state = m.state;
      if (m.event === 'ready') { api.ready = true; if (opts.onReady) opts.onReady(m.state); }
      else if (m.event === 'state') { if (opts.onState) opts.onState(m.state); }
      else if (m.event === 'edge') { api.release(); if (opts.onEdge) opts.onEdge(m.dir, m.state); }
      else if (m.event === 'error' && opts.onError) opts.onError(m.message);
    });
    return api;
  }
  g.SchAnimHost = { attach: attach };
})(window);
