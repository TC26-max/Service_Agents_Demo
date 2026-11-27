# MOTION.md: how Grounded moves (v3.3)

Phase 2 of the November audit (AUDIT-2026-11-26.md) gave the demo one visual idea, "retrieval you can watch", and spent motion only where it shows retrieval happening. This file is the contract for every animation in the page. `npm test` checks it: gate-static fails if the page declares a `@keyframes` animation that is not named here, and gate-ui checks the switch, the stop conditions and the reduced-motion behavior.

## Rules

1. **One switch.** `data-motion` on `<html>` is `full` or `reduce`. It follows the system's `prefers-reduced-motion` setting until the visitor uses the toggle (top right of the intro, and the pause button in the header); that choice is saved in `localStorage` as `g-motion`. Under `reduce`, CSS animations and transitions are cut to 0.01 ms and no script loop starts.
2. **Anything that moves for more than 5 seconds can be paused** (WCAG 2.2.2). Three things loop: the intro's demo chat, the pipeline token and the touch lens sweep. The motion toggle pauses all three, and all three stop when the visitor enters the demo or the tab is hidden.
3. **Nothing flashes** (WCAG 2.3.1). The only large-area change is the bot-switch wipe. In light mode its cells mix 12% of the accent into the white panel, so the darker state stays at relative luminance 0.84, above the 0.80 line below which a change can count as a flash; in dark mode the cells mix 30% and the luminance change is under 0.03. The wipe is also limited to one per second.
4. **Text is never only in motion.** Screen readers get the drawer passage at once (the decode is drawn on an aria-hidden copy); replays animate text that is already in the page; the cover's source card is revealed by clipping, not opacity, so its text is never drawn at low contrast.
5. **Cheap properties only**: `transform`, `opacity`, `clip-path`, stroke dash offsets, one 2D canvas and one WebGL1 shader. Heavy intro work waits for the `load` event; the lens repaints only its own rectangle; the glass shader renders only while the pointer moves.
6. **No animation library.** The audit's references used GSAP's Flip, DrawSVG and ScrambleText. The same effects are a few lines of the Web Animations API and CSS each, so the page ships 0 KB of library and no license terms. The handbook's page turn is CSS 3D, so three.js was never needed.
7. **Budgets.** First load at most 100 KB compressed (test/gate-weight.mjs); Lighthouse on a phone: Performance 95 or more, Accessibility 100 (.github/workflows/ui-budget.yml).

## Inventory

| Animation | Where | Trigger | Duration and easing | Under reduce | Stops |
|---|---|---|---|---|---|
| `wmTrace`, `wmFill` | Intro wordmark | Page load, once | Trace 1.5 s, fill 0.45 s from 1.2 s | Drawn filled | Ends by itself |
| `pipeDraw` | Intro pipeline line | Page load, once | 1.1 s, eased | Drawn at once | Ends by itself |
| Pipeline token (script) | Intro pipeline | Loop | 0.6 s per hop, about 5 s per pass | Hidden; every stage lit | Enter, hidden tab, toggle |
| Demo chat (script) and `b` | Intro preview card | Loop | 6.9 s per pass; typing dots 1.2 s | One still frame | Enter, toggle |
| Source card reveal | Intro preview card | Inside the demo chat | Clip 0.45 s | Shown | With the demo chat |
| X-ray lens (canvas) | Intro background | Mouse: follows the pointer; touch: a sweep 3 s after load | Eased each frame; sweep 15 s | A still reveal | Enter, toggle; renders only while moving |
| Glass mark (WebGL1) | Intro logo | Pointer moves, desktops 1024 px and wider with a fine pointer | Renders for 450 ms after each move | Not used | Enter, toggle |
| `wIn` | Chat, streamed words | Each streamed chunk | 120 ms blur to sharp | Plain text | Ends by itself |
| Citation preview | Chat, X-ray | Hover (110 ms delay) or keyboard focus | 0.12 s fade | Shown without the fade | Pointer leaves (150 ms grace), blur, Escape |
| Chip to drawer morph (script) | Source drawer | Click a citation or source | 340 ms; title fades in over 380 ms | None | Ends by itself |
| Passage decode (script) | Source drawer | Drawer opens | Up to 650 ms | Plain text | Ends by itself |
| `wipeIn`, `wipeOut`, `wType` | Chat card | Switching bots from the picker | About 700 ms in all | None; the bot switches at once | Ends by itself; at most one a second |
| `vtOut`, `vtIn` | View tabs | Clicking a tab, where View Transitions exist | 120 ms out, 200 ms in | Plain swap | Ends by itself |
| Field reorder (script) | Retrieval X-ray | Rank | 540 ms, staggered up to 220 ms | Tiles jump to place | Ends by itself |
| Ring arcs | Retrieval X-ray tiles | Rank | 0.55 s | Drawn at once | Ends by itself |
| Seats (script) | Retrieval X-ray | Rank | 520 ms from 380 ms | Filled at once | Ends by itself |
| `qDrop`, `lnDraw` | Embedding map | Rank | 0.55 s drop, 0.45 s lines | Drawn at once | Ends by itself |
| Page turn (script) | Handbook | Previous or Next, arrow keys | 560 ms, CSS 3D leaf; phones slide 130 ms plus 200 ms | Page swaps | Ends by itself |
| `rType`, `rIn`, `rStamp` | Tested, replay cards | Replay button | 1.1 s, 0.35 s, 0.35 s | Button hidden | Ends by itself |
| `pulseA` | Sidebar card | Entering the demo | 1.3 s, 3 times | Once, instantly | Ends by itself |
| `pulseMic` | Microphone button | While recording | 1.1 s loop | Static | Recording stops |
| Drawer, scrim, intro fade | Page | Open, close, enter | 0.25 s, 0.25 s, 0.45 s transitions | Instant | Ends by itself |

`window.__coverFrames` counts every frame the intro renders (lens, glass, pipeline, demo chat), so the UI gate can prove the intro stops working once the visitor is in.
