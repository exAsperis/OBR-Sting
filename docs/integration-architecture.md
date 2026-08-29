# Sting modular integration architecture

Status: core architecture and the first Auras & Emanations adapter implemented. Other
provider sections remain design guidance pending stable public APIs.

## 1. Executive decision

Sting should keep its current rule evaluation model and evolve the executor registry into two levels:

```text
proximity evaluation (once per detector/rule)
  -> lifecycle derivation (once per detector/rule)
  -> generic effect dispatch (once per configured effect)
     -> native executor, or
     -> integration executor -> provider registry -> provider adapter
```

The proximity engine must only understand effect identity, lifecycle, resolved target,
resolved audience, and the current/previous rule snapshot. It must not import or switch
on Auras & Emanations, Soundboard+, Rumble!, or any future provider.

Native and integration effects should share a small `EffectExecutor` protocol at the
dispatch boundary, but remain different persisted discriminated unions. This gives the
runtime one composition mechanism without flattening provider/action/version concerns
into every native effect.

“Provider” in this document means a trusted, developer-authored TypeScript adapter that
is compiled and shipped with Sting. This is an internal extension point for Sting's code,
not a user-defined integration mechanism. Users may configure only the provider IDs,
action IDs, and validated parameters that the installed Sting build explicitly exposes.
They cannot register providers, choose broadcast channels, define request payloads,
upload adapter code, or create new actions through metadata. Supporting a future
extension means a Sting developer adds and reviews an adapter module, registers it in the
composition root, and releases a new Sting build.

The minimum persisted lifecycle vocabulary should be:

```ts
type EffectLifecycle = "continuous" | "enter" | "exit" | "nearest-change";
```

Do not add `approaching`, `receding`, or arbitrary threshold events yet. They can later
be added as explicit, versioned lifecycle variants if real providers need them.

## 2. Current Sting architecture

The current implementation already has several useful seams:

- `src/proximity/evaluate.ts` calculates one nearest-emitter `RuleEvaluation` containing
  detector, rule, emitter, distance, match count, and strength.
- `src/runtime/engine.ts` resolves each effect target and local audience after evaluating
  a rule. It groups desired effects by `effect.type` and reconciles registered executors.
- `src/effects/registry.ts` registers executors by effect type. Each executor owns its
  transient reconciliation state.
- `ShaderEffectExecutor` is local and stateful. It creates, updates, or deletes local OBR
  effect items and already uses an epsilon to suppress insignificant strength updates.
- `EmanationEffectExecutor` is a stateful broadcast adapter in embryonic form. It sends
  A&E's documented `CREATE_AURAS_PRESETS` and `REMOVE_AURAS` messages, and keeps local
  runtime state.
- Targets (`detector`, `parent`, `carrier`, `detected-emitter`, `specific-item`) and
  audiences are generic and resolved centrally in `src/scene/resolve.ts`.
- Detector metadata is parsed defensively as a closed V1 discriminated union.
- The debug view consumes locally derived state from `localStorage`; it does not persist
  runtime state into scene metadata.

Important current limitations:

- Active is inferred only from `strength > 0`; no prior rule state exists, so enter,
  exit, and nearest-change cannot be derived.
- Effects only enter the desired set while active. That is sufficient for resource
  reconciliation, but not for one-shot exit events.
- A&E is a first-class effect type (`emanation`) and is registered directly by the
  engine. Repeating that pattern would make the engine/provider list grow together.
- A&E availability is a local manual flag, not a provider status contract.
- Audience filtering happens before execution. That works for local visuals but is not
  sufficient for a single-authority provider sending targeted or shared consequences.
- One outer engine catch means an executor failure can abort later executors during the
  same pass.
- The runtime key omits effect kind/provider/action. IDs are expected to be unique, but
  including these fields makes diagnostics and state migrations safer.
- The editor has hard-coded React forms for shaders and A&E.

The proposed design is therefore an evolution, not a repository rewrite.

## 3. Persisted effect model

Keep detector metadata versioned at the envelope and each integration payload versioned
at its provider schema boundary:

```ts
type EffectDefinitionV2 = NativeEffectDefinitionV2 | IntegrationEffectDefinitionV1;

interface EffectBaseV2 {
  id: string;
  enabled: boolean;
  target: EffectTargetV1;
  audience: EffectAudienceV1;
  lifecycle: EffectLifecycle;
}

interface NativeEffectDefinitionV2 extends EffectBaseV2 {
  type: "native";
  nativeKind: "shader" | "pointer" | "tether"; // closed Sting-owned union
  config: NativeEffectConfig;                    // discriminated by nativeKind
}

interface IntegrationEffectDefinitionV1 extends EffectBaseV2 {
  type: "integration";
  providerId: string;       // stable Sting adapter ID, not a broadcast channel
  providerSchemaVersion: number;
  actionId: string;         // must match an action declared by the adapter
  parameters: JsonObject;   // parsed by that action's validator
  unavailablePolicy?: "skip"; // reserve the field; only safe policy in V1
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
```

Why this differs from the suggested schema:

- `type: "integration"` is the only integration executor type. Providers are data and
  registry entries, not additions to the core `EffectDefinition` union.
- `providerSchemaVersion` describes the stored parameters contract shipped by Sting's
  adapter. It is not the external extension's release version.
- `parameters` is JSON, not unconstrained `unknown`, at the persistence boundary.
  It becomes typed only after provider validation.
- `target` and `audience` remain on the common effect because they are Sting semantics.
- `lifecycle` is explicit for native effects too. Existing shaders migrate to
  `continuous`; existing A&E effects migrate to an integration action described below.
- Do not store arbitrary channels, method names, code, templates with executable
  expressions, or provider runtime handles.

For the least disruptive first implementation, existing `type: "shader"` can remain
as a V1 native variant while `type: "integration"` is introduced. The cleaner V2
`type: "native"` shape should be a metadata migration, not a prerequisite.

## 4. Runtime snapshots and lifecycle derivation

Lifecycle is derived once per enabled detector/rule, before effect dispatch:

```ts
interface RuleSnapshot {
  active: boolean;
  strength: number;
  distance: number | null;
  detectedEmitterId: string | null;
}

interface RuleRuntimeState {
  current: RuleSnapshot;
  previous: RuleSnapshot | null;
  revision: number;
  evaluatedAt: number;
}

type RuleTransition =
  | { type: "inactive" }
  | { type: "enter" }
  | { type: "continuous" }
  | { type: "nearest-change"; fromEmitterId: string; toEmitterId: string }
  | { type: "exit" };
```

`active` is `strength > 0 && detectedEmitterId !== null`. Transition precedence for one
reconciliation pass is:

1. previous inactive/current active -> `enter`
2. previous active/current inactive -> `exit`
3. both active and emitter changed -> `nearest-change`
4. both active -> `continuous`
5. otherwise -> `inactive`

An effect consumes the transition matching its configured lifecycle. A continuous
effect also receives its initial desired state on enter and remains desired until exit;
it does not need separate enter/exit effect records merely to reconcile a resource.

The `RuleRuntimeState` map is keyed by detector ID + rule ID and is local, transient,
and cleared when the scene closes. Removed or disabled rules are treated as inactive for
one final reconciliation so active resources can be released and exit effects can be
considered. State is removed after cleanup completes.

`activate`/`deactivate` should be adapter operations, not public lifecycle values:
activation is how a stateful continuous provider reconciles an absent handle to a
desired resource; deactivation is how it reconciles an obsolete handle. `Approaching`
and `receding` are deliberately deferred because noise needs hysteresis and they imply
a second event policy. `Threshold-crossed` should later be modeled with an explicit
threshold in metadata, not hidden inside a provider parameter.

## 5. Dispatch context

All executors receive an immutable, already-resolved context:

```ts
interface EffectExecutionContext {
  runtimeKey: string;
  detector: Item;
  rule: DetectionRuleV2;
  effect: EffectDefinitionV2;
  detectedEmitter: Item | null;
  target: Item | null;
  audience: ResolvedAudience;
  localPlayer: Pick<Player, "id" | "role" | "connectionId">;
  party: Player[];
  graph: AttachmentGraph;
  current: RuleSnapshot;
  previous: RuleSnapshot | null;
  transition: RuleTransition;
  now: number;
}

interface ResolvedAudience {
  definition: EffectAudienceV1;
  userIds: string[];       // resolved known recipients
  includesLocalPlayer: boolean;
  visibility: "public" | "private";
  resolution: "complete" | "partial";
}
```

The context includes source objects for providers that need them, but target selection
is never reimplemented by providers. A missing target is a normal non-executable state
and should produce a debug reason, not a thrown error.

## 6. Common executor boundary

Use one small executor contract for composition, with separate native and integration
internals:

```ts
interface EffectExecutor<T extends EffectDefinitionV2 = EffectDefinitionV2> {
  readonly type: T["type"];
  reconcile(batch: EffectDispatchBatch<T>): Promise<EffectReconcileReport>;
  clear(reason: "scene-close" | "shutdown"): Promise<void>;
}

interface EffectDispatchBatch<T> {
  desiredContinuous: EffectExecutionContext[];
  events: EffectExecutionContext[]; // enter, exit, nearest-change
}
```

`NativeEffectExecutor` can continue managing local OBR items. A single
`IntegrationEffectExecutor` validates integration definitions, groups them by provider,
and delegates to provider adapters. The proximity engine only registers those broad
executors. Adding a provider changes the integration composition root, not the engine.

Alternative rejected: making every provider a core executor type. It is simple at first,
but leaks provider IDs into metadata parsing, engine grouping, debug assumptions, and UI
switches. Alternative rejected: one enormous universal executor interface whose config
is all `unknown`; it loses exhaustiveness for native effects and makes validation unsafe.

## 7. Provider and action contracts

```ts
type ProviderAvailability =
  | { status: "available"; apiVersion?: string; checkedAt: number }
  | { status: "unavailable"; reason?: string; checkedAt: number }
  | { status: "incompatible"; foundVersion?: string; reason: string; checkedAt: number }
  | { status: "unknown"; reason?: string; checkedAt: number };

interface IntegrationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly schemaVersion: number;
  readonly actions: readonly IntegrationActionDefinition[];

  getAvailability(options?: { force?: boolean }): Promise<ProviderAvailability>;
  validate(effect: IntegrationEffectDefinitionV1): ValidationResult;
  migrate?(fromVersion: number, parameters: JsonObject): MigrationResult;
  reconcile(input: ProviderReconcileInput): Promise<ProviderReconcileResult>;
  clear(reason: "scene-close" | "shutdown"): Promise<void>;
}

interface IntegrationActionDefinition {
  id: string;
  displayName: string;
  description?: string;
  allowedLifecycles: readonly EffectLifecycle[];
  execution: "local-each-client" | "single-authority";
  audienceMode: "local-filter" | "provider-recipients" | "public-only";
  target: {
    required: boolean;
    allowed: readonly EffectTargetV1["type"][];
  };
  parameters: readonly ParameterFieldDefinition[];
  editor?: ProviderEditorComponent;
  validateParameters(value: JsonObject): ValidationResult;
  defaults(): JsonObject;
  stateful: boolean;
  resultKind: "none" | "handle" | "structured";
}
```

`reconcile`, rather than public `execute`/`deactivate`, is the provider-level primitive.
It can consume desired continuous states, lifecycle events, and its prior handles in one
idempotent operation. Internally, an adapter may expose `activate`, `update`, `deactivate`,
and `fireEvent` helpers. This avoids forcing a fire-and-forget provider into fake handles
or a stateful provider into stateless repeated calls.

The adapter must dispatch by a closed local action table. Metadata supplies `actionId`,
which selects code already shipped with Sting. It never supplies a function name or
broadcast channel.

The registry is therefore not a public runtime plugin API. It has no metadata-driven
`register`, dynamic import URL, discovery manifest, or user-facing “custom provider” UI.
Its purpose is compile-time modularity: keeping each shipped integration isolated so a
developer can add one without editing proximity logic.

## 8. Provider registry

```ts
class IntegrationProviderRegistry {
  private readonly providers = new Map<string, IntegrationProvider>();

  register(provider: IntegrationProvider): void {
    if (this.providers.has(provider.id)) throw new Error(`Duplicate provider ${provider.id}`);
    this.providers.set(provider.id, provider);
  }
  get(id: string): IntegrationProvider | undefined { return this.providers.get(id); }
  list(): readonly IntegrationProvider[] { return [...this.providers.values()]; }
}

export function createIntegrationRegistry(): IntegrationProviderRegistry {
  const registry = new IntegrationProviderRegistry();
  registry.register(aurasEmanationsProvider);
  registry.register(soundboardPlusProvider);
  registry.register(rumbleProvider);
  return registry;
}
```

The composition root is the only provider list. Lazy registration can later support
bundled code splitting, but must never load an arbitrary user-supplied URL. Duplicate IDs
fail during startup. Unknown persisted provider IDs remain intact, appear as unavailable
in the editor/debugger, and are skipped at runtime; they do not cause Sting to seek or
install third-party adapter code.

## 9. Declarative parameters and specialized editors

Support a deliberately small field vocabulary:

```ts
type ParameterFieldDefinition =
  | { type: "text"; key: string; label: string; required?: boolean; placeholder?: string }
  | { type: "number"; key: string; label: string; min?: number; max?: number; step?: number }
  | { type: "boolean"; key: string; label: string }
  | { type: "select"; key: string; label: string; options: SelectOption[] }
  | { type: "multiselect"; key: string; label: string; options: SelectOption[] }
  | { type: "color"; key: string; label: string };
```

Do not add generic `item` and `user` parameter types initially: target and audience
already handle those concepts. Dynamic provider resources (sound, preset, animation)
need an async picker, refresh/error states, and often authentication; they should use a
specialized editor component. The generic renderer covers stable scalar fields such as
volume, text, color, and booleans. Specialized editors still return JSON parameters and
must use the same action validator.

This keeps the generic form small without forcing every provider into hard-coded parent
forms. The provider/action selector, lifecycle, target, audience, validation summary,
and unavailable banner remain common UI.

## 10. Target and audience handling

Sting resolves target references before dispatch. Providers receive `target: Item | null`
plus source IDs and must not walk attachments themselves.

Audience requires two distinct decisions:

1. `ResolvedAudience` converts role/owner definitions to known user IDs centrally.
2. The action's `audienceMode` determines delivery.

For `local-filter`, each client executes only when `includesLocalPlayer` is true. This is
appropriate for local shaders or audio that each intended recipient must play locally.
For `provider-recipients`, one elected authority invokes the provider once with user IDs;
this is appropriate for Rumble private messages. For `public-only`, the editor only
allows `everyone`, and a single authority invokes it.

Never implement a private provider action by broadcasting its secret payload to every
client and asking recipients to filter it locally. OBR broadcast data is inter-extension
messaging, not a privacy boundary. The official broadcast API supports `LOCAL`, `REMOTE`,
and `ALL`, but not user-ID destinations. Providers must use their documented recipient
mechanism for private delivery.

Single-authority execution is needed to prevent every Sting client from sending the same
shared message, roll, animation, or aura. Initial policy: the GM client is the authority
for shared/provider-recipient actions. If multiple GM connections are possible, elect a
deterministic connection (lowest connection ID among current GMs) and include an
idempotency key where the provider accepts one. A future lease/heartbeat is only needed
if prototypes show election races matter.

## 11. Availability and API discovery

OBR does not expose a universal “is extension installed” registry. Providers therefore
own discovery and cache status for a short TTL:

- Prefer a documented request/response readiness channel with request ID, timeout, and
  optional API version (Dice+ documents this pattern).
- Otherwise use a documented capability flag in room/player metadata if the provider
  explicitly declares it public.
- If a documented API is fire-and-forget with no handshake (currently A&E), report
  `unknown` unless an opt-in/manual setting or a future readiness response exists. A
  successful `sendMessage` only proves Sting sent a broadcast, not that another extension
  received it.
- Never inspect undocumented item metadata, iframe state, storage keys, or implementation
  details of another extension.

Availability checks run when opening the add/edit UI, on explicit refresh, and at a
bounded background TTL—not on every scene change. Timeouts are normal. Missing providers
retain configuration, skip without throwing, and emit one status/debug record.

Relevant public contracts reviewed for this design:

- [OBR Broadcast API](https://docs.owlbear.rodeo/extensions/apis/broadcast/)
- [OBR metadata guidance](https://docs.owlbear.rodeo/extensions/reference/metadata/)
- [OBR local scene items](https://docs.owlbear.rodeo/extensions/apis/scene/local/)
- [Auras & Emanations public integration API](https://extensions.owlbear.rodeo/auras-and-emanations)
- [Dice+ readiness and roll integration](https://extensions.owlbear.rodeo/dice-plus)

## 12. Stateful integration runtime

```ts
interface IntegrationRuntimeEntry {
  runtimeKey: string;
  providerId: string;
  actionId: string;
  targetId: string | null;
  status: "activating" | "active" | "updating" | "deactivating" | "error";
  configHash: string;
  lastStrength: number;
  externalHandle?: JsonValue; // memory only; provider-owned interpretation
  lastAttemptAt: number;
  lastSuccessAt?: number;
  failureCount: number;
  retryAfter?: number;
}
```

Entries live in a provider-owned map and are never written into detector metadata. A
provider reconciliation pass computes desired keys, deactivates obsolete entries, then
creates or updates desired entries. Config changes use a deterministic JSON hash. Strength
updates require action-specific epsilon and optional minimum interval; target/action
changes naturally produce a new key and retire the old state.

If an external API returns no handle, the provider can keep a logical handle containing
the target and sent configuration. If safe cleanup cannot identify only Sting-created
state, the action must disclose that limitation and default to non-destructive behavior.

## 13. Runtime identity, idempotency, and scheduling

Build keys from length-prefixed fields (as current code does) or a canonical hash:

```text
detectorId | ruleId | effectId | type | providerId/nativeKind | actionId | targetId-or-none
```

Do not include emitter ID for ordinary continuous effects: a nearest change should update
the same resource rather than orphaning it. Include emitter identity in the event's
idempotency token:

```text
runtimeKey | transitionType | ruleRevision | fromEmitterId | toEmitterId
```

The local transition state is the primary exactly-once guard. “Exactly once” is exact
within one running Sting client/runtime. Process crashes between sending an external
event and recording success can still duplicate unless the external provider supports
idempotency keys. Document this boundary and pass stable idempotency keys whenever an API
accepts them.

The engine's existing dirty-loop coalesces overlapping scene updates. Add:

- per-action continuous `minIntervalMs` and `strengthEpsilon` hints;
- config/target hashes so unchanged resources are untouched;
- serialized reconciliation per provider;
- optional trailing scheduled reconciliation when throttling defers the latest state.

Event transitions are never dropped by continuous throttling.

## 14. Error isolation and diagnostics

Catch errors at the narrowest effect/provider operation, then continue with siblings.
One Soundboard failure must not suppress native shader, A&E, or Rumble execution.

Each diagnostic contains provider, action, detector ID, rule ID, effect ID, runtime key,
transition, target ID, attempt time, and a sanitized error category/message. Do not log
private message bodies or arbitrary provider payloads.

Use a per-runtime-key error gate:

- log the first occurrence;
- suppress identical errors during exponential backoff (for example 1s, 5s, 30s, 5m);
- reset after success or configuration change;
- show failure count and next retry in debug UI.

Unavailable and unknown are statuses, not exceptions. Validation errors disable only the
bad effect. Registry startup errors are exceptional and should fail loudly in development.

## 15. Editor and debug UI

The add-effect flow should show two groups:

```text
Native effects
  Directional glow, pointer, tether, ...

Integrations
  Available
    Auras & Emanations, ...
  Unavailable or unverified
    Soundboard+ — extension unavailable
    Rumble! — API availability unknown
```

Keep unavailable providers visible so imported scene configuration is understandable and
users discover supported adapters. Allow selection/configuration with a clear warning,
but do not imply it will execute. Never delete the effect automatically.

The common integration editor renders provider, action, allowed lifecycle selector,
target, audience, status, and generic parameters. It mounts `action.editor` only for the
provider-specific portion. Changing action should request confirmation before discarding
incompatible parameters.

Prevent invalid combinations in controls and repeat validation on metadata parsing:

- action lifecycle must be in `allowedLifecycles`;
- target type must be permitted and resolved if required;
- audience must match the action's delivery mode;
- parameters must pass the action validator and size limits.

Debug state should add provider/action/schema version, availability, lifecycle,
previous/current snapshots, transition, authority decision, target, audience recipient
count (not private content), last attempt/result, last success, handle summary, suppression
count, and next retry. Runtime handles should be summarized/redacted rather than dumped.

## 16. Versioning and migration

Use three independent versions:

1. Detector metadata envelope version: Sting-owned structural migration (`version: 2`).
2. `providerSchemaVersion`: Sting adapter's persisted parameter schema.
3. Discovered external `apiVersion`: runtime compatibility only, never trusted as the
   persisted parameter schema.

Parsing flow:

1. Validate the detector envelope and common integration fields.
2. Look up the provider. If missing, preserve the raw JSON as a valid unresolved effect.
3. If provider exists and version is older, migrate in memory through sequential,
   deterministic migrations; validate the result.
4. If newer than supported, mark incompatible and preserve it unchanged.
5. Persist migrated metadata only through an explicit GM save/migration, not as a side
   effect of background evaluation.

Existing V1 `emanation` metadata can migrate to provider `auras-emanations`, action
`preset-aura`, lifecycle `continuous`, with `presetName` and cleanup policy parameters.
Existing shaders migrate to native continuous effects.

## 17. Worked provider: Auras & Emanations

Provider ID: `auras-emanations`; schema version 1.

Recommended first action: `preset-aura`, stateful, allowed lifecycle `continuous`. Its
provider reconcile activates by broadcasting `CREATE_AURAS_PRESETS` locally. There is no
documented per-created-aura handle or update operation. A config change therefore cannot
be safely reconciled without potentially duplicating. The adapter should initially treat
the action as create-on-activation with no automatic destructive cleanup.

The documented `REMOVE_AURAS` removes every aura on the source, including non-Sting
auras. Expose cleanup only as an explicit parameter such as `cleanup: "leave" |
"remove-all-with-warning"`, default `leave`. Do not describe it as precise deactivation.

An intensity-updated continuous A&E action is only plausible if a future public API can
identify and update a specific aura. Until then, proximity strength may be passed only to
actions whose public API actually supports it. The UI must not promise live strength.

Availability is `unknown` under the current fire-and-forget API unless the user enables
the adapter or A&E adds a handshake. Sending to `destination: "LOCAL"` is required by its
published contract.

## 18. Worked provider: Soundboard+

Provider ID: `soundboard-plus`; schema version 1 (provisional until its public inter-
extension contract is confirmed).

Candidate actions:

- `play-one-shot`: enter/nearest-change, event, usually local-filter or provider-recipient.
- `start-ambience`: continuous, stateful create/leave desired set.
- `stop-ambience`: exit, event, only if the API provides a stable sound/preset handle.
- `activate-preset`: enter, event.

Repeated enter/exit works naturally because a rule fires enter once, remains active
without replay, fires exit once, and may later enter again. Starting ambience should
store the provider handle if returned; exit/deactivation stops that handle. If no stable
stop handle exists, do not claim stateful cleanup—offer only documented one-shot actions.

The sound picker should be provider-specific because it likely needs an authenticated,
dynamic resource list. Volume can use a generic number field. Until the channel, message
schema, readiness protocol, recipient semantics, and idempotency behavior are publicly
verified, ship this adapter as unavailable/prototype rather than guessing.

## 19. Worked provider: Rumble!

Provider ID: `rumble`; schema version 1 (provisional pending a stable public API).

Candidate `send-message` is an enter/exit/nearest-change event action with
`audienceMode: "provider-recipients"` and `execution: "single-authority"`. Sting resolves
`carrier-owner` to user IDs. Only the authority calls Rumble, passing recipient IDs through
Rumble's documented private-recipient mechanism. If Rumble cannot guarantee private
recipient delivery, the action must not be offered for private audiences.

Candidate `roll-dice` is enter/nearest-change, event, and should return a structured result
only for diagnostics in V1. Sting does not branch on the result. A future conditional
system should be a separate design, not hidden in provider parameters.

Message text is stored metadata and therefore visible to clients that can read that scene
item. “Private delivery” does not make the configured secret itself private. The editor
must warn GMs not to store secret unrevealed text in broadly readable scene metadata; a
future secret-reference store would be a separate feature.

## 20. Other and future providers

Embers should begin as an enter-event `play-animation` adapter only if its public API
documents the channel and schema. Dice+ is a good early event prototype because it
documents readiness and roll broadcasts; structured results should be logged but ignored.

Behaviors and Causality require no reserved core branches. Once either publishes a stable
API, add one provider module declaring actions such as `trigger-behavior` or
`trigger-causality`, their lifecycle constraints, parameter validation/editor, availability
handshake, and reconcile mapping. The engine, transition model, target resolver, audience
resolver, and integration executor remain unchanged.

## 21. Sample metadata

Continuous A&E preset aura (cleanup is intentionally non-destructive):

```json
{
  "id": "fx-ae-undead-aura",
  "type": "integration",
  "enabled": true,
  "providerId": "auras-emanations",
  "providerSchemaVersion": 1,
  "actionId": "preset-aura",
  "lifecycle": "continuous",
  "target": { "type": "carrier" },
  "audience": { "type": "everyone" },
  "parameters": { "presetName": "Undead Warning", "cleanup": "leave" }
}
```

On-enter Soundboard+ sound (provisional action parameters):

```json
{
  "id": "fx-sound-whisper",
  "type": "integration",
  "enabled": true,
  "providerId": "soundboard-plus",
  "providerSchemaVersion": 1,
  "actionId": "play-one-shot",
  "lifecycle": "enter",
  "target": { "type": "carrier" },
  "audience": { "type": "carrier-owner" },
  "parameters": { "soundId": "whisper-01", "volume": 0.65 }
}
```

Private on-enter Rumble message (provisional action parameters):

```json
{
  "id": "fx-rumble-chill",
  "type": "integration",
  "enabled": true,
  "providerId": "rumble",
  "providerSchemaVersion": 1,
  "actionId": "send-message",
  "lifecycle": "enter",
  "target": { "type": "carrier" },
  "audience": { "type": "carrier-owner" },
  "parameters": { "message": "You feel an unnatural chill." }
}
```

## 22. Central reconciliation pseudocode

```ts
async function reconcileScene(snapshot: SceneSnapshot) {
  const graph = buildAttachmentGraph(snapshot.items);
  const signals = indexEmittersBySignal(snapshot.items);
  const nextRuleKeys = new Set<string>();
  const dispatch = createEmptyDispatchBatch();

  for (const detector of parseEnabledDetectors(snapshot.items)) {
    for (const rule of detector.rules.filter(r => r.enabled)) {
      const ruleKey = key(detector.id, rule.id);
      nextRuleKeys.add(ruleKey);

      // Exactly one proximity calculation for every rule.
      const evaluation = await evaluateRule(detector, rule, signals, graph, snapshot.scale);
      const previous = ruleStates.get(ruleKey)?.current ?? null;
      const current = toRuleSnapshot(evaluation);
      const transition = deriveTransition(previous, current);
      const state = advanceRuleState(ruleStates.get(ruleKey), current, snapshot.now);
      ruleStates.set(ruleKey, state);

      for (const effect of rule.effects.filter(e => e.enabled)) {
        const target = resolveEffectTarget(effect.target, evaluation, graph);
        const audience = resolveAudience(effect.audience, detector, target, snapshot.party, graph);
        const context = buildContext(evaluation, effect, target, audience, state, transition);

        if (!target && actionRequiresTarget(effect)) {
          debug.skip(context, "target-unresolved");
          continue;
        }

        if (effect.lifecycle === "continuous") {
          if (current.active) dispatch.addDesired(effect.type, context);
          // Absence from the desired set drives precise deactivation.
        } else if (transition.type === effect.lifecycle) {
          dispatch.addEvent(effect.type, context);
        }
      }
    }
  }

  // Removed/disabled rules get one synthetic exit/cleanup pass.
  appendRetiredRuleCleanup(ruleStates, nextRuleKeys, dispatch);

  for (const executor of effectExecutors.values()) {
    try {
      const report = await executor.reconcile(dispatch.forType(executor.type));
      debug.merge(report);
    } catch (error) {
      // Catastrophic executor error is isolated; providers/effects also catch internally.
      debug.executorFailure(executor.type, error);
    }
  }

  pruneRetiredRuleStates(ruleStates, nextRuleKeys);
  debug.publishLocalSnapshot();
}

async function reconcileIntegrations(batch: EffectDispatchBatch<IntegrationEffectDefinitionV1>) {
  const grouped = groupByProvider(batch);
  for (const [providerId, providerBatch] of grouped) {
    const provider = providers.get(providerId);
    if (!provider) { reportUnavailable(providerBatch, "adapter-not-installed"); continue; }

    const availability = await availabilityCache.get(provider);
    if (availability.status === "unavailable" || availability.status === "incompatible") {
      reportUnavailable(providerBatch, availability.status);
      continue;
    }

    const valid = validateAndAuthorize(provider, providerBatch);
    try {
      await provider.reconcile(valid); // provider isolates each runtime key internally
    } catch (error) {
      reportProviderFailure(providerId, error);
    }
  }
}
```

## 23. Recommended modules

```text
src/
  effects/
    types.ts
    dispatch.ts
    runtimeKey.ts
    native/
      executor.ts
      shader/...
    integrations/
      types.ts
      executor.ts
      registry.ts
      availability.ts
      validation.ts
      runtime.ts
      ui/
        IntegrationEffectEditor.tsx
        GenericParameterFields.tsx
      providers/
        aurasEmanations/
          provider.ts
          contract.ts
          editor.tsx
          provider.test.ts
        soundboardPlus/...
        rumble/...
  runtime/
    engine.ts
    lifecycle.ts
    ruleState.ts
    authority.ts
  scene/
    resolveTarget.ts
    resolveAudience.ts
  metadata/
    parse.ts
    migrations.ts
```

Keep provider broadcast constants and external payload types inside their provider folder.
Move current A&E constants out of global `constants.ts` when its adapter is extracted.

## 24. Risks and prototypes required

1. Confirm current public channels, request/response schemas, API versions, private
   recipient behavior, and idempotency for Soundboard+, Rumble!, and Embers with their
   maintainers or published source. Do not infer them from internal metadata.
2. Prototype A&E duplication and cleanup. Its current API has no per-created-aura handle;
   `REMOVE_AURAS` is destructive to unrelated auras.
3. Test whether A&E preset storage being local means every intended client must have the
   same named preset, and define UX for mismatches.
4. Verify multi-client ownership: which clients receive the same detector metadata and
   hidden emitter items, and whether GM authority sees everything needed for private
   dispatch without leaking it.
5. Prototype deterministic single-authority election across reconnects/multiple GM tabs.
6. Establish whether each audio/animation action executes locally or causes provider-side
   room-wide delivery; this changes audience mapping and duplicate prevention.
7. Determine payload and metadata size limits per provider. OBR broadcast data is JSON
   serializable and limited to 16KB; Sting should impose smaller action-specific bounds.
8. Test unavailable-to-available transitions and whether stateful continuous effects
   activate once when a provider becomes ready.
9. Decide whether configured private message bodies may live in shared item metadata or
   require a future GM-only/opaque reference store.
10. Add lifecycle unit tests for scene close, rule disable/delete, effect disable/delete,
    target loss, audience change, nearest swap, rapid boundary jitter, and failed sends.

## 25. Phased implementation plan

### Phase 1: lifecycle foundation

- Add `RuleSnapshot`, local rule state, transition derivation, and exhaustive tests.
- Split continuous desired state from event dispatch.
- Strengthen runtime keys and isolate executor errors.
- Preserve current shaders and A&E behavior through compatibility adapters.

### Phase 2: generic integration core

- Add the integration metadata variant, defensive parser, provider/action validation,
  provider registry, integration executor, availability cache, backoff, debug records,
  and metadata migration tests.
- Add common editor shell and the small generic parameter renderer.
- Keep unknown provider definitions round-trippable.

### Phase 3: A&E extraction

- Move current emanation code into the first real provider adapter.
- Surface honest `unknown` availability and destructive cleanup warning.
- Prototype duplicate/config-change behavior and document supported semantics.

### Phase 4: event and audience proof

- Prefer Dice+ as the readiness/event/idempotency proof if its documented API remains
  current.
- Implement authority selection and provider-recipient audience delivery with tests.
- Add exactly-once transition tests under rapid scene updates.

### Phase 5: Soundboard+ and Rumble!

- Implement only after their current public APIs are verified.
- Add specialized resource pickers where needed.
- Validate local vs shared delivery and private recipient behavior in multiplayer.

### Phase 6: remaining providers and hardening

- Add Embers, then Behaviors/Causality only against stable public contracts.
- Add telemetry-free local diagnostics, bounded retry/backoff, import/migration UX, and
  hosted GM/player/no-scene regression testing.

The acceptance criterion for every new provider is: its adapter, validator, action
metadata/editor, and tests can be added without modifying proximity evaluation,
lifecycle derivation, target resolution, audience resolution, or the central engine.
It is explicitly not an acceptance criterion that users can author integrations without
a Sting code change and release.
