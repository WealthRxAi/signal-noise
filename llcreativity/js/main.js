/* LLcreativity — motion direction
   Lenis inertia + GSAP ScrollTrigger. Four pinned set pieces:
   hero cinema, work reel, philosophy, process stills. */
(() => {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const q = (s, c) => (c || document).querySelector(s);
  const qa = (s, c) => Array.from((c || document).querySelectorAll(s));

  const year = q("#year");
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------- split [data-split] into word spans ---------- */
  function splitWords(container) {
    const frag = document.createDocumentFragment();
    const push = (word, italic) => {
      const w = document.createElement("span");
      w.className = "w";
      const wi = document.createElement("span");
      wi.className = "wi" + (italic ? " it" : "");
      wi.textContent = word;
      w.appendChild(wi);
      frag.appendChild(w);
      frag.appendChild(document.createTextNode(" "));
    };
    Array.from(container.childNodes).forEach((node) => {
      const italic = node.nodeType === 1;
      node.textContent.trim().split(/\s+/).filter(Boolean).forEach((word) => push(word, italic));
    });
    container.textContent = "";
    container.appendChild(frag);
  }
  qa("[data-split]").forEach(splitWords);

  /* ---------- hero scene (canvas engine) ---------- */
  const canvas = q("#hero-canvas");
  const scene = canvas && window.LLHeroScene ? new window.LLHeroScene(canvas) : null;
  if (scene && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => scene.render());
  }

  /* ---------- magnetic buttons ---------- */
  if (finePointer && !reduced) {
    qa(".magnetic").forEach((btn) => {
      const strength = 9;
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        btn.style.transform = `translate(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px)`;
      });
      btn.addEventListener("pointerleave", () => {
        btn.style.transition = "transform .5s cubic-bezier(.22,1,.36,1)";
        btn.style.transform = "translate(0,0)";
        setTimeout(() => { btn.style.transition = ""; }, 500);
      });
    });
  }

  /* ---------- stat count-ups ---------- */
  function primeStat(el) {
    const dec = parseInt(el.dataset.decimals || "0", 10);
    el.textContent = (el.dataset.prefix || "") + (0).toFixed(dec) + (el.dataset.suffix || "");
  }
  function countUp(el) {
    const to = parseFloat(el.dataset.to);
    const dec = parseInt(el.dataset.decimals || "0", 10);
    const pre = el.dataset.prefix || "";
    const suf = el.dataset.suffix || "";
    const obj = { v: 0 };
    gsap.to(obj, {
      v: to, duration: 1.8, ease: "power3.out",
      onUpdate: () => { el.textContent = pre + obj.v.toFixed(dec) + suf; },
    });
  }

  /* ---------- reduced motion: a stately, static edit ---------- */
  if (reduced || !window.gsap) {
    if (scene) { scene.shown = 0.32; scene.progress = 0.32; scene.render(); }
    return; // layout is complete without any motion
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ---------- Lenis inertia ---------- */
  const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  qa('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = q(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: 0, duration: 1.4 });
    });
  });

  /* ---------- chrome: progress bar + header ---------- */
  gsap.to("#pbar", {
    scaleX: 1, ease: "none",
    scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
  });
  ScrollTrigger.create({
    start: 80, end: "max",
    toggleClass: { targets: "#site-header", className: "scrolled" },
  });

  /* ---------- simple reveals ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in-view"); io.unobserve(en.target); }
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
  qa(".reveal").forEach((el) => io.observe(el));

  /* ══════════ ACT 1 · HERO CINEMA (pin ~260vh, scroll owns the camera) ══════════ */
  const heroWords = qa(".hero-title .wi");

  gsap.timeline({ delay: 0.2 })
    .fromTo(".hero-kicker", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" })
    .fromTo(heroWords,
      { y: 0, yPercent: 120, rotate: 5, opacity: 0, filter: "blur(10px)" },
      { y: 0, yPercent: 0, rotate: 0, opacity: 1, filter: "blur(0px)", duration: 1.15, ease: "power4.out", stagger: 0.055 }, 0.1)
    .to(".hero-rule", { width: 200, duration: 1.2, ease: "power3.inOut" }, 0.7)
    .fromTo("#scroll-hint", { opacity: 0 }, { opacity: 1, duration: 0.8 }, 1.3)
    .fromTo(".hero-corner", { opacity: 0 }, { opacity: 1, duration: 0.8 }, 1.4);

  const heroTl = gsap.timeline({
    defaults: { ease: "power2.in" },
    scrollTrigger: {
      trigger: "#hero",
      start: "top top",
      end: "+=260%",
      pin: true,
      scrub: 0.55,
      anticipatePin: 1,
      onUpdate: (self) => scene && scene.setProgress(self.progress),
      onToggle: (self) => scene && (self.isActive ? scene.start() : scene.stop()),
    },
  });
  heroTl
    .to(".hero-kicker", { opacity: 0, y: -26, duration: 1.4 }, 5.0)
    .to(".hero-title .line", { yPercent: -110, opacity: 0, filter: "blur(8px)", stagger: 0.35, duration: 2.2 }, 5.1)
    .to(".hero-rule", { opacity: 0, duration: 1.2 }, 5.2)
    .to(".hero-corner", { opacity: 0, duration: 1 }, 5.0)
    .to(".hero-veil", { opacity: 0.92, duration: 2.2, ease: "none" }, 7.6)
    .to({}, { duration: 0.4 });

  if (scene) scene.start();

  if (finePointer) {
    window.addEventListener("pointermove", (e) => {
      if (!scene) return;
      scene.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    }, { passive: true });
  }

  // the scroll hint leaves after the first movement and does not return
  ScrollTrigger.create({
    start: 10, once: true,
    onEnter: () => gsap.to("#scroll-hint", { opacity: 0, y: 14, duration: 0.7, ease: "power2.out" }),
  });

  /* ══════════ ACT 2 · WORK REEL (pinned horizontal scrub) ══════════ */
  const reel = q("#reel");
  const track = q("#reel-track");
  q(".work").classList.add("reel-active");
  qa(".num", track).forEach(primeStat);

  const reelDist = () => track.scrollWidth - window.innerWidth;
  const reelTween = gsap.to(track, {
    x: () => -reelDist(),
    ease: "none",
    scrollTrigger: {
      trigger: reel,
      start: "top top",
      end: () => "+=" + reelDist(),
      pin: true,
      scrub: 0.6,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  });

  qa(".panel", track).forEach((panel) => {
    const img = q(".env img", panel);
    const env = q(".env", panel);
    const shot = q(".site-shot", panel);
    const copy = q(".panel-copy", panel);

    // media drifts against travel — parallax under 10%
    gsap.fromTo(img, { xPercent: -6 }, {
      xPercent: 6, ease: "none",
      scrollTrigger: { trigger: panel, containerAnimation: reelTween, start: "left right", end: "right left", scrub: true },
    });

    // frame opens as the panel arrives
    gsap.fromTo(env, { clipPath: "inset(12% 8% 12% 8%)" }, {
      clipPath: "inset(0% 0% 0% 0%)", ease: "none",
      scrollTrigger: { trigger: panel, containerAnimation: reelTween, start: "left 90%", end: "left 25%", scrub: true },
    });
    gsap.fromTo(shot, { yPercent: 16, opacity: 0 }, {
      yPercent: 0, opacity: 1, ease: "none",
      scrollTrigger: { trigger: panel, containerAnimation: reelTween, start: "left 60%", end: "left 15%", scrub: true },
    });
    gsap.fromTo(copy, { y: 40, opacity: 0.2 }, {
      y: 0, opacity: 1, ease: "none",
      scrollTrigger: { trigger: panel, containerAnimation: reelTween, start: "left 85%", end: "left 35%", scrub: true },
    });

    ScrollTrigger.create({
      trigger: panel, containerAnimation: reelTween, start: "left 70%", once: true,
      onEnter: () => qa(".num", panel).forEach(countUp),
    });
  });

  /* ══════════ ACT 3 · PHILOSOPHY (pinned statement) ══════════ */
  const phil = q(".philosophy");
  phil.classList.add("phil-active");
  const wordsA = qa(".phil-a .wi");
  const wordsB = qa(".phil-b .wi");

  const philTl = gsap.timeline({
    scrollTrigger: {
      trigger: phil, start: "top top", end: "+=220%",
      pin: true, scrub: 0.6, anticipatePin: 1,
    },
  });
  philTl
    .fromTo(".phil-bg img", { scale: 1.16, yPercent: -4 }, { scale: 1.02, yPercent: 4, ease: "none", duration: 10 }, 0)
    .fromTo(wordsA,
      { y: 0, yPercent: 120, rotate: 4, opacity: 0, filter: "blur(8px)" },
      { y: 0, yPercent: 0, rotate: 0, opacity: 1, filter: "blur(0px)", stagger: 0.18, duration: 1.6, ease: "power2.out" }, 0.4)
    .to(".phil-a", { opacity: 0, y: -46, filter: "blur(8px)", duration: 1.5, ease: "power2.in" }, 4.0)
    .set(".phil-b", { opacity: 1 }, 5.4)
    .fromTo(wordsB,
      { y: 0, yPercent: 120, rotate: 4, opacity: 0, filter: "blur(8px)" },
      { y: 0, yPercent: 0, rotate: 0, opacity: 1, filter: "blur(0px)", stagger: 0.16, duration: 1.5, ease: "power2.out" }, 5.5)
    .fromTo(".phil-money",
      { opacity: 0, scale: 0.9, filter: "blur(10px)" },
      { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.6, ease: "power2.out" }, 7.2)
    .to({}, { duration: 1.2 });

  gsap.set(".phil-b", { opacity: 0 });

  /* ══════════ ACT 4 · PROCESS (pinned film stills) ══════════ */
  const process = q(".process");
  const stills = qa(".still", process);
  process.classList.add("proc-active");

  stills.forEach((st, i) => {
    gsap.set(st, { clipPath: i === 0 ? "inset(0% 0 0% 0)" : "inset(100% 0 0% 0)", zIndex: i + 1 });
  });

  const procTl = gsap.timeline({
    scrollTrigger: {
      trigger: process, start: "top top", end: "+=320%",
      pin: true, scrub: 0.6, anticipatePin: 1,
    },
  });
  procTl.fromTo(q(".still-copy", stills[0]), { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 1.2, ease: "power2.out" }, 0.1);
  stills.forEach((st, i) => {
    if (i === 0) return;
    const at = (i - 1) * 2.8 + 1.6;
    procTl
      .fromTo(st, { clipPath: "inset(100% 0 0% 0)" }, { clipPath: "inset(0% 0 0% 0)", ease: "none", duration: 1.8 }, at)
      .fromTo(q("img", st), { yPercent: 12, scale: 1.08 }, { yPercent: 0, scale: 1, ease: "none", duration: 1.8 }, at)
      .fromTo(q(".still-copy", st), { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: 1.3, ease: "power2.out" }, at + 0.55);
  });
  procTl.to({}, { duration: 1.0 });

  /* ---------- keep measurements honest ---------- */
  window.addEventListener("load", () => ScrollTrigger.refresh());
})();
