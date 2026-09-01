# Native Effects Roadmap
This document lists planned native effects for Sting, including progress, problems, and plans.

## Shader effects

### Directional glow
instead of the whole detector glowing evenly, the side facing the detected emitter brightens.
This is quite a bit like Responsive offset, and may be unnecessary.

### Arrow / chevron indicator
a small local arrow attached to the detector points toward the emitter. Its size, brightness, opacity, or pulse rate can scale with proximity. Extremely legible and useful.

### Tether / beam
draw a thin line, beam, chain, lightning filament, or dotted guide from detector to detected emitter.

### Radar sweep / blip: 
a rotating sweep around the detector with a blip appearing at the actual bearing of the emitter. Distance from the detector center could be normalized to detection range, so the blip moves inward as the real emitter gets closer. This could be fantastic for sci-fi.

### Directional particle drift
little sparks, motes, smoke wisps, or runes drift toward or away from the emitter direction. More decorative, but uniquely directional.

### Reticle / brackets: 
draw targeting brackets around the target. Strength could control opacity, bracket size, or lock-on animation. Great for sci-fi sensors or magical identification.

### ☑️ Responsive offset
slightly displace a glow, shadow, or halo toward or away fromthe emitter. Subtle, but it makes the object seem to “pull” toward the detected thing or provides an interactive drop shadow.

## Viewport effects

### Edge indicator
if the emitter is off-screen, place a marker at the edge of the user's viewport pointing toward it. This feels especially valuable because it communicates something a normal aura absolutely cannot.

## State effects

### ❌ Block
Prevents the detector from moving into the range of the the emitter. Or prevents the emitter from moving into the range of the detector. 
Target cannot be "Specific item". It must be either the Detector, the Detected emitter(s), Parent, or Carrier.
This effect is only valid if we can actually stop movement as the item is being dragged. If it's an after-drop effect, we can achieve the same effect with Repell.
This effect is not feasable.

### Repel
Moves the target away from the emitter.
