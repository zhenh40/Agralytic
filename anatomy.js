/*
 * Interactive 3D exploded leaf anatomy (CSS 3D, drag to rotate, click a layer).
 * Highlights the tissue layer that the diagnosed pathogen attacks.
 */
(function () {
  'use strict';
  const LAYERS = [
    { id: 'cuticle', name: 'Cuticle', color: 'linear-gradient(135deg,#d9f99d,#a3e635)', info: 'A waxy waterproof coat. It is the first barrier — fungi need special tools (appressoria) to break through it.' },
    { id: 'upper', name: 'Upper epidermis', color: 'linear-gradient(135deg,#86efac,#4ade80)', info: 'A transparent single layer of cells that lets light pass to the cells below.' },
    { id: 'palisade', name: 'Palisade mesophyll', color: 'linear-gradient(135deg,#22c55e,#15803d)', info: 'Tall cells packed with chloroplasts. ~70% of photosynthesis happens here. Powdery mildew and rust steal sugar from these cells.' },
    { id: 'spongy', name: 'Spongy mesophyll', color: 'linear-gradient(135deg,#16a34a,#14532d)', info: 'Loose cells with air spaces for gas exchange. Bacteria and water moulds multiply in these wet spaces.' },
    { id: 'vein', name: 'Vascular bundle (xylem & phloem)', color: 'linear-gradient(135deg,#a16207,#713f12)', info: 'Pipes that carry water (xylem) up and sugars (phloem) down. Viruses travel through the phloem to the whole plant.' },
    { id: 'lower', name: 'Lower epidermis + stomata', color: 'linear-gradient(135deg,#4ade80,#166534)', info: 'Contains stomata — adjustable pores for CO₂ and water vapour. Bacteria and zoospores sneak in here.' }
  ];
  const TARGET = { fungal: ['cuticle', 'palisade'], oomycete: ['lower', 'spongy'], bacterial: ['lower', 'spongy'], viral: ['palisade', 'vein'], abiotic: ['palisade'], none: [] };

  function mount(el, infoEl, type = 'none') {
    el.classList.add('anatomy');
    el.innerHTML = '<div class="stack3d"></div>';
    const stack = el.firstElementChild;
    const targets = TARGET[type] || [];
    let rx = 58, rz = -32, spread = 1;
    LAYERS.forEach((l, i) => {
      const d = document.createElement('div');
      d.className = 'layer' + (targets.includes(l.id) ? ' infected' : '');
      d.style.background = l.color; d.dataset.i = i; d.textContent = l.name + (targets.includes(l.id) ? '  ⚠' : '');
      d.tabIndex = 0;
      d.onclick = d.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter') return; select(i); };
      stack.appendChild(d);
    });
    const layers = Array.from(stack.children);
    function layout() {
      stack.style.transform = `rotateX(${rx}deg) rotateZ(${rz}deg)`;
      layers.forEach((d, i) => { d.style.transform = `translateZ(${(LAYERS.length / 2 - i) * 44 * spread}px)`; d.style.opacity = 0.93; });
    }
    function select(i) {
      layers.forEach((d) => d.classList.remove('sel')); layers[i].classList.add('sel');
      const l = LAYERS[i];
      infoEl.innerHTML = `<b>${l.name}</b>${targets.includes(l.id) ? ' <span class="chip red">attacked by this pathogen</span>' : ''}<p class="muted small" style="margin-top:6px">${l.info}</p>`;
    }
    let drag = null;
    el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, rx, rz }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => { if (!drag) return; rz = drag.rz + (e.clientX - drag.x) * 0.4; rx = Math.max(10, Math.min(85, drag.rx - (e.clientY - drag.y) * 0.3)); layout(); });
    el.addEventListener('pointerup', () => { drag = null; });
    layout();
    select(targets.length ? LAYERS.findIndex((l) => l.id === targets[0]) : 2);
    return { setSpread(v) { spread = v; layout(); } };
  }
  window.AgraAnatomy = { mount, LAYERS, TARGET };
})();
