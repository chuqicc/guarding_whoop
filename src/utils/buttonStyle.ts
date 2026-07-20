export type ButtonVariant = 'default' | 'accent' | 'warn' | 'mode'

// Shared toggle/action button look — used across TopBar, VideoPanel,
// CourtCanvas, and PlaybackControls so active/inactive states stay consistent.
export function toggleBtnStyle(active: boolean, variant: ButtonVariant = 'default'): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: 4, padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
  }

  switch (variant) {
    case 'accent':
    case 'warn':
      return {
        ...base,
        background: active ? 'var(--accent-warn)' : 'var(--bg-panel)',
        color: active ? '#fff' : 'var(--text-3)',
        border: `1px solid ${active ? 'var(--accent-warn)' : 'var(--border)'}`,
      }
    case 'mode':
      return {
        ...base,
        background: active ? 'var(--mode-on-bg)' : 'var(--mode-off-bg)',
        color: 'var(--text-1)',
        border: 'none',
        height: 28, padding: '0 10px',
        fontSize: 12,
      }
    default:
      return {
        ...base,
        background: active ? 'var(--bg-surface)' : 'var(--bg-panel)',
        color: active ? '#88aadd' : 'var(--text-3)',
        border: `1px solid ${active ? '#2a3d5a' : 'var(--border)'}`,
      }
  }
}
