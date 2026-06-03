(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // === Reveal-on-scroll (data-reveal + data-reveal-stagger) ===
  const reveals = $$('[data-reveal]');
  reveals.forEach((el) => {
    const s = parseInt(el.dataset.revealStagger || '0', 10);
    el.style.setProperty('--stagger', s);
  });
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-in'));
  }

  // === Rail dot active state via IntersectionObserver ===
  const slides = $$('.mll-pr-slide');
  const railLinks = $$('.mll-pr-rail__dots a');
  if ('IntersectionObserver' in window && slides.length) {
    const ioActive = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          const id = e.target.id;
          railLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${id}`));
        }
      });
    }, { threshold: 0.55 });
    slides.forEach((s) => ioActive.observe(s));
  }

  // === Parallax on hero bg images ===
  if (!reduceMotion) {
    const bgs = $$('.mll-pr-hero-bg');
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        bgs.forEach((bg) => {
          const slide = bg.closest('.mll-pr-slide');
          if (!slide) return;
          const rect = slide.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > window.innerHeight) return;
          const offset = (y - slide.offsetTop) * 0.18;
          bg.style.transform = `translate3d(0, ${offset}px, 0) scale(1.08)`;
        });
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // === Design switch with veil crossfade (no jarring page swap) ===
  const sel = $('[data-design-switch]');
  const veil = $('[data-pr-veil]');
  if (sel) {
    sel.addEventListener('change', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('design', sel.value);
      const hash = window.location.hash || '';
      if (veil && !reduceMotion) {
        veil.classList.add('is-on');
        setTimeout(() => { window.location.href = url.toString() + hash; }, 360);
      } else {
        window.location.href = url.toString() + hash;
      }
    });
  }

  // === Fade-in on first paint when SD image arrives ===
  $$('.mll-pr-hero-bg').forEach((bg) => {
    const url = (bg.style.backgroundImage.match(/url\(["']?([^"')]+)/) || [])[1];
    if (!url) return;
    const img = new Image();
    img.onload = () => bg.classList.add('is-loaded');
    img.onerror = () => bg.classList.add('is-loaded');
    img.src = url;
  });
})();
