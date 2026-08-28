import { describe, expect, it } from "vitest";
import type { Theme } from "@owlbear-rodeo/sdk";
import { applyOwlbearTheme } from "./theme";

describe("applyOwlbearTheme", () => {
  it("maps Owlbear theme colors to CSS variables", () => {
    const theme = {
      mode: "DARK",
      primary: { main: "#123456", contrastText: "#ffffff" },
      background: { default: "#111111", paper: "#222222" },
      text: { primary: "#eeeeee", secondary: "#bbbbbb", disabled: "#777777" },
    } as Theme;
    applyOwlbearTheme(theme);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--obr-primary")).toBe("#123456");
    expect(document.documentElement.style.getPropertyValue("--obr-paper")).toBe("#222222");
  });
});
