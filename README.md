# 極光軌道 · Aurora Orbit

Original, dependency-free HTML5 laser defense for touch and desktop. Protect an orbital station through 12 waves and bosses on waves 4, 8, and 12. Procedural vector artwork, no advertisement assets or third-party game branding.

## Play

Turrets auto-target. Hold and drag the battlefield to focus nearby targets for a damage bonus. Release to return to danger-aware auto targeting. Space: pulse (35 energy, 12 s cooldown). E: overdrive (50 energy, 6 s duration, 16 s cooldown). P/Escape: pause. Pick one upgrade between waves using buttons or keys 1–3.

Audio is opt-in. Reduced motion follows the device preference and can be enabled in settings. Best score and preferences are stored locally; no analytics, login, paid content, remote fonts, or tracking. A campaign's simulation seed is fixed for repeatable practice.

## Development

Static ES modules, Canvas 2D, fixed-step pure-JavaScript simulation. Serve this directory over HTTP with a static server. No build step or dependencies.

Run deterministic mechanics, legality, progression, budget, victory, defeat, and replay regression tests:

```
node --test tests.mjs
```

GitHub Pages publishes from `main` / root. Runtime assets: index.html, style.css, app.mjs, engine.mjs, icon.svg.

## Accessibility

All menus and abilities are native keyboard-focusable buttons; numeric hotkeys choose upgrades. Sound defaults off. Auto targeting means pointer precision is optional. Canvas combat is visual and does not provide a fully nonvisual screen-reader experience.
