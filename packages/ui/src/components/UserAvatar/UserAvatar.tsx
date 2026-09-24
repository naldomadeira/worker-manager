import { cn } from '@/lib/utils';

/** FNV-1a: stable across sessions and browsers, so a person keeps the same avatar everywhere. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A generated avatar: a two-hue gradient and a few soft shapes derived from the user's id, with
 * their initials on top. Different people get visibly different avatars without anyone having
 * to upload a picture, and the initials keep it readable at 28px.
 */
export const UserAvatar = ({
  seed,
  initials,
  className,
}: {
  seed: string;
  initials: string;
  className?: string;
}) => {
  const h = hash(seed || initials);
  const hueA = h % 360;
  const hueB = (hueA + 40 + ((h >>> 9) % 80)) % 360;
  const angle = (h >>> 3) % 360;
  const cx = 20 + ((h >>> 12) % 60);
  const cy = 15 + ((h >>> 18) % 60);
  const r = 22 + ((h >>> 24) % 18);
  const id = `ua-${h.toString(36)}`;

  return (
    <span
      className={cn(
        'relative inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/10 dark:ring-white/15',
        className
      )}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <linearGradient id={id} gradientTransform={`rotate(${angle} .5 .5)`}>
            <stop offset="0" stopColor={`oklch(0.62 0.17 ${hueA})`} />
            <stop offset="1" stopColor={`oklch(0.52 0.19 ${hueB})`} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${id})`} />
        <circle cx={cx} cy={cy} r={r} fill="white" fillOpacity={0.18} />
        <circle cx={100 - cy} cy={100 - cx / 2} r={r * 0.7} fill="black" fillOpacity={0.12} />
        <rect
          x="-10"
          y={55 + ((h >>> 6) % 25)}
          width="120"
          height="60"
          rx="30"
          fill="white"
          fillOpacity={0.1}
          transform={`rotate(${-20 + ((h >>> 15) % 40)} 50 50)`}
        />
      </svg>
      <span className="relative text-[0.65em] font-semibold tracking-tight text-white drop-shadow-sm">
        {initials}
      </span>
    </span>
  );
};
