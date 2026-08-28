# Proximity Signals for Owlbear Rodeo

Proximity Signals is a generic, declarative proximity rules engine for Owlbear Rodeo. Scene items can emit arbitrary signal tags; detectors respond with one or more audience-aware local shader effects.

## Local development

```sh
pnpm install
pnpm run dev
```

Add `http://localhost:5173/manifest-local.json` as an Owlbear Rodeo extension.

## Configuration

Only the GM can configure items. Select one scene item and open **Proximity Signals…** from its context menu or use the extension action:

1. Add zero or more emitter signal tags.
2. Add detector rules with a signal, inner/outer scene-unit range, and falloff curve.
3. Add any number of effects to each rule.
4. Choose each effect's target, audience, shader preset, color, intensity, and animation.
5. Save the configuration to item metadata.

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

- Shader effects use experimental local-only Owlbear Effect items on the `POST_PROCESS` layer.
- Attachment effects fill the target's bounds. The built-in glow and outline presets therefore emphasize pixels within those bounds; renderer behavior on transparent or hidden artwork should be checked in the target Owlbear release.
- Item ownership is encapsulated through `createdUserId`, which is the ownership identity exposed on SDK items. GM **Assign Owner** behavior should be verified in multiplayer testing.
- Hidden emitters are not filtered. A player can only evaluate hidden items that Owlbear exposes to that player's client; the extension does not bypass Owlbear visibility boundaries.
- Range comparisons use `OBR.scene.grid.getDistance()`, so the current grid measurement and scale remain authoritative.

## Release identity

- Extension ID: `com.ex-asperis.proximity-signals`
- Published author: `ex Asperis`
- Stable manifest: `public/manifest.json`
- Versioned manifest: `public/manifest-v0.1.4.json`
