# Project Guidance

## UI/UX consistency

- Keep new UI consistent with the existing extension and with Owlbear Rodeo (OBR). Reuse established components and styling before introducing a new control or visual treatment.
- Numerical values must use the project's custom dual-mode slider unless a requirement explicitly calls for a different control. Prefer `DynamicSliderNumber`, backed by `SliderNumber` and `DualSliderNumber`, so values retain the established slider/direct-entry behavior and can support dynamic minimum/maximum values where applicable.
- When an icon represents an action or concept that already exists in OBR, use the OBR-native glyph. Do not design a replacement icon for an existing OBR concept.
- Custom dropdowns must faithfully reproduce the appearance and interaction of the project's standard dropdowns, including dimensions, spacing, typography, borders, states, and chevron size and placement.
- Check new or changed controls alongside neighboring UI at the actual extension size. Treat visible inconsistency as a defect, even when the control is functionally correct.

## Release discipline

- Every production code or asset change must increment the patch version before handoff. Keep `package.json`, `src/version.ts`, `public/manifest.json`, `public/manifest-local.json`, the matching `public/manifest-v<version>.json`, README release identity, and every hosted resource `?v=<version>` query synchronized.
- Preserve prior versioned manifests. Run `pnpm run check:versions` and `pnpm run build` after every version bump; do not report a production change complete while the release version is unchanged.
