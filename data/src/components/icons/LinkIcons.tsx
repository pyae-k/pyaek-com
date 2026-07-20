// Link / broken-link icons used by the header connect button and the
// Connections modal to signal folder-connection link health. Inline SVG so they
// inherit the surrounding color and scale with font-size via `1em` sizing.

interface IconProps {
  size?: number;
  className?: string;
}

/** Intact chain link — a folder connection is linked. */
export function LinkIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

/** Broken chain link — a folder connection lost its handle (e.g. after a cache clear). */
export function BrokenLinkIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 12a5 5 0 0 1 5-5" />
      <path d="M15 12a5 5 0 0 1-5 5" />
      <path d="M14.5 4.5l1-1a5 5 0 0 1 7.07 7.07l-1.72 1.71" />
      <path d="M9.5 19.5l-1 1a5 5 0 0 1-7.07-7.07l1.71-1.71" />
      <path d="M4 4l16 16" />
    </svg>
  );
}