/** The wordmark's glyph: an ink-drawn box with a reviewer's red stroke through it. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mark">
      <rect x="4.5" y="4.5" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M9 17.5 L14.5 23 L29 6"
        fill="none"
        stroke="var(--red)"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
