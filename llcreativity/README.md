# LLcreativity — the showroom

One self-contained production HTML file: `index.html`. No build step, no external JS — GSAP 3, ScrollTrigger and Lenis are inlined, so it works from any static host (Vercel, Netlify, an S3 bucket, or opened straight from disk).

**Deploy:** point any static host at this folder. Nothing else required.

## What's inside

- **Act 1 — The showroom.** Full-viewport WebGL forge (molten field → cooling pour → a single forged line), pinned for 300vh with the shader's playhead owned by scroll. Falls back to a styled poster gradient if WebGL is unavailable.
- **Act 2 — Thesis.** Pinned, scrubbed type: "Client work is the Ferrari. This site is the floor above it."
- **Act 3 — Imagine yours.** Pinned before/after wipe: an ordinary page for the fictional Gildhaven Jewelers becomes the Gildhaven house as you scroll.
- **Act 4 — Five living worlds.** ETERNE, AXYL, Evershine, KreoGrid, WealthRx as quiet environmental frames (scale + clip on scroll, parallax ≤ 8%).
- **Act 5 — Founder + ownership.** Salman Lakhani; See it first / Own everything / Speak directly / Built for you.
- **Act 6 — Services.** Website redesign from $2,500 · Ads management $800/mo.
- **Act 7 — Progression + close.** Week 0 teardown → Week 1 build → Week 2+ traffic; CTA "Request a free teardown."

Also: Lenis inertia scroll, thin scroll-progress bar, 5% animated film grain, magnetic buttons, staggered blur/rotate line reveals, `prefers-reduced-motion` respected throughout, semantic HTML, responsive 390–1440+.

## One thing to change before going live

The CTA and close button link to `mailto:hello@llcreativityllc.com` — a placeholder. Swap it for the real contact address (two occurrences of `hello@llcreativityllc.com` in `index.html`).
