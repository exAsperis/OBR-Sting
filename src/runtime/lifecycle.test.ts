import { describe, expect, it } from "vitest";
import { deriveTransition } from "./lifecycle";
import type { RuleSnapshot } from "../types";

const inactive: RuleSnapshot = { active: false, strength: 0, distance: 40, detectedEmitterId: "a" };
const active = (id = "a"): RuleSnapshot => ({ active: true, strength: 0.5, distance: 10, detectedEmitterId: id });

describe("deriveTransition", () => {
  it("derives enter, continuous, nearest change, and exit", () => {
    expect(deriveTransition(null, active()).type).toBe("enter");
    expect(deriveTransition(active(), active()).type).toBe("continuous");
    expect(deriveTransition(active("a"), active("b"))).toEqual({ type: "nearest-change", fromEmitterId: "a", toEmitterId: "b" });
    expect(deriveTransition(active(), inactive).type).toBe("exit");
    expect(deriveTransition(inactive, inactive).type).toBe("inactive");
  });
});
