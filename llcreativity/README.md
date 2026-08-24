# LLcreativity — a scroll film

Cinematic one-page site for LLcreativity, a black-and-grey design studio that
only builds websites for $1M–$50M+ companies. The page is a short film you
scroll through: four pinned, scrub-driven set pieces on GSAP ScrollTrigger
with Lenis inertia.

## Run it

Production static build — no bundler, no install. GSAP 3.15, ScrollTrigger,
and Lenis 1.3 are vendored in `lib/`.

```bash
cd llcreativity && python3 -m http.server 8000
# → http://localhost:8000
```

Deploy by pointing any static host at the `llcreativity/` directory.

## The film

| Act | Set piece | Mechanism |
| --- | --- | --- |
| 1 · Hero cinema | Camera dollies through a dark gallery of glowing interface monoliths; headline holds, then exits | Canvas engine (`js/hero-scene.js`): hand-rolled perspective projection, fog, champagne end-light — pinned 260vh, playhead owned by scroll. Pointer sway on fine pointers |
| 2 · Work reel | Three case studies travel horizontally; frames clip open, media parallaxes under 10%, stats count up once | Pinned horizontal scrub + `containerAnimation` triggers |
| 3 · Philosophy | "Most agencies design for launch day." dissolves into "LLcreativity designs for the next $10 million." | Pinned 220vh, word-by-word scrub reveals over a drifting dark still |
| 4 · Process | 01 Strategy → 02 System → 03 Craft → 04 Launch as full-bleed film stills wiping upward | Pinned 320vh, clip-path wipes + media settle |
| 5 · Close | "Request a private consultation" — selective roster, magnetic button | Entrance reveals only; the film has ended |

Plus: thin metallic scroll-progress bar, 5% film grain, magnetic buttons with
a shine sweep, staggered word reveals (overflow-hidden, rotate + blur → sharp).

## Guarantees

- **Hero is media at first paint** — the canvas scene renders immediately and
  depends on no network asset, so nothing can 404 it into a colored block.
- **`prefers-reduced-motion`**: no Lenis, no pins, no tweens — the same layout
  as a stately static edit, hero rendered as a fixed frame.
- **No JS**: content flows vertically, fully readable.
- **No layout shift**: all imagery has intrinsic dimensions and fixed-height
  frames; photography (Unsplash, dark architecture / night glass / candlelight)
  fades into gradient-backed containers that look intentional if a request fails.
- **Performance**: transform/opacity tweens only, one rAF (GSAP ticker) driving
  Lenis, canvas redraws only while the hero is active, DPR capped at 1.75.
- **Responsive 360→4K, WCAG AA** text contrast, semantic HTML, skip link.
