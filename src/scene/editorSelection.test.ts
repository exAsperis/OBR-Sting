import { describe, expect, it } from "vitest";
import { resolveEditorSelection } from "./editorSelection";

describe("editor selection", () => {
  const items = ["a", "b"];

  it("switches to a newly selected scene item", () => {
    expect(resolveEditorSelection("a", ["b"], items)).toBe("b");
  });

  it("keeps editing the current item when Owlbear clears or expands the selection", () => {
    expect(resolveEditorSelection("a", [], items)).toBe("a");
    expect(resolveEditorSelection("a", undefined, items)).toBe("a");
    expect(resolveEditorSelection("a", ["a", "b"], items)).toBe("a");
  });

  it("returns to Settings when the edited item no longer exists", () => {
    expect(resolveEditorSelection("a", [], ["b"])).toBeNull();
  });

  it("ignores a stale scene selection and retains an available editor item", () => {
    expect(resolveEditorSelection("a", ["deleted"], items)).toBe("a");
  });
});
