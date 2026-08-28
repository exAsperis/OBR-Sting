interface StatusPanelProps {
  title: string;
  message: string;
  onRetry?: () => void;
}

export function StatusPanel({ title, message, onRetry }: StatusPanelProps) {
  return (
    <main className="center-panel" role="status">
      <div className="status-icon" aria-hidden="true">◇</div>
      <h1>{title}</h1>
      <p>{message}</p>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </main>
  );
}
