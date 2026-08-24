/* LLcreativity — hero engine
   A camera dolly through a dark gallery of glowing interface monoliths,
   rendered on canvas with a hand-rolled perspective projection and
   driven entirely by scroll (see main.js). No assets, nothing to 404. */
(() => {
  "use strict";

  const TAU = Math.PI * 2;

  // ---- palette ------------------------------------------------------
  const GOLD = "196,165,116";
  const INK = "234,230,222";

  // ---- world layout -------------------------------------------------
  const HALL_X = 3.1;      // corridor half-width
  const FLOOR_Y = 2.0;
  const CEIL_Y = -2.4;
  const HALL_LEN = 62;
  const CAM_TRAVEL = 45;   // camera z at progress 1
  const NEAR = 0.42;
  const FOG_START = 2.5;
  const FOG_END = 30;

  // seeded pseudo-random so every load renders the same film
  function makeRand(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // ---- monolith definitions ----------------------------------------
  function buildMonoliths() {
    const rand = makeRand(7);
    const list = [];
    const types = ["dash", "lines", "grid", "lines", "dash", "grid", "lines", "dash"];
    const numbers = ["$2.4M", "3.1×", "$14M", "+19%", "−28%", "2.1×", "+74%", "$22M"];
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      list.push({
        side,
        z: 7 + i * 6 + rand() * 1.4,
        cx: side * 2.45,
        cy: -0.18 + (rand() - 0.5) * 0.3,
        w: 2.0 + rand() * 0.5,
        h: 1.35 + rand() * 0.25,
        tilt: side * (0.32 + rand() * 0.1), // yaw toward corridor center
        type: types[i],
        num: numbers[i],
        seed: i * 31 + 5,
      });
    }
    // the terminal monolith the camera lands on
    list.push({
      side: 0, z: 51.5, cx: 0, cy: -0.22, w: 3.5, h: 2.15,
      tilt: 0, type: "final", num: "+41%", seed: 99,
    });
    return list;
  }

  class HeroScene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.progress = 0;      // scrub target 0..1
      this.shown = 0;         // eased progress actually rendered
      this.px = 0; this.py = 0;         // pointer target -1..1
      this.sx = 0; this.sy = 0;         // eased pointer
      this.t = 0;             // idle drift clock
      this.running = false;
      this.monoliths = buildMonoliths();
      this.resize();
      window.addEventListener("resize", () => { this.resize(); this.render(); }, { passive: true });
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const { clientWidth: w, clientHeight: h } = this.canvas;
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
      this.dpr = dpr;
      this.w = this.canvas.width;
      this.h = this.canvas.height;
      this.f = this.h * 0.92; // focal length
      this.vignette = null;   // rebuild lazily
    }

    setProgress(p) { this.progress = Math.min(1, Math.max(0, p)); }
    setPointer(x, y) { this.px = x; this.py = y; }

    start() {
      if (this.running) return;
      this.running = true;
      const loop = () => {
        if (!this.running) return;
        this.t += 0.016;
        this.shown += (this.progress - this.shown) * 0.09;
        this.sx += (this.px - this.sx) * 0.05;
        this.sy += (this.py - this.sy) * 0.05;
        this.render();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }
    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
    }

    // project a world point; returns null when behind the near plane
    proj(x, y, z) {
      const rz = z - this.camZ;
      if (rz < NEAR) return null;
      const s = this.f / rz;
      return {
        x: this.w / 2 + (x - this.camX) * s,
        y: this.h / 2 + (y - this.camY) * s,
        s,
        rz,
      };
    }

    fog(rz) {
      return Math.min(1, Math.max(0, 1 - (rz - FOG_START) / (FOG_END - FOG_START)));
    }

    quad(p1, p2, p3, p4, fill, stroke, lw) {
      const c = this.ctx;
      c.beginPath();
      c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y);
      c.lineTo(p3.x, p3.y); c.lineTo(p4.x, p4.y);
      c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
    }

    seg(a, b, stroke, lw) {
      const c = this.ctx;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke();
    }

    render() {
      const c = this.ctx;
      const { w, h } = this;
      const p = this.shown;

      // camera: eased dolly + pointer sway + faint idle breath
      const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      this.camZ = ease * CAM_TRAVEL;
      this.camX = this.sx * 0.34 + Math.sin(this.t * 0.4) * 0.02;
      this.camY = this.sy * 0.18 + Math.cos(this.t * 0.31) * 0.014;

      // -- backdrop ----------------------------------------------------
      const bg = c.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#060606");
      bg.addColorStop(0.55, "#0A0A0B");
      bg.addColorStop(1, "#070707");
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);

      // light at the end of the corridor, warming as we approach
      const endP = this.proj(0, -0.1, HALL_LEN);
      if (endP) {
        const r = Math.min(w, h) * (0.28 + p * 0.55);
        const glow = c.createRadialGradient(endP.x, endP.y, 0, endP.x, endP.y, r);
        glow.addColorStop(0, `rgba(${GOLD},${0.10 + p * 0.16})`);
        glow.addColorStop(0.5, `rgba(${GOLD},${0.03 + p * 0.05})`);
        glow.addColorStop(1, "rgba(196,165,116,0)");
        c.fillStyle = glow;
        c.fillRect(0, 0, w, h);
      }

      // -- floor / ceiling grid ---------------------------------------
      const zStart = Math.max(this.camZ + NEAR + 0.15, 0);
      const zFar = Math.min(this.camZ + FOG_END, HALL_LEN);
      // longitudinal rails
      for (let xi = -4; xi <= 4; xi++) {
        const x = (xi / 4) * HALL_X;
        for (const y of [FLOOR_Y, CEIL_Y]) {
          const a = this.proj(x, y, zStart + 0.25);
          const b = this.proj(x, y, zFar);
          if (a && b) this.seg(a, b, `rgba(${INK},0.045)`, 1);
        }
      }
      // cross ties, fading with distance
      for (let z = Math.ceil(zStart / 4) * 4; z <= zFar; z += 4) {
        const fA = this.fog(z - this.camZ) * 0.09;
        if (fA <= 0.004) continue;
        for (const y of [FLOOR_Y, CEIL_Y]) {
          const a = this.proj(-HALL_X, y, z);
          const b = this.proj(HALL_X, y, z);
          if (a && b) this.seg(a, b, `rgba(${INK},${fA})`, 1);
        }
      }

      // -- columns -----------------------------------------------------
      for (let z = 6; z <= HALL_LEN - 4; z += 6) {
        const rz = z - this.camZ;
        if (rz < NEAR || rz > FOG_END) continue;
        const fA = this.fog(rz);
        for (const side of [-1, 1]) {
          const x = side * HALL_X;
          const t1 = this.proj(x, CEIL_Y, z), t2 = this.proj(x, CEIL_Y, z + 0.5);
          const b2 = this.proj(x, FLOOR_Y, z + 0.5), b1 = this.proj(x, FLOOR_Y, z);
          if (t1 && t2 && b2 && b1) {
            this.quad(t1, t2, b2, b1, `rgba(10,10,11,${0.9 * fA})`, `rgba(${INK},${0.06 * fA})`, 1);
            // one champagne edge, catching the light
            this.seg(t1, b1, `rgba(${GOLD},${0.16 * fA})`, 1);
          }
        }
      }

      // -- monoliths (far to near) ------------------------------------
      const sorted = [...this.monoliths].sort((m1, m2) => m2.z - m1.z);
      for (const m of sorted) this.drawMonolith(m);

      // -- vignette ----------------------------------------------------
      if (!this.vignette) {
        const v = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.74);
        v.addColorStop(0, "rgba(7,7,7,0)");
        v.addColorStop(1, "rgba(5,5,5,0.62)");
        this.vignette = v;
      }
      c.fillStyle = this.vignette;
      c.fillRect(0, 0, w, h);
    }

    drawMonolith(m) {
      const c = this.ctx;
      const rz = m.z - this.camZ;
      if (rz < NEAR + 0.1 || rz > FOG_END + 6) return;
      const fA = m.type === "final"
        ? Math.min(1, Math.max(0, 1 - (rz - 3) / 34))
        : this.fog(rz);
      if (fA <= 0.01) return;

      // panel basis: right vector rotated by tilt around Y
      const cos = Math.cos(m.tilt), sin = Math.sin(m.tilt);
      const rx = cos, rzv = -sin; // right vector (x,z)
      const hw = m.w / 2, hh = m.h / 2;
      const P = (u, v) => this.proj(m.cx + rx * u, m.cy + v, m.z + rzv * u);
      const c1 = P(-hw, -hh), c2 = P(hw, -hh), c3 = P(hw, hh), c4 = P(-hw, hh);
      if (!c1 || !c2 || !c3 || !c4) return;

      // soft emissive backing
      const mid = P(0, 0);
      if (mid) {
        const r = Math.abs(c2.x - c1.x) * 0.9 + 40;
        const glow = c.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, r);
        const tone = m.type === "final" ? GOLD : INK;
        glow.addColorStop(0, `rgba(${tone},${0.05 * fA})`);
        glow.addColorStop(1, `rgba(${tone},0)`);
        c.fillStyle = glow;
        c.fillRect(mid.x - r, mid.y - r, r * 2, r * 2);
      }

      // slab
      this.quad(c1, c2, c3, c4, `rgba(13,13,14,${0.94 * fA})`, `rgba(${INK},${0.13 * fA})`, 1);
      // hairline top light
      this.seg(c1, c2, `rgba(${GOLD},${0.28 * fA})`, 1);

      // content in panel-local coordinates
      const rand = makeRand(m.seed);
      const line = (u1, v1, u2, v2, alpha, lw, gold) => {
        const a = P(u1, v1), b = P(u2, v2);
        if (a && b) this.seg(a, b, `rgba(${gold ? GOLD : INK},${alpha * fA})`, lw || 1);
      };
      const label = (u, v, text, size, alpha, gold) => {
        const pt = P(u, v);
        if (!pt) return;
        c.fillStyle = `rgba(${gold ? GOLD : INK},${alpha * fA})`;
        c.font = `500 ${Math.max(6, pt.s * size)}px Archivo, "Helvetica Neue", Arial, sans-serif`;
        c.textBaseline = "middle";
        c.fillText(text, pt.x, pt.y);
      };

      const padU = hw * 0.82, padTop = hh * 0.72;

      if (m.type === "dash" || m.type === "final") {
        label(-padU, -padTop, m.type === "final" ? "CONVERSION · 90 DAYS" : "REVENUE / WEEK", m.type === "final" ? 0.085 : 0.07, 0.5);
        label(-padU, -padTop + hh * 0.62, m.num, m.type === "final" ? 0.52 : 0.42, 0.95, true);
        // spark line
        const n = 8, u0 = -padU, u1 = padU;
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const u = u0 + ((u1 - u0) * i) / n;
          const v = hh * 0.28 - (i / n) * hh * 0.34 - rand() * hh * 0.09;
          const pt = P(u, v);
          if (prev && pt) this.seg(prev, pt, `rgba(${GOLD},${0.55 * fA})`, Math.max(1, pt.s * 0.014));
          prev = pt;
        }
        line(-padU, hh * 0.56, -padU + hw * 0.9, hh * 0.56, 0.3);
        line(-padU, hh * 0.7, -padU + hw * 1.2, hh * 0.7, 0.2);
      } else if (m.type === "lines") {
        for (let i = 0; i < 5; i++) {
          const v = -padTop + i * hh * 0.32;
          line(-padU, v, -padU + hw * (0.7 + rand() * 1.0), v, i === 0 ? 0.55 : 0.28, i === 0 ? 2 : 1);
        }
        // gold chip
        const chipV = padTop - hh * 0.1;
        line(-padU, chipV, -padU + hw * 0.5, chipV, 0.8, Math.max(1.5, (P(0, 0)?.s || 60) * 0.05), true);
      } else if (m.type === "grid") {
        for (let gi = 0; gi < 6; gi++) {
          const col = gi % 3, row = Math.floor(gi / 3);
          const u = -padU + col * hw * 0.62;
          const v = -padTop + row * hh * 0.72;
          const gw = hw * 0.5, gh = hh * 0.55;
          const q1 = P(u, v), q2 = P(u + gw, v), q3 = P(u + gw, v + gh), q4 = P(u, v + gh);
          if (q1 && q2 && q3 && q4) {
            const isGold = gi === 4;
            this.quad(q1, q2, q3, q4,
              isGold ? `rgba(${GOLD},${0.2 * fA})` : `rgba(${INK},${0.045 * fA})`,
              `rgba(${INK},${0.1 * fA})`, 1);
          }
        }
      }
    }
  }

  window.LLHeroScene = HeroScene;
})();
