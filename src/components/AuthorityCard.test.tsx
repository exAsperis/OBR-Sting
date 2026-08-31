import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthorityCard } from "../App";

const standby = {
  state: "standby" as const,
  localConnectionId: "gm-b",
  leaderConnectionId: "gm-a",
  healthyRuntimeCount: 2,
  selection: "automatic" as const,
  manualClaimedByLocal: false,
};

describe("AuthorityCard", () => {
  it("offers takeover on standby and reports errors", () => {
    const take = vi.fn();
    render(<AuthorityCard authority={standby} pending={false} error="Unable to take control." onTakeControl={take} onReleaseControl={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Take control" }));
    expect(take).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert").textContent).toBe("Unable to take control.");
  });

  it("offers return to automatic only for a local manual claim", () => {
    const release = vi.fn();
    render(<AuthorityCard authority={{ ...standby, state: "active", leaderConnectionId: "gm-b", selection: "manual", manualClaimedByLocal: true }} pending={false} error={null} onTakeControl={() => undefined} onReleaseControl={release} />);
    fireEvent.click(screen.getByRole("button", { name: "Return to automatic" }));
    expect(release).toHaveBeenCalledOnce();
  });
});
