# Sting for Owlbear Rodeo

Proximity sensing effects triggers.

Sting is a generic, declarative proximity rules engine for Owlbear Rodeo. Scene items can emit arbitrary signal tags; detectors respond with one or more audience-aware local shader effects.

## Modular effects and integrations

Each detector rule evaluates either its closest matching emitter or every matching
emitter in range. Sting derives enter, exit, nearest-change, and continuous lifecycle
state, then dispatches configured effects through isolated executors. Native visual
effects and external integrations compose without provider logic entering the proximity
engine.

Integration providers are trusted TypeScript adapters compiled into Sting. They are not
user-authored scripts or dynamically loaded plugins. Unknown provider configurations are
retained and skipped safely so scenes remain forward-compatible.

## Auras and Emanations integration

Sting's first provider adapter can optionally trigger named presets or preset groups from Auras and Emanations through its documented local broadcast API. Enable the integration in Sting, then add an **A&E integration** effect to a detection rule and enter the preset name exactly as it appears in Auras and Emanations.

Cleanup is opt-in per effect. The external API only exposes `REMOVE_AURAS`, which removes every Auras and Emanations aura from the target. Sting therefore leaves cleanup disabled by default and shows a warning beside the option.

## Local development

```sh
pnpm install
pnpm run dev
```

Add `http://localhost:5173/manifest-local.json` as an Owlbear Rodeo extension.

## Configuration

Only the GM can configure items. Select one scene item and open **Sting…** from its context menu or use the extension action:

1. Add zero or more emitter signal tags.
2. Add detector rules with a signal, closest/all detection mode, inner/outer scene-unit range, and smooth, linear, logarithmic, or binary falloff.
3. Add any number of effects to each rule.
4. Choose each effect's target, audience, shader preset, color, intensity, animation, center offset, and inner/outer radius.
5. Optionally link supported shader animation, softness, beam, scale, rotation, offset, and radius controls to signal strength with the `MIN` or `MAX` endpoint controls.
6. Optionally blend between minimum/full-strength colors, use constant intensity, and always include GMs in a shader effect's audience.
7. Changes save automatically to item metadata after a short validation delay.

Open **Settings** without selecting an item to choose how Sting measures distance for the scene:
using the scene-configured measurement type by default. A per-scene override can select
Chessboard, Alternating Diagonal, Euclidean, or Manhattan measurement on square and
isometric grids, or Hexagon or Euclidean measurement on either hex orientation. Settings also contains
the optional extension integrations.

The background page evaluates rules on every client even while the editor is closed. Derived proximity state and Effect item IDs are never written to the shared scene.

## Verification

```sh
pnpm run check:identity
pnpm run check:versions
pnpm run typecheck
pnpm run test
pnpm run build
```

## Current SDK notes

- Shader effects use experimental local-only Owlbear `ATTACHMENT` Effect items.
- Attachment effects fill the target's bounds. The built-in glow preset therefore renders a transparent color overlay within those bounds; renderer behavior on transparent or hidden artwork should be checked in the target Owlbear release.
- Item ownership is encapsulated through `createdUserId`, which is the ownership identity exposed on SDK items. GM **Assign Owner** behavior should be verified in multiplayer testing.
- Hidden emitters are not filtered. A player can only evaluate hidden items that Owlbear exposes to that player's client; the extension does not bypass Owlbear visibility boundaries.
- Range comparisons default to `OBR.scene.grid.getDistance()`, so the current scene measurement and scale remain authoritative; per-scene overrides use grid-aware square, hex, and axonometric calculations.

## Release identity

- Extension ID: `com.ex-asperis.sting`
- Published author: `ex Asperis`
- Stable manifest: `public/manifest.json`
- Versioned manifest: `public/manifest-v0.1.4.json`
