export const DEFAULT_ACTION_HEIGHT = 700;
export const MIN_ACTION_HEIGHT = 320;
export const ACTION_VERTICAL_MARGIN = 112;

export function clampActionHeight(preferredHeight: number, viewportHeight: number) {
  const availableHeight = Math.max(1, Math.floor(viewportHeight - ACTION_VERTICAL_MARGIN));
  const minimumHeight = Math.min(MIN_ACTION_HEIGHT, availableHeight);
  return Math.min(availableHeight, Math.max(minimumHeight, Math.round(preferredHeight)));
}
