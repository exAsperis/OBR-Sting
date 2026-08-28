import type { Theme } from "@owlbear-rodeo/sdk";

export function applyOwlbearTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme.mode.toLowerCase();
  root.style.setProperty("--obr-primary", theme.primary.main);
  root.style.setProperty("--obr-primary-contrast", theme.primary.contrastText);
  root.style.setProperty("--obr-bg", theme.background.default);
  root.style.setProperty("--obr-paper", theme.background.paper);
  root.style.setProperty("--obr-text", theme.text.primary);
  root.style.setProperty("--obr-muted", theme.text.secondary);
  root.style.setProperty("--obr-disabled", theme.text.disabled);
}
