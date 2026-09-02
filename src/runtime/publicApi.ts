import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { DETECTOR_KEY, EMITTER_KEY, PUBLIC_API_CHANNEL, PUBLIC_API_RESULT_SUFFIX, RULE_LIBRARY_STORAGE_KEY } from "../constants";
import { parseDetectorMetadata, parseEmitterMetadata } from "../metadata/parse";
import { instantiateLibraryRule, loadRuleLibrary, type RuleLibraryEntryV1 } from "../rules/library";
import { parseEmitterSignal } from "../signals/normalize";
import type { DetectionRuleV1, DetectorMetadataV1, EmitterMetadataV1 } from "../types";

export const STING_API_VERSION = 1 as const;

export type StingApiRequest =
  | { version: 1; requestId: string; source: string; type: "ADD_EMITTER_TAGS"; sources: string[]; tags: string[] }
  | { version: 1; requestId: string; source: string; type: "REMOVE_EMITTER_TAGS"; sources: string[]; tags: string[] }
  | { version: 1; requestId: string; source: string; type: "ADD_DETECTION_RULES"; sources: string[]; rules: string[] }
  | { version: 1; requestId: string; source: string; type: "REMOVE_DETECTION_RULES"; sources: string[]; rules: string[] };

export type StingApiErrorCode =
  | "INVALID_REQUEST" | "GM_REQUIRED" | "SCENE_NOT_READY" | "ITEM_NOT_FOUND"
  | "INVALID_EMITTER_TAG" | "EMITTER_TAG_EXISTS" | "EMITTER_TAG_NOT_FOUND"
  | "RULE_LIBRARY_ENTRY_NOT_FOUND" | "DETECTION_RULE_EXISTS" | "DETECTION_RULE_NOT_FOUND"
  | "INVALID_EMITTER_METADATA" | "INVALID_DETECTOR_METADATA" | "UPDATE_FAILED";

export interface StingApiSuccess { itemId: string; name: string }
export interface StingApiFailure { code: StingApiErrorCode; itemId?: string; name?: string; message: string }
export interface StingApiResult {
  version: 1;
  type: "STING_API_RESULT";
  requestId: string;
  requestType?: StingApiRequest["type"];
  status: "success" | "partial" | "failure";
  successes: StingApiSuccess[];
  failures: StingApiFailure[];
}

const requestTypes = ["ADD_EMITTER_TAGS", "REMOVE_EMITTER_TAGS", "ADD_DETECTION_RULES", "REMOVE_DETECTION_RULES"] as const;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const uniqueTrimmed = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

export function parseStingApiRequest(value: unknown): StingApiRequest | null {
  if (!record(value) || value.version !== 1 || typeof value.requestId !== "string" || !value.requestId.trim() || typeof value.source !== "string" || !value.source.trim()) return null;
  if (!requestTypes.includes(value.type as typeof requestTypes[number]) || !strings(value.sources)) return null;
  const type = value.type as StingApiRequest["type"];
  const valueKey = type.includes("EMITTER") ? "tags" : "rules";
  const allowed = new Set(["version", "requestId", "source", "type", "sources", valueKey]);
  if (Object.keys(value).some((key) => !allowed.has(key)) || !strings(value[valueKey])) return null;
  const sources = uniqueTrimmed(value.sources);
  const names = uniqueTrimmed(value[valueKey] as string[]);
  if (!sources.length || !names.length) return null;
  const base = { version: 1 as const, requestId: value.requestId.trim(), source: value.source.trim(), type, sources };
  return (valueKey === "tags" ? { ...base, tags: names } : { ...base, rules: names }) as StingApiRequest;
}

function result(requestId: string, requestType: StingApiRequest["type"] | undefined, successes: StingApiSuccess[], failures: StingApiFailure[]): StingApiResult {
  return { version: 1, type: "STING_API_RESULT", requestId, ...(requestType ? { requestType } : {}), status: successes.length ? failures.length ? "partial" : "success" : "failure", successes, failures };
}

function failure(code: StingApiErrorCode, message: string, itemId?: string, name?: string): StingApiFailure {
  return { code, ...(itemId ? { itemId } : {}), ...(name ? { name } : {}), message };
}

function emitterFor(item: Item): EmitterMetadataV1 | null | undefined {
  const raw = item.metadata[EMITTER_KEY];
  return raw === undefined ? undefined : parseEmitterMetadata(raw);
}

function detectorFor(item: Item): DetectorMetadataV1 | null | undefined {
  const raw = item.metadata[DETECTOR_KEY];
  return raw === undefined ? undefined : parseDetectorMetadata(raw);
}

function applyEmitter(item: Item, request: Extract<StingApiRequest, { tags: string[] }>, successes: StingApiSuccess[], failures: StingApiFailure[]): boolean {
  const existing = emitterFor(item);
  if (existing === null) { failures.push(failure("INVALID_EMITTER_METADATA", "Existing Sting emitter metadata is invalid.", item.id)); return false; }
  const parsed = request.tags.map((name) => ({ name, tag: parseEmitterSignal(name)?.tag }));
  for (const entry of parsed) if (!entry.tag) failures.push(failure("INVALID_EMITTER_TAG", "Emitter tag is invalid.", item.id, entry.name));
  const seenTags = new Set<string>();
  const valid = parsed.filter((entry): entry is { name: string; tag: string } => {
    if (!entry.tag || seenTags.has(entry.tag)) return false;
    seenTags.add(entry.tag);
    return true;
  });
  const current = existing?.signals ?? [];
  if (request.type === "ADD_EMITTER_TAGS") {
    const additions: string[] = [];
    for (const { name, tag } of valid) current.includes(tag)
      ? failures.push(failure("EMITTER_TAG_EXISTS", "Emitter tag already exists on this item.", item.id, name))
      : (additions.push(tag), successes.push({ itemId: item.id, name }));
    if (!additions.length) return false;
    item.metadata[EMITTER_KEY] = { version: 1, enabled: existing?.enabled ?? true, signals: [...current, ...additions] } satisfies EmitterMetadataV1;
    return true;
  }
  const removals = new Set(valid.map((entry) => entry.tag));
  for (const { name, tag } of valid) current.includes(tag)
    ? successes.push({ itemId: item.id, name })
    : failures.push(failure("EMITTER_TAG_NOT_FOUND", "Emitter tag is not present on this item.", item.id, name));
  const next = current.filter((tag) => !removals.has(tag));
  if (next.length === current.length) return false;
  if (next.length) item.metadata[EMITTER_KEY] = { version: 1, enabled: existing?.enabled ?? true, signals: next } satisfies EmitterMetadataV1;
  else delete item.metadata[EMITTER_KEY];
  return true;
}

function applyRules(item: Item, request: Extract<StingApiRequest, { rules: string[] }>, library: RuleLibraryEntryV1[], successes: StingApiSuccess[], failures: StingApiFailure[]): boolean {
  const existing = detectorFor(item);
  if (existing === null) { failures.push(failure("INVALID_DETECTOR_METADATA", "Existing Sting detector metadata is invalid.", item.id)); return false; }
  const current = existing?.rules ?? [];
  if (request.type === "ADD_DETECTION_RULES") {
    const additions: DetectionRuleV1[] = [];
    for (const name of request.rules) {
      const matches = library.filter((entry) => entry.name === name);
      if (!matches.length) { failures.push(failure("RULE_LIBRARY_ENTRY_NOT_FOUND", "No saved rule has this exact name in this browser.", item.id, name)); continue; }
      if (current.some((rule) => rule.name === name)) { failures.push(failure("DETECTION_RULE_EXISTS", "A detection rule with this name already exists on this item.", item.id, name)); continue; }
      additions.push(...matches.map((entry) => ({ ...instantiateLibraryRule(entry), name: entry.name })));
      successes.push({ itemId: item.id, name });
    }
    if (!additions.length) return false;
    item.metadata[DETECTOR_KEY] = { version: 1, enabled: existing?.enabled ?? true, rules: [...current, ...additions] } satisfies DetectorMetadataV1;
    return true;
  }
  const names = new Set(request.rules);
  for (const name of request.rules) current.some((rule) => rule.name === name)
    ? successes.push({ itemId: item.id, name })
    : failures.push(failure("DETECTION_RULE_NOT_FOUND", "No configured detection rule has this exact name.", item.id, name));
  const next = current.filter((rule) => !rule.name || !names.has(rule.name));
  if (next.length === current.length) return false;
  if (next.length) item.metadata[DETECTOR_KEY] = { version: 1, enabled: existing?.enabled ?? true, rules: next } satisfies DetectorMetadataV1;
  else delete item.metadata[DETECTOR_KEY];
  return true;
}

export interface StingApiDependencies {
  getRole(): Promise<"GM" | "PLAYER">;
  isSceneReady(): Promise<boolean>;
  getItems(ids: string[]): Promise<Item[]>;
  updateItems(ids: string[], update: (items: Item[]) => void): Promise<void>;
  sendMessage(channel: string, data: StingApiResult): Promise<void>;
  storage: Pick<Storage, "getItem">;
}

export class StingPublicApi {
  constructor(private readonly dependencies: StingApiDependencies) {}

  async handle(value: unknown): Promise<StingApiResult | null> {
    const envelope = record(value) && typeof value.source === "string" && value.source.trim() && typeof value.requestId === "string" && value.requestId.trim()
      ? { source: value.source.trim(), requestId: value.requestId.trim() } : null;
    const request = parseStingApiRequest(value);
    if (!request) {
      if (!envelope) return null;
      const response = result(envelope.requestId, undefined, [], [failure("INVALID_REQUEST", "The Sting API request is malformed or contains unsupported fields.")]);
      await this.dependencies.sendMessage(`${envelope.source}${PUBLIC_API_RESULT_SUFFIX}`, response);
      return response;
    }
    const respond = async (response: StingApiResult) => { await this.dependencies.sendMessage(`${request.source}${PUBLIC_API_RESULT_SUFFIX}`, response); return response; };
    if (await this.dependencies.getRole() !== "GM") return respond(result(request.requestId, request.type, [], [failure("GM_REQUIRED", "Only a GM client may use the Sting API.")]));
    if (!await this.dependencies.isSceneReady()) return respond(result(request.requestId, request.type, [], [failure("SCENE_NOT_READY", "No Owlbear Rodeo scene is ready.")]));
    const successes: StingApiSuccess[] = [];
    const failures: StingApiFailure[] = [];
    try {
      const items = await this.dependencies.getItems(request.sources);
      const found = new Set(items.map((item) => item.id));
      for (const id of request.sources) if (!found.has(id)) failures.push(failure("ITEM_NOT_FOUND", "Scene item was not found.", id));
      const changed: string[] = [];
      const library = request.type === "ADD_DETECTION_RULES" ? loadRuleLibrary(this.dependencies.storage, RULE_LIBRARY_STORAGE_KEY).entries : [];
      const metadataKey = "tags" in request ? EMITTER_KEY : DETECTOR_KEY;
      for (const item of items) {
        const didChange = "tags" in request ? applyEmitter(item, request, successes, failures) : applyRules(item, request, library, successes, failures);
        if (didChange) changed.push(item.id);
      }
      if (changed.length) {
        const values = new Map(items.map((item) => [item.id, item.metadata[metadataKey]]));
        await this.dependencies.updateItems(changed, (drafts) => {
          for (const draft of drafts) {
            const value = values.get(draft.id);
            if (value === undefined) delete draft.metadata[metadataKey];
            else draft.metadata[metadataKey] = structuredClone(value);
          }
        });
      }
      return respond(result(request.requestId, request.type, successes, failures));
    } catch {
      return respond(result(request.requestId, request.type, [], [...failures, failure("UPDATE_FAILED", "Sting could not update the requested scene items.")]));
    }
  }
}

export function registerStingPublicApi(storage: Pick<Storage, "getItem"> = localStorage): () => void {
  const api = new StingPublicApi({
    getRole: () => OBR.player.getRole(),
    isSceneReady: () => OBR.scene.isReady(),
    getItems: (ids) => OBR.scene.items.getItems(ids),
    updateItems: (ids, update) => OBR.scene.items.updateItems<Item>(ids, update),
    sendMessage: (channel, data) => OBR.broadcast.sendMessage(channel, data, { destination: "LOCAL" }),
    storage,
  });
  return OBR.broadcast.onMessage(PUBLIC_API_CHANNEL, (event) => { void api.handle(event.data); });
}
