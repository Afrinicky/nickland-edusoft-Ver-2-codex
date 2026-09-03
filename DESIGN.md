# Nickland Edusoft — design system

One system, three renderers: `mobile/src/theme.js` (phone + web app),
`src/renderer/src/styles/index.css` (desktop), and the print stylesheet in
`mobile/src/print.js`. Change a value in one and change it in all three.

## Colour

**Strategy: restrained.** Tinted neutrals, one accent doing real work. Violet is
never decorative — it marks the primary action, the current position, and
nothing else.

| Role | Token | Value | Why |
|---|---|---|---|
| Primary | `violet600` | `#5B3FE0` | 7.1:1 on white. Legible as text *and* as a button fill, so one hue covers both. |
| Primary pressed | `violet700` | `#4A2FC7` | |
| Canvas | `canvas` | `#F5F4FB` | White chrome needs somewhere to sit. Tinted 0.012 chroma toward violet, not toward warm. |
| Surface | `surface` | `#FFFFFF` | |
| Ink | `ink900` | `#14142B` | 15.8:1. Headings and figures. |
| Body | `ink700` | `#3A3A55` | 9.6:1. |
| Muted | `ink500` | `#61617E` | 5.6:1 — passes for body, so a caption is never below the floor. |
| Faint | `ink400` | `#8A8AA3` | 3.4:1. **Decoration and icons only.** Never body text. |
| Border | `line` | `#E7E5F2` | |
| Chrome | `ink950` | `#15132B` | **The splash, and nothing else.** |

Judgement colours carry meaning, never decoration: `#12864A` good, `#B26205`
attention, `#C7343A` wrong, `#0E8E8E` computed/live.

**Contrast floor: 4.5:1 for anything a person reads.** `ink400` is the only
token below it and it is barred from text. `npm run test:contrast` measures
every pairing and fails the build below the floor.

### Where colour is allowed to be

One screen in the app is dark, and it is the splash. The top bar, the drawer,
the sidebar and the bottom bar are all one white surface with hairline borders.

Violet appears in exactly three places and means the same thing in each:

- the **pill** on the navigation item you are on, and on the active tab,
- the **primary button**,
- one **card** per screen, carrying the figure that screen is about — today's
  progress, the amount outstanding — or the header over a person's own profile.

A dark rail down the side of a light screen is a slab of ink with nothing on
it, and in Ghanaian daylight a dark panel is a mirror. If a surface is not one
of the three above, it is white.

## Type

System stack, no web font. A school PC has no internet at 7am and a font that
fails to load falls back to a serif — which is exactly the bug this system was
written to fix. Weight and letter-spacing carry the hierarchy instead.

```
'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system,
'Helvetica Neue', Arial, sans-serif
```

Six sizes and nothing between them: display 30 / title 22 / heading 17 / body 15
/ small 13 / micro 11. Figures are tabular so columns line up. Negative tracking
on the large weights only, floor −0.03em.

## Shape and depth

Radii: `xs 8 · sm 12 · md 16 · lg 20 · xl 28 · pill`. The reference language is
soft, not round: a card is 20, a row inside it is 12, a button is 14.

Three elevations, and they mean resting / raised / floating. A screen where
everything floats has no hierarchy. Borders are hairline and do the structural
work; shadow is for things that genuinely sit above the page.

## Motion

`mobile/src/motion.jsx` and the `--ease-*` tokens in the desktop CSS.

- Durations: 120 / 180 / 260 / 400ms. Nothing slower than 400 unless it is a
  screen transition.
- Curves: ease-out only — `cubic-bezier(0.16, 1, 0.3, 1)`. No bounce, no
  elastic. This is a school's records, not a game.
- What moves: entrance of a list (staggered ≤50ms apart, capped at 8 items),
  the drawer, a sheet, a press (scale 0.97), a tab indicator, a progress ring.
- **Content is visible by default.** A reveal enhances what is already painted;
  nothing is gated behind a transition that a headless render or a background
  tab would never fire.
- `prefers-reduced-motion` removes movement and keeps a 120ms crossfade.

## Banned

Side-stripe accent borders. Gradient text. Decorative glass. Nested cards.
Cream/sand neutrals. Any body text on `ink400`.
