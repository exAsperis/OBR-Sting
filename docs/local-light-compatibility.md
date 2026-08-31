# OBR local-light compatibility spike

## SDK contract confirmed

The Owlbear Rodeo SDK 3.1 types and current official documentation confirm that `Light` is local-only, `isLight` is the supported type guard, and `OBR.scene.local` exposes filtered `getItems`, whole-inventory `onChange`, `addItems`, `updateItems`, and `deleteItems`. The documentation describes these methods as operating on the current user's local items, but does not document extension-level ownership isolation.

Sting therefore subscribes once to `OBR.scene.local.onChange`, filters with `isLight`, and feeds the resulting cache into its normal reconciliation loop. It never mirrors local Light items into shared scene state.

## Live-room result (2026-08-31)

The local Development build was inspected with Dynamic Fog visibly active. Sting's runtime reported both a Sting-owned `Sting light` and externally created local lights (including an item named `Light`) through an OBR Light detector. Cross-extension enumeration is therefore **confirmed** for the current user/session.

Foreign mutation/restoration and whether `scene.local.onChange` reports owner-extension changes remain **unverified**. The browser-visible UI does not expose Light properties, and browser-safe page inspection cannot inject SDK mutation code into the extension iframe. This is not evidence that foreign-light mutation works.

## Safety behavior while compatibility is unconfirmed

- Sting-owned lights are identified by `com.ex-asperis.sting/local-light` metadata and may be created, updated, and deleted.
- Add Light effects default to temporary. Permanent Add Lights latch after their first activation and remain when the trigger clears; scene/runtime teardown still removes local items.
- A detected foreign light is never deleted or modified while cross-extension mutation remains unverified; the executor reports `external-modification-unverified`.
- Modification of Sting-owned lights captures a base state, applies all active Sting modifiers in deterministic runtime-key order, and restores the base when the final modifier ends.
- If the observed light differs from Sting's last applied state while modifiers are active, the observed state becomes the new base before modifiers are recomputed. This preserves owner changes instead of blindly restoring an obsolete snapshot.
- The UI calls the detector **Within Light Radius**, not “illuminated,” because walls, elevation, secondary-light rules, and GPU fog composition are not evaluated.

## Deployment verification checklist

After deploying this build to a test manifest:

1. Create a Light with the official Dynamic Fog/player-vision tooling or a second test extension.
2. Confirm Sting's local runtime reports the external Light as a candidate.
3. Apply a small temporary falloff or radius modifier.
4. Confirm the visible Dynamic Fog result changes and then returns exactly to its original value.
5. Change the Light from its owner while the modifier is active; confirm Sting rebases and preserves that owner change when the effect ends.
6. Add, update, and remove the external Light and confirm the Sting runtime reacts through `scene.local.onChange` without a scene rescan.

If steps 2 or 3 fail, foreign-light modification should be hidden/disabled in the release UI while owned-light creation and detection of visible lights remain enabled according to the observed capability.
