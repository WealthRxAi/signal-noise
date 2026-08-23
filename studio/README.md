# Meridian — Premium Design Studio Website

A cinematic, single-page site for a design studio that builds websites exclusively
for $1M–$50M+ companies. Quiet-luxury register: deep charcoal, warm off-white,
one champagne accent, Instrument Serif display type over Sora.

## Run it

No build step. Static HTML/CSS/JS.

```bash
# open directly
open studio/index.html

# or serve locally
cd studio && python3 -m http.server 8000
# → http://localhost:8000
```

Deploy by pointing any static host (Vercel, Netlify, Cloudflare Pages, S3, nginx)
at the `studio/` directory.

## What's inside

| File | Purpose |
| --- | --- |
| `index.html` | Semantic single page — hero, selected work (4 case studies), philosophy, process, services, proof, private-consultation CTA |
| `css/main.css` | Design system: palette tokens, one spacing scale, type ramp, responsive 360px–4K, `prefers-reduced-motion` handling |
| `js/main.js` | Motion layer only — scroll progress, perspective reveals, scroll-scrubbed hero plates, two-depth parallax (≤8%), magnetic buttons |

## Notes

- **Motion is decoration.** The site is fully usable with JavaScript disabled, and
  fully static under `prefers-reduced-motion`.
- **Performance.** Transform/opacity-only animation on an rAF-throttled scroll
  listener; no images to load — every "screenshot" is a crafted CSS mockup, so
  there is zero layout shift and nothing to 404.
- **Accessibility.** WCAG AA contrast throughout (off-white ≈14:1, champagne
  ≈8:1 on charcoal), skip link, focus-visible styles, semantic landmarks.
- **Fonts.** Instrument Serif + Sora via Google Fonts with `display=swap` and
  metric-compatible fallbacks.
