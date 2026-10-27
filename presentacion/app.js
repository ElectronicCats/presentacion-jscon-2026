/* ============================================================
   JSCONF 2026 · lógica del deck
   Navegación, dots, fullscreen y puente con el esquemático.
   ============================================================ */

"use strict";
const slides=[...document.querySelectorAll(".slide")];
const deck=document.getElementById("deck");
const dotsEl=document.getElementById("dots");
const counterEl=document.getElementById("counter");
const progressEl=document.getElementById("progress");
const bPrev=document.getElementById("bPrev");
const bNext=document.getElementById("bNext");
const bFull=document.getElementById("bFull");
const total=slides.length;
let current=0;

slides.forEach((_,i)=>{const d=document.createElement("div");d.className="dot";d.onclick=()=>goTo(i);dotsEl.appendChild(d)});

function goTo(i){
  const prevIndex=current;
  current=Math.max(0,Math.min(total-1,i));
  deck.style.transform=`translateX(-${current*100}vw)`;
  syncUI();
  schanimSlideChanged(prevIndex,current);
  tourSlideChanged(prevIndex,current);
}

function syncUI(){
  slides.forEach((s,i)=>s.classList.toggle("active",i===current));
  [...dotsEl.children].forEach((d,i)=>d.classList.toggle("on",i===current));
  counterEl.textContent=String(current+1).padStart(2,"0")+" / "+total;
  progressEl.style.width=(current/(total-1)*100)+"%";
  bPrev.disabled=current===0;bNext.disabled=current===total-1;
  // Mientras se recorre el esquemático, la barra se retira para dejarlo a pantalla completa.
  document.body.classList.toggle("on-schematic",!!(slides[current].dataset||{}).schanim);
  // La apertura de marca se ve limpia, sin barra de navegación.
  document.body.classList.toggle("on-cover",current===0);
}

let touchStartX=0;
deck.addEventListener("touchstart",e=>{touchStartX=e.touches[0].clientX},{passive:true});
deck.addEventListener("touchend",e=>{
  const dx=e.changedTouches[0].clientX-touchStartX;
  // next()/prev() y no goTo(): el gesto respeta la sincronización igual que las teclas.
  if(Math.abs(dx)>60) dx<0 ? next() : prev();
},{passive:true});

// Los botones usan next()/prev() por la misma razón que las teclas: si la
// diapositiva actual contiene un reproductor, avanzan la animación primero.
bPrev.onclick=()=>prev();
bNext.onclick=()=>next();
bFull.onclick=()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen()};

document.addEventListener("fullscreenchange",()=>{document.body.classList.toggle("fs",!!document.fullscreenElement)});

// ---------- SchAnim · la animación es parte del deck ----------
// Patrón de la skill schanim-embed: un reproductor por <section data-schanim="…">.
// Las teclas recorren primero los pasos del esquemático; cuando el reproductor se
// queda sin pasos avisa con onEdge y entonces la presentación pasa de diapositiva.
const players={};

if(window.SchAnimHost){
  document.querySelectorAll('[data-schanim]').forEach(section=>{
    const id=section.dataset.schanim;
    const frame=document.getElementById(id);
    if(!frame) return;
    players[id]=SchAnimHost.attach(frame,{
      onEdge:dir=>dir==="next" ? deckNext() : deckPrev(),
      // Al hacer clic dentro del esquema, el foco entra en el iframe y el documento
      // deja de recibir las teclas. Un clic dentro no produce ningún evento en la
      // página anfitriona, pero el reproductor sí avisa con 'state' cuando avanza.
      // Aprovechamos ese aviso para devolverle el foco al documento: así flechas,
      // botones y gestos se comportan siempre igual, y el clic ya lo había recibido
      // el reproductor (que avanza un paso por su cuenta).
      onState:()=>{ frame.blur(); window.focus(); }
    });
  });
}else{
  console.warn("schanim-host.js no se cargó: el esquemático solo responde con clic dentro del iframe.");
}

// El reproductor de la diapositiva actual, si esa diapositiva lo contiene.
const currentPlayer=()=>{
  const section=slides[current];
  const id=section && section.dataset ? section.dataset.schanim : null;
  return id ? players[id] : undefined;
};

function deckNext(){goTo(current+1)}
function deckPrev(){goTo(current-1)}

// ---------- Recorridos · pasos dentro de una diapositiva ----------
// Una <section data-tour> tiene elementos .spot y .tour-card con data-k = 1..N.
// El paso 0 es la vista general; las flechas recorren los pasos antes de cambiar de diapositiva.
const tourStep=new Map();
// El último paso es el mayor data-k (el paso 0 puede tener tarjeta propia).
const tourMax=s=>Math.max(0,...[...s.querySelectorAll(".tour-card")].map(c=>+c.dataset.k));
function setTour(s,step){
  tourStep.set(s,step);
  s.classList.toggle("tour",step>0);
  // El recorrido pasa del frente al reverso según el lado de la tarjeta del paso.
  const card=s.querySelector(`.tour-card[data-k="${step}"]`);
  s.classList.toggle("side-back",!!card && card.dataset.side==="back");
  // .on = el paso actual; .done = el paso actual y los anteriores (para animaciones acumulativas).
  s.querySelectorAll(".spot,.tour-card").forEach(el=>el.classList.toggle("on",+el.dataset.k===step));
  s.querySelectorAll(".spot").forEach(el=>el.classList.toggle("done",+el.dataset.k<=step));
  const now=s.querySelector(".tour-now"); if(now) now.textContent=step;
}
const currentTour=()=>{const s=slides[current];return s && s.dataset.tour ? s : null};
slides.filter(s=>s.dataset.tour).forEach(s=>setTour(s,0));

function next(){
  const p=currentPlayer(); if(p){p.next();return}
  const t=currentTour();
  if(t && tourStep.get(t)<tourMax(t)) setTour(t,tourStep.get(t)+1); else deckNext();
}
function prev(){
  const p=currentPlayer(); if(p){p.prev();return}
  const t=currentTour();
  if(t && tourStep.get(t)>0) setTour(t,tourStep.get(t)-1); else deckPrev();
}

// Igual que el esquemático: desde atrás se entra por el principio; desde delante, por el último paso.
function tourSlideChanged(prevIndex,nextIndex){
  const s=slides[nextIndex];
  if(!s || !s.dataset.tour) return;
  setTour(s, prevIndex<nextIndex ? 0 : tourMax(s));
}

// Al entrar en la diapositiva de la animación: desde atrás empieza al principio;
// desde delante, al final (así se ven las últimas etapas al retroceder).
function schanimSlideChanged(prevIndex,nextIndex){
  const section=slides[nextIndex];
  const id=section && section.dataset ? section.dataset.schanim : null;
  if(!id || !players[id]) return;
  const p=players[id];
  (prevIndex < nextIndex ? p.first() : p.last());
}

document.addEventListener("keydown",e=>{
  const fwd=e.key==="ArrowRight"||e.key===" "||e.key==="PageDown";
  const back=e.key==="ArrowLeft"||e.key==="PageUp";

  // Si el foco quedó dentro del iframe (el usuario hizo clic en el esquemático),
  // el reproductor atiende las flechas y solo devuelve el control al llegar al
  // borde. Escape es la salida directa y siempre está disponible.
  if(e.key==="Escape"){
    const p=currentPlayer();
    if(p){ e.preventDefault(); deckPrev(); return; }
  }

  if(fwd){e.preventDefault();next()}
  if(back){e.preventDefault();prev()}
  if(e.key==="Home")goTo(0);
  if(e.key==="End")goTo(total-1)
});

syncUI();
