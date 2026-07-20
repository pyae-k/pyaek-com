// Sparkle / AI icon for the header AI button. Inline SVG so it inherits the
// surrounding color and scales with font-size via `1em` sizing.

interface IconProps {
  size?: number;
  className?: string;
}

export function AiIcon({ size = 16, className }: IconProps) {
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
      <path d="M12 3L14.5 8.5L20 11L14.5 13.5L12 19L9.5 13.5L4 11L9.5 8.5L12 3Z" />
      <path d="M19 19L20 20" />
      <path d="M19 5L20 4" />
      <path d="M5 19L4 20" />
      <path d="M5 5L4 4" />
    </svg>
  );
}
