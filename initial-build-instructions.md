# Proximity Signals: Owlbear Rodeo Extension Implementation Specification

## 1. Objective

Build an Owlbear Rodeo extension that provides a generic **proximity signal and effects system**.

Arbitrary scene items may be configured as:

1. **Emitters**
   - Emit one or more named signals.

2. **Detectors**
   - Listen for one or more named signals.
   - Define one or more detection rules.
   - Each detection rule has its own range and response curve.
   - Each detection rule contains an array of effects.
   - Every effect independently defines:
     - what it does
     - what item it targets
     - which users should experience it, where applicable

The extension must not contain game-specific concepts such as Orcs, undead, radiation, magic, treasure, etc.

Those meanings are entirely user-defined.

Canonical example:

```text
Orc token
    emits: orc

Sting
    detects: orc
    range: 60 ft

    effects:
        blue glow on Sting
        visible only to Sting's carrier owner
```

More complex example:

```text
Detector: magical amulet

Rule:
    signal: cursed
    range: 30 ft

    effects:
        1. violet glow on detector
           audience: detector carrier owner

        2. red outline on detected cursed object
           audience: GM only

        3. future:
           prevent carrier from moving closer
```

The architecture must support such configurations without application-specific code.

---

# 2. Central Design Principle

Keep these concepts separate:

```text
WHAT EXISTS
    emitter metadata

WHAT RESPONDS
    detector metadata

WHEN IT RESPONDS
    detection rule

WHAT HAPPENS
    effects[]

WHO EXPERIENCES IT
    effect audience

WHAT ITEM IT ACTS UPON
    effect target

WHAT IS HAPPENING RIGHT NOW
    derived runtime state
```

Do not store derived runtime state in shared metadata.

The core pipeline is:

```text
Emitter metadata
      +
Detector metadata
      ↓
Signal matching
      ↓
Distance calculation
      ↓
Detection rule strength
      ↓
Effect definitions[]
      ↓
Target resolution
      ↓
Audience resolution
      ↓
Effect executor
```

---

# 3. Terminology

Use these terms consistently throughout the codebase and UI.

## Emitter

A scene item that advertises one or more signal tags.

Example:

```text
Orc Warrior

signals:
    orc
    evil
```

## Detector

A scene item containing one or more detection rules.

Example:

```text
Sting

rules:
    orc within 60 ft
    undead within 20 ft
```

## Detection Rule

A detector configuration consisting primarily of:

```text
signal
range
falloff
aggregation
effects[]
```

A detector may have multiple rules listening for the same signal.

For example:

```text
orc within 60 ft
    → faint glow

orc within 30 ft
    → pulse

orc within 10 ft
    → outline nearest Orc
```

Do not enforce one rule per signal.

The combination of:

```text
detector + signal + range
```

represents a distinct condition.

## Effect

A consequence driven by the strength of a detection rule.

An effect must define:

```text
type
target
audience
effect-specific configuration
```

A rule may contain zero, one, or many effects.

## Target

The scene item upon which an effect operates.

The target does not need to be the detector itself.

## Audience

The user or users who should experience a local effect.

Audience is especially useful for local graphical effects.

## Strength

A normalized value:

```text
0.0 = rule inactive
1.0 = maximum proximity response
```

---

# 4. Version 1 Scope

Version 1 must fully implement:

- emitter metadata
- detector metadata
- multiple detector rules
- multiple rules for the same signal
- `effects[]` on every rule
- multiple effects per rule
- effect targets
- effect audiences
- local shader effects
- nearest-emitter aggregation
- binary falloff
- linear falloff
- smoothstep falloff
- arbitrary user-defined signals
- attachment-aware carrier resolution
- per-client local rendering
- GM configuration UI
- background runtime
- debugging tools
- multiplayer testing

Version 1 should establish architecture for later effects but does **not** need to implement:

- shared property effects
- movement constraints
- audio
- messages
- macros
- arbitrary scripts

Those future effect categories must be possible without redesigning the detector metadata model or runtime pipeline.

---

# 5. OBR Runtime Architecture

The extension must have two conceptual halves.

## Shared configuration

Persistent configuration lives in ordinary OBR item metadata.

This includes:

```text
emitter definitions
detector definitions
detection rules
effect definitions
targets
audiences
```

This configuration is part of the shared scene.

## Local runtime

Each connected client independently:

```text
reads shared configuration
calculates proximity
determines rule strength
resolves effect targets
checks whether the local user belongs to the effect audience
materializes local effects
updates local effects
removes obsolete local effects
```

Do not synchronize derived shader state between clients.

Do not broadcast proximity values unless a future feature specifically requires it.

---

# 6. Background Runtime

Detection must continue while the visible extension UI is closed.

Use the manifest's:

```json
{
  "background_url": "..."
}
```

The background runtime must:

1. wait for OBR readiness
2. wait for scene readiness
3. obtain current player information
4. obtain current party information
5. read scene items
6. build indexes
7. perform initial evaluation
8. subscribe to scene item changes
9. subscribe to grid changes
10. subscribe to player changes
11. subscribe to party changes
12. handle scene lifecycle changes
13. reconcile local effects
14. clean up obsolete local effects

The visible action/popover is configuration UI only.

---

# 7. Metadata Namespace

Use the extension's actual reverse-domain manifest ID.

For example:

```ts
const EXTENSION_ID = "com.ex-asperis.sting";

const EMITTER_KEY =
  `${EXTENSION_ID}/emitter`;

const DETECTOR_KEY =
  `${EXTENSION_ID}/detector`;
```

Do not overwrite unrelated metadata.

---

# 8. Emitter Metadata

Emitters must remain intentionally simple.

Suggested schema:

```ts
interface EmitterMetadataV1 {
  version: 1;
  signals: string[];
}
```

Example:

```json
{
  "version": 1,
  "signals": [
    "orc",
    "evil"
  ]
}
```

An emitter must not contain:

```text
ranges
detectors
effects
audiences
proximity state
current strength
nearest detector
```

Emitters advertise facts.

Detectors decide what those facts mean.

---

# 9. Signal Normalization

Signals are user-defined.

Normalize before storage and comparison.

At minimum:

1. trim whitespace
2. lowercase
3. collapse repeated internal whitespace
4. convert spaces to `-` where appropriate
5. prevent duplicates

Examples:

```text
" Orc "
"ORC"
"orc"
```

all become:

```text
orc
```

Recommended valid characters:

```text
a-z
0-9
-
_
.
:
```

Useful examples:

```text
orc
goblin
undead
magic
treasure
radiation
evil
faction:red-hand
artifact:eye-of-zaruk
temperature:hot
```

Do not maintain a global predefined vocabulary.

---

# 10. Detector Metadata

Suggested schema:

```ts
interface DetectorMetadataV1 {
  version: 1;
  enabled: boolean;
  rules: DetectionRuleV1[];
}
```

---

# 11. Detection Rule Schema

Suggested structure:

```ts
interface DetectionRuleV1 {
  id: string;

  enabled: boolean;

  signal: string;

  range: {
    outer: number;
    inner: number;
  };

  aggregation: "nearest";

  falloff:
    | "binary"
    | "linear"
    | "smoothstep";

  effects: EffectDefinitionV1[];
}
```

Every rule must have a stable UUID.

Never use array position as identity.

Multiple rules may listen for the same signal.

Example:

```json
{
  "id": "rule-1",
  "enabled": true,
  "signal": "orc",
  "range": {
    "outer": 60,
    "inner": 5
  },
  "aggregation": "nearest",
  "falloff": "smoothstep",
  "effects": []
}
```

---

# 12. Effects Must Be an Array

The field must always be:

```ts
effects: EffectDefinitionV1[];
```

Never:

```ts
effect: EffectDefinitionV1;
```

Even a rule with only one effect uses an array.

This is a fundamental architectural requirement.

Example:

```json
"effects": [
  {
    "id": "effect-1",
    "type": "shader",
    "target": {
      "type": "detector"
    },
    "audience": {
      "type": "carrier-owner"
    },
    "preset": "glow",
    "color": "#55aaff"
  },
  {
    "id": "effect-2",
    "type": "shader",
    "target": {
      "type": "detected-emitter"
    },
    "audience": {
      "type": "gm"
    },
    "preset": "outline",
    "color": "#ff5555"
  }
]
```

Each effect gets its own stable UUID.

Runtime identity should be based on:

```text
detector ID
rule ID
effect ID
resolved target ID
```

when necessary.

---

# 13. Effect Architecture

Do not hard-code shader behavior directly into the proximity engine.

Use a pluggable effect executor architecture.

Conceptually:

```ts
interface EffectExecutor<TDefinition> {
  type: string;

  reconcile(
    context: EffectExecutionContext,
    definition: TDefinition
  ): Promise<void>;

  remove(
    runtimeKey: string
  ): Promise<void>;
}
```

Registry:

```ts
const effectExecutors = new Map([
  ["shader", shaderEffectExecutor]
]);
```

Future:

```ts
effectExecutors.set(
  "property",
  propertyEffectExecutor
);

effectExecutors.set(
  "movement-constraint",
  movementConstraintExecutor
);
```

The proximity engine must not need modification when a new effect executor is added.

It should simply produce an execution context and dispatch by effect type.

---

# 14. Base Effect Definition

Suggested common structure:

```ts
interface EffectBaseV1 {
  id: string;

  type: string;

  enabled: boolean;

  target: EffectTargetV1;

  audience: EffectAudienceV1;
}
```

The actual type should use a TypeScript discriminated union.

For version 1:

```ts
type EffectDefinitionV1 =
  | ShaderEffectDefinitionV1;
```

Architect the parser so future versions can add:

```ts
| PropertyEffectDefinition
| MovementConstraintEffectDefinition
| AudioEffectDefinition
| MessageEffectDefinition
```

without changing detection rules.

---

# 15. Effect Targets

Every effect must specify its target.

Suggested target union:

```ts
type EffectTargetV1 =
  | {
      type: "detector";
    }

  | {
      type: "parent";
    }

  | {
      type: "carrier";
    }

  | {
      type: "detected-emitter";
    }

  | {
      type: "specific-item";
      itemId: string;
    };
```

---

# 16. Target Semantics

## `detector`

Target the item containing the detector metadata.

Example:

```text
Sting glows
```

## `parent`

Target the detector's immediate `attachedTo` parent.

If no parent exists:

```text
target resolution fails
effect is skipped
```

Do not silently reinterpret it as another target.

## `carrier`

Resolve the detector's attachment ancestry and target the topmost ancestor.

Example:

```text
Bilbo
└── Belt
    └── Sting
```

`carrier` resolves to:

```text
Bilbo
```

If the detector is not attached to anything, `carrier` resolves to the detector itself.

This makes carrier behavior useful for both attached and standalone detectors.

## `detected-emitter`

Target the emitter selected by the rule's aggregation algorithm.

For:

```text
aggregation = nearest
```

this means:

```text
nearest matching emitter
```

If no emitter is currently detected:

```text
effect strength = 0
target unavailable
remove/deactivate effect
```

## `specific-item`

Target a specific OBR item ID saved in the effect definition.

If that item no longer exists:

```text
skip the effect
report missing target in debug mode
do not crash
```

---

# 17. Future Effect Targets

Do not implement these yet, but leave the target resolver extensible enough to later support:

```text
all-matching-emitters
all-emitters-within-range
detector-family
carrier-family
selected-item
viewport
```

Do not hard-code target resolution inside individual shader code.

Use a target resolver module.

---

# 18. Effect Audiences

Local effects may be visible to different users.

Suggested union:

```ts
type EffectAudienceV1 =
  | {
      type: "everyone";
    }

  | {
      type: "gm";
    }

  | {
      type: "players";
    }

  | {
      type: "detector-owner";
    }

  | {
      type: "carrier-owner";
    }

  | {
      type: "target-owner";
    }

  | {
      type: "specific-users";
      userIds: string[];
    };
```

---

# 19. Audience Semantics

Audience evaluation happens independently on every client.

The question is:

```text
Should THIS client materialize THIS effect?
```

## Everyone

```text
GM = yes
PLAYER = yes
```

## GM

```text
local player's role == GM
```

## Players

```text
local player's role == PLAYER
```

## Detector owner

Compare the local player ID with the ownership identity associated with the detector.

Initially use the detector item's `createdUserId`.

Explicitly test OBR's GM "Assign Owner" behavior to confirm whether ownership reassignment is reflected through `createdUserId`.

If OBR exposes ownership through another mechanism, encapsulate that in:

```ts
resolveItemOwnerId(item)
```

Do not scatter ownership assumptions through the runtime.

## Carrier owner

Resolve the detector's carrier first.

Then resolve that item's owner.

This will often be more useful than detector owner for attached magical items.

Example:

```text
GM created Sting
Player created Bilbo

audience = carrier-owner
```

should mean Bilbo's player if OBR ownership data permits it.

## Target owner

Resolve the effect target, then resolve its owner.

## Specific users

Compare against:

```ts
OBR.player.id
```

Store persistent user IDs, not connection IDs.

A connection ID is session-specific and should not be stored in detector metadata.

---

# 20. Party Information

Use the party API for audience editing and diagnostics.

The UI may present connected users for:

```text
specific-users
```

but users selected previously may currently be offline.

Therefore metadata stores:

```text
user IDs
```

not only a transient list of currently connected players.

Do not delete audience IDs merely because a player disconnects.

---

# 21. Local Versus Shared Effect Scope

This distinction is critical.

Effects fall into two implementation scopes.

## Local effects

Exist only for the current OBR client.

Examples:

```text
shader
highlight
outline
local indicator
viewport tint
local annotation
```

These can meaningfully support per-user audiences.

## Shared effects

Modify actual shared scene state.

Future examples:

```text
visible = false
locked = true
disableHit = true
position changes
```

These cannot truthfully have different shared values for different users.

Therefore:

```text
audience
```

and:

```text
scope
```

are separate concepts.

Do not attempt to fake per-user shared properties.

---

# 22. Scope Must Be Determined by Effect Type

Do not let users arbitrarily choose:

```text
local/shared
```

for every effect.

The executor determines its scope.

For example:

```ts
shaderEffectExecutor.scope = "local";
propertyEffectExecutor.scope = "shared";
```

The UI should adapt accordingly.

For a local shader:

```text
Audience:
    everyone
    GM
    players
    carrier owner
    specific users
```

For a future shared property effect:

```text
Audience:
    everyone
```

or the audience control should simply be hidden/disabled because the property itself is shared.

---

# 23. Effect Execution Context

The proximity engine should produce a context object similar to:

```ts
interface EffectExecutionContext {
  detector: Item;

  rule: DetectionRuleV1;

  effect: EffectDefinitionV1;

  strength: number;

  distance: number | null;

  detectedEmitter: Item | null;

  target: Item | null;

  localPlayer: {
    id: string;
    role: "GM" | "PLAYER";
  };
}
```

The executor should not need to recalculate proximity.

It receives already-resolved state.

---

# 24. Rule Evaluation Pipeline

For each detector:

```text
for each enabled rule
    normalize signal
    find matching emitters
    exclude forbidden self-family emitters
    calculate distances
    apply aggregation
    calculate rule strength

    for each enabled effect
        resolve target
        resolve audience
        dispatch to effect executor
```

Conceptually:

```text
DetectionRule
    ↓
SignalMatchResult
    ↓
DetectionResult
    ↓
EffectExecutionContext[]
```

Keep these stages separable and testable.

---

# 25. Signal Index

Build an in-memory index:

```ts
Map<string, Item[]>
```

Example:

```text
orc
    Orc Warrior
    Orc Archer
    Orc Captain

undead
    Skeleton
    Wight

magic
    Wand
    Wizard
```

A rule detecting `orc` should inspect:

```ts
signalIndex.get("orc")
```

rather than every scene item.

Rebuild or incrementally refresh the index whenever relevant item metadata changes.

For v1, full rebuilding from the latest item snapshot is acceptable if performance remains good.

Correctness is more important than premature complexity.

---

# 26. Detector Index

Also maintain:

```ts
Map<string, ParsedDetector>
```

keyed by scene item ID.

Store:

```text
item reference
parsed metadata
attachment ancestry
```

where useful.

---

# 27. Attachment Family

Build attachment relationships from:

```ts
item.attachedTo
```

For every detector, be able to derive:

```text
immediate parent
all ancestors
top-level carrier
descendants
siblings
attachment family
```

A detector should not normally detect emitters in its own attachment family.

Example:

```text
Bilbo
├── Sting
└── Backpack
```

If Bilbo or Backpack somehow emits `orc`, Sting should not detect that signal by default.

Exclude:

```text
detector itself
ancestors
descendants
siblings within same root attachment family
```

from emitter matching.

Keep this behavior inside a helper such as:

```ts
isSameAttachmentFamily(a, b)
```

---

# 28. Distance

Use OBR's grid distance API.

Do not assume plain Euclidean pixel distance.

Encapsulate measurement:

```ts
getSceneDistance(
  from: Vector2,
  to: Vector2
): Promise<number>
```

The distance implementation must respect the current scene's grid measurement mode.

---

# 29. Scene Units

User-entered ranges should use the scene's visible units.

Examples:

```text
60 ft
10 m
20 squares
```

Do not force users to think in raw pixels.

Create one centralized conversion layer.

Explicitly test how OBR's current `getDistance()` return value behaves for:

```text
EUCLIDEAN
CHEBYSHEV
MANHATTAN
ALTERNATING
```

and with different grid scales.

Do not scatter conversion assumptions through rule evaluation.

All rule comparisons should eventually use one canonical scene-distance unit.

---

# 30. Distance Origin

Version 1 uses center-to-center positions:

```text
detector.position
emitter.position
```

Do not implement yet:

```text
edge-to-edge distance
shape intersection
line of sight
elevation
path crossing
```

---

# 31. Aggregation

Version 1 supports:

```text
nearest
```

For every rule:

1. find matching emitters
2. remove attachment-family matches
3. calculate distance to each
4. select minimum distance
5. return both:
   - nearest distance
   - selected emitter

Example:

```text
Orc A = 80 ft
Orc B = 22 ft
Orc C = 35 ft
```

Result:

```text
distance = 22 ft
detectedEmitter = Orc B
```

This is important because:

```text
target = detected-emitter
```

requires the selected item, not merely its distance.

---

# 32. Future Aggregation

Keep aggregation represented explicitly in metadata:

```ts
aggregation: "nearest"
```

so future versions may add:

```text
sum
count
average
strongest
```

Some future aggregation modes may not produce a single detected emitter.

Therefore target resolution should eventually be able to distinguish:

```text
primary detected emitter
matching emitters
emitters within range
```

Do not implement those modes yet.

---

# 33. Range Model

Each rule has:

```ts
range: {
  outer: number;
  inner: number;
}
```

Meaning:

```text
distance >= outer
    strength = 0

distance <= inner
    strength = 1
```

Between those values, calculate normalized proximity.

Example:

```text
outer = 60
inner = 5
distance = 30
```

Raw proximity:

```ts
x =
  (outer - distance) /
  (outer - inner);
```

Clamp to:

```text
0..1
```

---

# 34. Falloff

Implement:

```text
binary
linear
smoothstep
```

## Binary

```ts
strength =
  distance <= outer ? 1 : 0;
```

Ignore `inner` for binary behavior.

## Linear

```ts
strength = x;
```

## Smoothstep

```ts
strength =
  x * x * (3 - 2 * x);
```

Make:

```text
smoothstep
```

the default.

---

# 35. Rule Strength Is Separate from Effects

Do not let an effect calculate proximity.

The rule produces:

```text
strength = 0..1
```

Then every effect consumes that same strength.

Example:

```text
Rule strength = 0.72

Effect 1:
    blue detector glow
    uses 0.72

Effect 2:
    red emitter outline
    uses 0.72

Effect 3:
    future audio volume
    uses 0.72
```

This is a crucial abstraction.

---

# 36. Shader Effect Definition

Version 1 effect implementation:

```ts
interface ShaderEffectDefinitionV1
  extends EffectBaseV1 {

  type: "shader";

  preset:
    | "glow"
    | "pulse"
    | "flicker"
    | "outline";

  color: string;

  maxIntensity: number;

  spread: number;

  animation?: {
    rate: number;
    depth: number;
  };
}
```

Example:

```json
{
  "id": "effect-blue-glow",
  "type": "shader",
  "enabled": true,

  "target": {
    "type": "detector"
  },

  "audience": {
    "type": "carrier-owner"
  },

  "preset": "glow",
  "color": "#55aaff",
  "maxIntensity": 1,
  "spread": 1.25,

  "animation": {
    "rate": 1,
    "depth": 0
  }
}
```

---

# 37. Shader Effects Are Local

OBR Effect items must be created through:

```ts
OBR.scene.local
```

Never attempt to add Effect items to the shared scene.

Each client creates only the Effect items that client should see.

Example:

```text
Effect audience = carrier-owner

GM client:
    audience false
    create nothing

Player A:
    owns carrier
    create effect

Player B:
    does not own carrier
    create nothing
```

No inter-client coordination is required.

---

# 38. Local Effect Runtime Key

One effect definition may resolve to different targets over time.

For example:

```text
target = detected-emitter
```

may switch from Orc A to Orc B.

Use a runtime key capable of representing target identity:

```ts
function runtimeEffectKey(
  detectorId: string,
  ruleId: string,
  effectId: string,
  targetId: string
) {
  return [
    detectorId,
    ruleId,
    effectId,
    targetId
  ].join(":");
}
```

If a target changes:

```text
remove/deactivate old target effect
create/update new target effect
```

---

# 39. Local Effect Registry

Maintain an in-memory registry.

Example:

```ts
interface LocalEffectRuntimeState {
  runtimeKey: string;

  detectorId: string;
  ruleId: string;
  effectId: string;

  targetId: string;

  localItemId: string;

  lastStrength: number;

  configHash: string;
}

const localEffects =
  new Map<string, LocalEffectRuntimeState>();
```

Do not store:

```text
localItemId
current strength
current target
```

in shared scene metadata.

---

# 40. Shader Reconciliation

For every desired local shader effect:

## Audience does not include local user

Ensure the local effect does not exist.

## Target unavailable

Ensure the local effect does not exist.

## Strength equals zero

Prefer either:

```text
retain effect at zero intensity
```

or:

```text
remove it
```

Choose based on Effect API performance.

Prefer retaining it if that avoids frequent recreation and does not create scene overhead.

## Effect exists

Update only when:

```text
strength changed meaningfully
configuration changed
target changed
```

## Effect does not exist

Create it.

## Effect no longer corresponds to any active configuration

Remove it.

---

# 41. Update Epsilon

Avoid meaningless local API updates.

Example:

```ts
const STRENGTH_EPSILON = 0.005;
```

If:

```ts
Math.abs(
  newStrength - oldStrength
) < STRENGTH_EPSILON
```

and configuration is unchanged:

```text
skip update
```

---

# 42. Shader API Spike

Before building the full configuration UI, test the current OBR Effect API.

Prove:

- local Effect creation works
- local Effect can attach to a shared scene item
- attached Effect follows target movement
- effect follows a detector that itself follows a parent
- effect works on CHARACTER items
- effect works on ATTACHMENT items
- effect works on PROP items
- dynamic uniforms can be updated
- strength can smoothly change
- effect can disappear at strength zero
- multiple Effect items can attach to one target
- Effect does not interfere with hit detection
- local effects survive target movement
- local effects can be removed cleanly

Also test:

```text
rotation
scaling
hidden targets
transparent PNGs
large targets
small targets
```

---

# 43. Glow Rendering Caveat

Do not assume an attached shader automatically knows the target image's alpha mask.

Test whether:

```text
ATTACHMENT
```

Effects are simply bounded rectangles.

Test:

```text
POST_PROCESS
```

effects to determine whether target content can be modified without unwanted rectangular artifacts.

If needed, implement glow as an oversized local halo attached to the target.

Preferred implementation order:

```text
1. ATTACHMENT glow
2. POST_PROCESS glow/outline
3. STANDALONE attached halo
```

Use whichever produces the best generic result.

Do not change the metadata architecture based on renderer limitations.

---

# 44. Shader Presets

Version 1 should provide built-in presets.

## Glow

Static colored glow.

Controls:

```text
color
maximum intensity
spread
```

## Pulse

Glow whose intensity oscillates.

Controls:

```text
color
maximum intensity
spread
rate
depth
```

## Flicker

Irregular animated glow.

Controls:

```text
color
maximum intensity
spread
rate
depth
```

## Outline

Colored emphasis around the target if technically feasible with the Effect API.

If a clean arbitrary-image outline cannot be implemented without unacceptable artifacts, defer this one while keeping the preset architecture.

---

# 45. GPU Animation

Where possible, animations should use shader time.

JavaScript should update:

```text
base proximity strength
```

The shader should calculate:

```text
pulse
flicker
animation phase
```

Do not update animation frames from JavaScript.

---

# 46. Multiple Effects May Stack

Effects are independent.

Example:

```text
Rule strength = 0.8

Effect A:
    blue glow on detector
    audience carrier owner

Effect B:
    red outline on emitter
    audience GM

Effect C:
    pulse on carrier
    audience everyone
```

All applicable effects may coexist.

Do not implement winner-takes-all behavior.

---

# 47. Multiple Rules May Stack

Example:

```text
ORC / 60 ft
    faint blue glow

ORC / 30 ft
    blue pulse

ORC / 10 ft
    red outline on nearest Orc
```

At 8 ft, all three rules may be active simultaneously.

Do not introduce a special state machine.

The rule system itself supplies the composition.

---

# 48. Future Effect Type: Shared Property Mutation

Design for a future effect such as:

```ts
interface PropertyEffectDefinition
  extends EffectBase {

  type: "property";

  property:
    | "visible"
    | "locked"
    | "disableHit";

  activeValue: boolean;
}
```

Examples:

```text
When intruder within 10 ft:
    target door
    locked = true
```

or:

```text
When magic nearby:
    target rune
    visible = true
```

Do not implement this executor in v1 unless specifically requested after the shader system is stable.

---

# 49. Shared Property Effects Require Authority

All clients run the local proximity engine.

They must **not** all mutate shared scene state independently.

When shared property effects are implemented later:

```text
Only a GM-authoritative runtime
may execute shared mutations.
```

Initially, use:

```text
local player role == GM
```

as the authority gate.

If multiple GM clients can exist simultaneously and cause conflicts, add an authority-election mechanism before shipping shared mutation effects.

Do not solve this prematurely for shader-only v1.

---

# 50. Shared Property Effects Require Restoration

A future property executor must remember the value that existed before the effect became active.

Example:

```text
Door originally:
    locked = false

Effect activates:
    locked = true

Effect ends:
    restore locked = false
```

This becomes difficult when:

```text
multiple effects affect same property
or
a human edits the property while effect is active
```

Therefore do not implement property effects casually.

Create a dedicated property arbitration layer when that feature is developed.

Potential future model:

```text
base property state
+
active property claims
=
effective property state
```

Do not bake restoration logic into the generic proximity engine.

---

# 51. Future Effect Type: Movement Constraint

Reserve architecture for effects such as:

```ts
interface MovementConstraintEffectDefinition
  extends EffectBase {

  type: "movement-constraint";

  constraint:
    | "prevent-closer"
    | "prevent-farther"
    | "remain-within-range"
    | "remain-outside-range";
}
```

Example:

```text
Detector:
    character

Signal:
    force-field

Range:
    20 ft

Effect:
    prevent carrier moving closer
```

Do not implement this in v1.

---

# 52. Movement Constraints Need an SDK Spike

Before implementing movement constraints, determine what current OBR APIs permit.

Investigate whether extension code can:

```text
prevent built-in Move-tool motion
intercept a drag before commit
replace movement with custom interaction
detect an invalid move and revert it
temporarily lock an item
```

Do not assume `scene.items.onChange()` provides cancellable movement.

Possible implementations to test later:

```text
A. pre-movement interception

B. post-movement rollback

C. temporary shared locking

D. extension-specific movement tool
```

The generic effect schema must not depend on which technique eventually succeeds.

---

# 53. Configuration Permissions

Version 1:

```text
GM configures emitters and detectors.
```

Players still execute the local runtime.

Players may see effects according to audience.

Use role-aware context menu/UI behavior.

Structure permissions so future versions may allow player configuration.

---

# 54. Main Item Configuration UI

Provide a GM context-menu entry:

```text
Proximity Signals…
```

An item may be:

```text
emitter only
detector only
both
neither
```

Editor layout:

```text
PROXIMITY SIGNALS

Emitter
────────────────

Signals:
[ orc × ] [ evil × ]

[ + Add Signal ]


Detector
────────────────

Enabled: [✓]

Rules

ORC · 60 ft
3 effects
[ Edit ]

ORC · 30 ft
1 effect
[ Edit ]

UNDEAD · 20 ft
2 effects
[ Edit ]

[ + Add Detection Rule ]
```

---

# 55. Signal Input UI

Use chip/tag entry.

Example:

```text
[ orc × ] [ evil × ] [ goblin × ]

[ Add signal… ]
```

Autocomplete signals currently found in the scene.

Users may still create new signals.

Do not create a central persistent signal registry.

---

# 56. Detection Rule Editor

Example:

```text
DETECTION RULE

Signal
[ orc                 ]

Outer range
[ 60 ] ft

Full strength at
[ 5 ] ft

Falloff
[ Smooth ▼ ]

Effects
────────────────

1. Glow
   Target: Detector
   Audience: Carrier owner
   [ Edit ]

2. Outline
   Target: Detected emitter
   Audience: GM
   [ Edit ]

[ + Add Effect ]

[ Delete Rule ]
```

---

# 57. Effect Editor

For shader effects:

```text
EFFECT

Type
[ Shader ▼ ]

Target
[ Detector ▼ ]

Audience
[ Carrier owner ▼ ]

Preset
[ Glow ▼ ]

Color
[ ■ #55aaff ]

Maximum intensity
[ slider ]

Spread
[ slider ]

[ Delete Effect ]
```

Pulse/flicker additionally expose:

```text
rate
depth
```

---

# 58. Specific Item Target Picker

For:

```text
target = specific-item
```

provide a reasonable item-selection workflow.

Possible approaches:

```text
select currently selected OBR item
choose from searchable scene list
pick an item using a temporary tool mode
```

Choose the approach best suited to the existing application.

Store:

```text
itemId
```

and display the item's current name for human readability.

The ID remains authoritative.

---

# 59. Specific User Audience Picker

Use current party data to allow selection of users.

Store:

```ts
userIds: string[]
```

not display names.

Display names are UI labels only.

If a stored user is offline:

```text
retain user ID
show "offline/unknown user" if necessary
```

Do not silently discard them.

---

# 60. Validation

Validate all metadata.

Emitter:

```text
version supported
signals is an array
signals normalize successfully
```

Rule:

```text
stable ID
signal nonempty
outer > 0
inner >= 0
inner < outer
valid aggregation
valid falloff
effects is an array
```

Shader effect:

```text
stable ID
valid target
valid audience
valid preset
valid color
0 <= maxIntensity <= sensible maximum
spread > 0
animation values sane
```

Invalid configuration must not crash the background engine.

Skip invalid entities and log useful diagnostics.

---

# 61. Metadata Parsing

Never directly cast metadata:

```ts
const metadata =
  item.metadata[KEY] as DetectorMetadata;
```

Prefer:

```ts
parseEmitterMetadata(...)
parseDetectorMetadata(...)
parseDetectionRule(...)
parseEffectDefinition(...)
```

Use versioned parsing.

---

# 62. Schema Versioning

Both emitter and detector metadata must include:

```json
{
  "version": 1
}
```

Keep migrations centralized.

Example:

```ts
function parseDetectorMetadata(
  value: unknown
): ParsedDetector | null {
  // validate
  // migrate if necessary
}
```

Future effect types should not require a detector-wide schema redesign.

---

# 63. Scene Item Change Handling

Subscribe to:

```ts
OBR.scene.items.onChange(...)
```

The callback supplies a complete current item list.

Treat that as the latest authoritative snapshot.

Movement can generate frequent updates.

Do not launch unlimited overlapping asynchronous calculations.

---

# 64. Reconciliation Scheduler

Use coalescing.

Conceptually:

```text
item change
item change
item change
item change
       ↓
one reconciliation
```

If a reconciliation is already running:

```text
mark dirty
finish current reconciliation
run once more using latest snapshot
```

Avoid:

```text
parallel distance calculations
stale Effect writes
race conditions
```

---

# 65. Grid Changes

Subscribe to grid changes.

On change:

```text
refresh measurement information
recalculate all active detector rules
reconcile effects
```

Changes in:

```text
measurement mode
grid scale
grid type
```

may change detection results.

---

# 66. Player and Party Changes

Subscribe to local player changes because:

```text
role
identity-related state
```

may affect audiences.

Subscribe to party changes so UI and runtime ownership/audience data remain current.

On relevant changes:

```text
reevaluate effect audiences
reconcile local effects
```

---

# 67. Scene Lifecycle

When no scene exists:

```text
clear detector index
clear emitter index
clear attachment index
remove extension-created local effects
stop unnecessary evaluation
```

When a new scene becomes ready:

```text
load scene
build indexes
evaluate all rules
reconstruct appropriate local effects
```

Never carry detector runtime state from one scene to another.

---

# 68. Hidden Emitters

Desired semantic behavior:

```text
hidden emitters should still emit
```

Example:

```text
Invisible Orc
Hidden trap
Secret cursed item
```

A detector may reveal that something exists nearby without revealing its exact identity or location.

Do not filter emitters merely because:

```ts
item.visible === false
```

Test this with PLAYER clients.

If OBR does not expose hidden items to players, document the SDK limitation rather than attempting to bypass OBR visibility rules.

---

# 69. Effect Target Visibility

If the target itself is hidden:

- do not assume a shader can or should reveal it
- test actual OBR behavior
- respect OBR information boundaries

For example:

```text
GM-only effect targeting hidden emitter
```

may be valid.

A player-only shader that accidentally reveals a hidden secret object could leak game information.

Treat hidden target behavior as a security/game-information concern during testing.

---

# 70. Performance Strategy

Start simple.

Version 1 optimization:

```text
signal index
detector index
attachment-family lookup
coalesced updates
effect update epsilon
config hashes
```

Do not initially implement:

```text
quadtree
R-tree
spatial database
worker thread
```

Ordinary OBR scenes are likely manageable using indexed signal lists.

Keep distance code sufficiently isolated that spatial pre-filtering can be added later.

---

# 71. Potential Distance Prefilter

If performance becomes an issue, add a cheap pixel-distance prefilter before calling asynchronous grid-distance calculations.

This is an optimization only.

The final authoritative distance must still respect the OBR grid measurement model.

Do not add this until profiling shows a need.

---

# 72. Debug Mode

Create a local debug view.

For every active detector:

```text
Detector
Detector ID

Rule
    ID
    signal
    range
    matching emitter count
    detected emitter
    distance
    strength

Effect
    ID
    type
    target type
    resolved target
    audience
    local audience match
    runtime key
    local Effect ID
```

Example:

```text
Sting

Rule: orc · 60 ft
Matches: 4
Nearest: Orc Captain
Distance: 18.2 ft
Strength: 0.86

Effect: Blue Glow
Target: detector → Sting
Audience: carrier-owner
Audience Match: YES
Local Effect: 23ea…
```

Debug state is local only.

Never persist it.

---

# 73. Logging

Use structured development logging.

Useful categories:

```text
metadata
index
distance
rule
target
audience
shader
lifecycle
error
```

Allow debug logging to be disabled for production.

Do not spam the console for every trivial strength update.

---

# 74. Suggested Source Structure

Adapt to the repository if one already exists.

Suggested organization:

```text
src/

  constants.ts
  types.ts

  metadata/
    emitter.ts
    detector.ts
    rules.ts
    effects.ts
    migrations.ts

  signals/
    normalize.ts
    index.ts

  scene/
    indexes.ts
    attachments.ts
    ownership.ts
    targets.ts

  proximity/
    distance.ts
    aggregation.ts
    strength.ts
    evaluateRule.ts
    engine.ts
    scheduler.ts

  audience/
    resolveAudience.ts

  effects/
    types.ts
    registry.ts

    shader/
      definition.ts
      executor.ts
      registry.ts
      buildEffect.ts
      shaders.ts
      uniforms.ts

    future/
      property.ts
      movementConstraint.ts

  runtime/
    background.ts
    lifecycle.ts
    reconcile.ts

  ui/
    ItemEditor.tsx
    EmitterEditor.tsx
    DetectorEditor.tsx
    RuleEditor.tsx
    EffectEditor.tsx
    SignalInput.tsx
    TargetPicker.tsx
    AudiencePicker.tsx
    DebugView.tsx
```

Do not move unrelated project code just to match this structure.

---

# 75. Pure Functions

Where possible, implement and unit test:

```ts
normalizeSignal()

validateEmitterMetadata()

validateDetectorMetadata()

calculateRawStrength()

applyFalloff()

indexEmittersBySignal()

buildAttachmentGraph()

resolveCarrier()

isSameAttachmentFamily()

resolveEffectTarget()

isAudienceMember()

buildRuntimeEffectKey()
```

Avoid embedding all logic inside React components or OBR callbacks.

---

# 76. Required Unit Tests

## Signals

```text
" Orc " → "orc"
"ORC" → "orc"
duplicate values removed
empty signals rejected
```

## Strength

Test:

```text
outside outer range → 0
exact outer boundary → 0
inside inner range → 1
exact inner boundary → 1
linear midpoint
smoothstep midpoint
binary inside
binary outside
```

## Rule duplication

Ensure multiple rules with:

```text
signal = orc
```

are valid when rule IDs differ.

## Attachment graph

Test:

```text
detector
parent
carrier
siblings
descendants
unrelated items
```

## Self-family filtering

A detector must not detect emitters in its own attachment family.

## Target resolution

Test:

```text
detector
parent
carrier
detected-emitter
specific-item
missing specific item
```

## Audience resolution

Test:

```text
everyone
GM
players
detector owner
carrier owner
target owner
specific user
nonmatching user
```

## Runtime keys

Ensure different:

```text
rules
effects
targets
```

cannot collide.

## Effect arrays

Ensure:

```text
zero effects
one effect
many effects
```

all parse correctly.

---

# 77. Integration Test: Basic Sting

Create:

```text
Bilbo
└── Sting
```

Configure Orc token:

```text
signals:
    orc
```

Configure Sting:

```text
Rule:
    signal = orc
    outer = 60 ft
    inner = 5 ft
    falloff = smoothstep

    Effects:
        shader glow
        target = detector
        audience = everyone
        color = blue
```

Confirm:

```text
outside 60 ft → no glow
inside 60 ft → glow
closer → stronger
inside 5 ft → maximum
```

---

# 78. Integration Test: Owner-Only Sting

Change:

```text
audience = carrier-owner
```

Use:

```text
GM client
Bilbo owner's client
second player's client
```

Expected:

```text
Bilbo owner → sees glow
GM → does not unless owner
second player → does not
```

If ownership resolution behaves differently due to OBR owner assignment, document and adapt `resolveItemOwnerId()`.

---

# 79. Integration Test: GM Secret Information

Configure second effect:

```text
Effect:
    type = shader
    preset = outline
    target = detected-emitter
    audience = GM
```

Expected:

```text
GM sees nearest Orc highlighted
players do not
```

This must be accomplished entirely with local Effect items.

---

# 80. Integration Test: Different Targets

One rule:

```text
signal = orc
range = 60
```

Effects:

```text
A:
    glow detector

B:
    glow carrier

C:
    outline detected emitter

D:
    glow specific scene item
```

Confirm each target resolves independently.

---

# 81. Integration Test: Target Changes

Create:

```text
Orc A = 15 ft
Orc B = 25 ft
```

Effect target:

```text
detected-emitter
```

Confirm effect is on Orc A.

Move Orc A to 40 ft.

Confirm:

```text
nearest emitter becomes Orc B
old local effect on Orc A disappears
new local effect appears on Orc B
```

No orphan local Effect may remain.

---

# 82. Integration Test: Multiple Effects

Single rule with three shader effects.

Confirm all three execute independently.

Deleting one effect must not affect the others.

---

# 83. Integration Test: Multiple Same-Signal Rules

Configure:

```text
orc / 60 ft → static glow
orc / 30 ft → pulse
orc / 10 ft → emitter outline
```

Move Orc through all ranges.

Confirm rules layer naturally.

---

# 84. Integration Test: Multiple Signals

Configure detector:

```text
orc → blue
undead → green
magic → violet
```

Place all three emitter types nearby.

Confirm independent simultaneous evaluation.

---

# 85. Integration Test: Multiple Emitters

Place:

```text
Orc A 50 ft
Orc B 20 ft
Orc C 40 ft
```

Nearest result:

```text
Orc B
```

Move Orc B outside range.

Confirm correct next nearest emitter becomes active.

---

# 86. Integration Test: Detector Movement

Hold emitter stationary.

Move detector.

Confirm effects update continuously.

---

# 87. Integration Test: Carrier Movement

Detector is an attachment.

Move carrier.

Confirm:

```text
detector distance updates
shader follows target
```

---

# 88. Integration Test: Scene Reload

Reload browser.

Without opening configuration UI:

```text
metadata remains
background runtime starts
indexes rebuild
correct local effects are recreated
```

---

# 89. Integration Test: Scene Switching

Switch scenes and return.

Confirm:

```text
no orphan local Effects
no stale indexes
no wrong detector targets
no previous-scene runtime entries
```

---

# 90. Integration Test: Rule and Effect Deletion

Delete:

```text
one effect
one rule
entire detector
```

Confirm corresponding local runtime entries disappear immediately.

---

# 91. Integration Test: Hidden Emitter

Hide a matching emitter.

Test separately as:

```text
GM
PLAYER
```

Record what data OBR exposes.

Do not deliberately reveal hidden scene data that OBR does not provide to that client.

---

# 92. Integration Test: Specific Users

Configure:

```text
audience:
    specific-users
```

Select one connected player.

Confirm:

```text
selected user sees effect
others do not
```

Disconnect/reconnect selected player.

Confirm persistent user ID still matches.

---

# 93. Integration Test: Grid Measurement

Test representative modes:

```text
EUCLIDEAN
CHEBYSHEV
MANHATTAN
ALTERNATING
```

Confirm detection matches OBR measurement behavior.

Also test at least:

```text
5 ft grid
1 m grid
```

---

# 94. Shader Acceptance Criteria

Do not consider the shader implementation complete until:

- [ ] Effect is local-only.
- [ ] Effect can target arbitrary shared scene items.
- [ ] Effect follows target movement.
- [ ] Effect follows attachments correctly.
- [ ] Strength updates without recreating Effect every time.
- [ ] Strength zero produces no visible artifact.
- [ ] Multiple effects can coexist.
- [ ] Effect does not interfere with clicking.
- [ ] Transparent artwork behaves acceptably.
- [ ] Effects clean up after configuration deletion.
- [ ] Effects clean up after scene changes.
- [ ] Effects reconstruct after reload.
- [ ] Per-user audience filtering works.
- [ ] A `detected-emitter` effect moves correctly when nearest emitter changes.

---

# 95. Future Property Effect Acceptance Gate

Do not begin implementing shared property effects until:

```text
shader v1 is stable
multiplayer audience model works
target resolution is mature
```

Before property effects ship, separately design:

```text
GM authority
multiple-GM behavior
baseline restoration
conflicting effects
human edits during active effects
scene reload recovery
```

---

# 96. Future Movement Constraint Acceptance Gate

Do not begin implementation until an SDK prototype answers:

```text
Can movement be intercepted before commit?

Can standard OBR movement be cancelled?

Can invalid movement be rolled back cleanly?

Can constraints be enforced only for selected users?

What happens if GM moves the item?

What happens with multi-token movement?

What happens with attachments?
```

Keep movement constraints out of v1 production behavior.

---

# 97. Do Not Implement Yet

Do not let these features derail v1:

```text
line of sight
walls
fog blocking
audio
chat
macros
property mutations
movement constraints
sum aggregation
count aggregation
directional detection
emitter strength
signal attenuation
3D distance/elevation
token-edge distance
polygon intersection
path crossing
enter/exit event scripts
custom user shader source
arbitrary JavaScript
network synchronization of strength
```

The architecture should accommodate future features, but they are not v1 requirements.

---

# 98. Development Order

## Phase 1: Repository inspection

Before coding:

- inspect existing project structure
- identify manifest ID
- identify OBR SDK version
- preserve existing conventions
- confirm background/action setup
- run existing tests/build

Do not perform unnecessary restructuring.

## Phase 2: OBR Effect spike

Prove:

```text
Effect creation
attachment
uniform updates
target behavior
POST_PROCESS behavior
transparent image behavior
cleanup
```

## Phase 3: Metadata model

Implement:

```text
emitter schema
detector schema
rule schema
effects[]
targets
audiences
parsers
validation
versioning
```

Add tests.

## Phase 4: Scene indexes

Implement:

```text
signal index
detector index
attachment graph
owner resolver
```

## Phase 5: Proximity evaluation

Implement:

```text
distance
nearest emitter
strength
falloff
```

Expose results in debug UI before adding visual behavior.

## Phase 6: Target and audience resolution

Implement:

```text
resolveEffectTarget()
isAudienceMember()
```

Add comprehensive tests.

## Phase 7: Effect executor architecture

Implement:

```text
executor interface
executor registry
runtime effect context
effect reconciliation
```

## Phase 8: Shader executor

Implement shader presets and local Effect registry.

## Phase 9: Background lifecycle

Ensure the whole system functions with UI closed.

## Phase 10: Configuration UI

Implement:

```text
emitter editor
rules editor
effects array editor
target picker
audience picker
shader editor
```

## Phase 11: Multiplayer tests

Test at least:

```text
GM
Player A
Player B
```

especially audience filtering.

## Phase 12: Cleanup

Ensure:

```text
TypeScript passes
tests pass
build passes
mobile layout works
light theme works
dark theme works
debug logging can be disabled
known SDK limitations documented
```

---

# 99. Complete Example Metadata

## Orc

```json
{
  "version": 1,
  "signals": [
    "orc",
    "evil"
  ]
}
```

## Sting

```json
{
  "version": 1,
  "enabled": true,

  "rules": [
    {
      "id": "rule-orc-long",
      "enabled": true,

      "signal": "orc",

      "range": {
        "outer": 60,
        "inner": 5
      },

      "aggregation": "nearest",
      "falloff": "smoothstep",

      "effects": [
        {
          "id": "sting-blue-glow",

          "type": "shader",
          "enabled": true,

          "target": {
            "type": "detector"
          },

          "audience": {
            "type": "carrier-owner"
          },

          "preset": "glow",
          "color": "#55aaff",

          "maxIntensity": 1,
          "spread": 1.25,

          "animation": {
            "rate": 1,
            "depth": 0
          }
        },

        {
          "id": "gm-orc-outline",

          "type": "shader",
          "enabled": true,

          "target": {
            "type": "detected-emitter"
          },

          "audience": {
            "type": "gm"
          },

          "preset": "outline",
          "color": "#ff5555",

          "maxIntensity": 0.8,
          "spread": 1,

          "animation": {
            "rate": 1,
            "depth": 0
          }
        }
      ]
    },

    {
      "id": "rule-orc-close",
      "enabled": true,

      "signal": "orc",

      "range": {
        "outer": 20,
        "inner": 5
      },

      "aggregation": "nearest",
      "falloff": "smoothstep",

      "effects": [
        {
          "id": "sting-close-pulse",

          "type": "shader",
          "enabled": true,

          "target": {
            "type": "detector"
          },

          "audience": {
            "type": "carrier-owner"
          },

          "preset": "pulse",
          "color": "#66ccff",

          "maxIntensity": 1,
          "spread": 1.5,

          "animation": {
            "rate": 2,
            "depth": 0.4
          }
        }
      ]
    }
  ]
}
```

---

# 100. Example Runtime Evaluation

Given:

```text
Sting detects orc

Orc A = 80 ft
Orc B = 35 ft
Orc C = 18 ft
```

For the 60 ft rule:

```text
matching emitters:
    A
    B
    C

nearest:
    Orc C

distance:
    18 ft

raw strength:
    (60 - 18) / (60 - 5)
    = 42 / 55
    ≈ 0.764

smoothstep:
    ≈ 0.859
```

The rule produces:

```text
strength = 0.859
detectedEmitter = Orc C
```

Effect 1:

```text
target:
    detector → Sting

audience:
    carrier owner

if local client is carrier owner:
    render blue Sting glow
```

Effect 2:

```text
target:
    detected emitter → Orc C

audience:
    GM

if local client is GM:
    render red outline on Orc C
```

One proximity calculation drives both effects.

---

# 101. Architectural Invariants

Treat these as non-negotiable.

## Invariant 1

Emitters contain signals only.

## Invariant 2

Detection logic lives on detectors.

## Invariant 3

A detection rule contains an `effects[]` array.

## Invariant 4

Multiple rules may detect the same signal.

## Invariant 5

Every effect has its own stable identity.

## Invariant 6

Every effect specifies a target.

## Invariant 7

Local effects may specify an audience.

## Invariant 8

Rule strength is calculated before effects execute.

## Invariant 9

Effects do not perform their own proximity calculations.

## Invariant 10

The proximity engine does not contain effect-type-specific rendering logic.

## Invariant 11

Effect types are implemented through executors.

## Invariant 12

Local shader state is never stored in shared scene metadata.

## Invariant 13

Shared property mutation and local visual effects are fundamentally different scopes.

## Invariant 14

No future shared mutation may be executed independently by every client.

## Invariant 15

Renderer limitations must not force changes to the metadata architecture.

---

# 102. Definition of Done for Version 1

Version 1 is complete when this scenario works:

1. A CHARACTER token exists.
2. A sword is attached to it.
3. The sword is configured as a detector.
4. The detector contains multiple detection rules.
5. Multiple rules may listen for the same signal.
6. Every rule stores `effects[]`.
7. A rule may contain multiple effects.
8. Orc tokens can be tagged with `orc`.
9. The sword detects the nearest Orc.
10. Rule strength changes with distance.
11. A shader can target the sword.
12. Another shader from the same rule can target the detected Orc.
13. Each shader may have a different audience.
14. The sword's owner may see an effect other players cannot see.
15. The GM may see an effect that ordinary players cannot see.
16. Effects follow their target objects.
17. Effects respond while items move.
18. Effects continue working while the extension UI is closed.
19. Effects survive page reload through automatic local reconstruction.
20. Effects clean up after rules, effects, detectors, targets, or scenes disappear.
21. Different signals require configuration only, not new code.

The following must all be possible using the same mechanism:

```text
Sting detects Orcs

holy symbol detects undead

amulet detects magic

Geiger counter detects radiation

compass detects treasure

ward detects intruders

artifact detects another artifact
```

No game-specific logic should exist in the engine.

---

# 103. Final Guiding Model

Think of the extension as a tiny declarative proximity rules engine:

```text
EMITTER
    "I emit these signals."

DETECTOR RULE
    "When this signal is this close,
     produce this strength."

EFFECT
    "Using that strength,
     do this to this target,
     for this audience."

EXECUTOR
    "I know how to perform
     this kind of effect."

RUNTIME
    "I continuously reconcile
     configuration with reality."
```

Build the architecture around that model.

Do not build a glowing-sword extension.

Build the general system of which a glowing sword is merely the first delightful example.
