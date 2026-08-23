/* MERIDIAN — motion layer
   Everything here is decoration: the site is fully usable with JS off,
   and fully static under prefers-reduced-motion. */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Year ---------- */
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  /* ---------- Section reveals ---------- */
  const revealEls = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("in-view"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  if (reduceMotion) return; // nothing below runs for reduced-motion users

  /* ---------- rAF-throttled scroll state ---------- */
  const progressBar = document.getElementById("progress-bar");
  const header = document.getElementById("site-header");
  const stage = document.getElementById("hero-stage");
  const plates = stage ? Array.from(stage.querySelectorAll(".plate")) : [];
  const parallaxEls = Array.from(document.querySelectorAll("[data-parallax]"));

  let lastY = window.scrollY;
  let ticking = false;
  let pointerX = 0; // -1 … 1, eased
  let pointerY = 0;
  let targetPX = 0;
  let targetPY = 0;

  // Base pose for each hero plate; scroll scrubs rotation/lift on top of it.
  const poses = [
    { rx: 6, ry: -14, z: 0, drift: -60 },
    { rx: 4, ry: 10, z: -120, drift: -110 },
    { rx: 10, ry: -6, z: -220, drift: -160 },
  ];

  function frame() {
    ticking = false;
    const y = window.scrollY;
    const vh = window.innerHeight;
    const docH = document.documentElement.scrollHeight - vh;

    // 1 · progress bar
    if (progressBar && docH > 0) {
      progressBar.style.transform = `scaleX(${Math.min(y / docH, 1)})`;
    }

    // 2 · header hides scrolling down, returns scrolling up
    if (header) {
      header.classList.toggle("hidden", y > lastY && y > vh * 0.6);
    }
    lastY = y;

    // 3 · hero scrub — plates recede and tilt as the hero scrolls away
    if (plates.length) {
      const t = Math.min(y / vh, 1); // 0 at top → 1 once hero has passed
      pointerX += (targetPX - pointerX) * 0.06;
      pointerY += (targetPY - pointerY) * 0.06;
      plates.forEach((plate, i) => {
        const p = poses[i] || poses[0];
        const rx = p.rx + t * 10 + pointerY * -2.5;
        const ry = p.ry + pointerX * 3.5;
        const tz = p.z - t * 180;
        const ty = t * p.drift;
        plate.style.transform =
          `translate3d(0, ${ty.toFixed(1)}px, 0) rotateX(${rx.toFixed(2)}deg) ` +
          `rotateY(${ry.toFixed(2)}deg) translateZ(${tz.toFixed(1)}px)`;
        plate.style.opacity = String(1 - t * 0.9);
      });
    }

    // 4 · two-depth parallax, translation capped at 8% of viewport height
    const cap = vh * 0.08;
    for (const el of parallaxEls) {
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const offset = (mid - vh / 2) / vh; // -0.5 … 0.5 around center
      const factor = parseFloat(el.dataset.parallax) || 0.05;
      const shift = Math.max(-cap, Math.min(cap, -offset * factor * vh));
      el.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
    }
  }

  function requestFrame() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(frame);
    }
  }

  window.addEventListener("scroll", requestFrame, { passive: true });
  window.addEventListener("resize", requestFrame, { passive: true });

  /* Pointer drift for the hero stage (fine pointers only) */
  if (stage && window.matchMedia("(pointer: fine)").matches) {
    window.addEventListener(
      "pointermove",
      (e) => {
        targetPX = (e.clientX / window.innerWidth) * 2 - 1;
        targetPY = (e.clientY / window.innerHeight) * 2 - 1;
        requestFrame();
      },
      { passive: true }
    );
  }

  /* ---------- Magnetic buttons ---------- */
  if (window.matchMedia("(pointer: fine)").matches) {
    document.querySelectorAll(".magnetic").forEach((btn) => {
      const strength = 7; // px, deliberately subtle
      btn.addEventListener("pointermove", (e) => {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        btn.style.transform = `translate(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px)`;
      });
      btn.addEventListener("pointerleave", () => {
        btn.style.transition = "transform .5s cubic-bezier(.22,1,.36,1)";
        btn.style.transform = "translate(0, 0)";
        setTimeout(() => { btn.style.transition = ""; }, 500);
      });
    });
  }

  requestFrame();
})();
