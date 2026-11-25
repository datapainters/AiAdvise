/**
 * Original vector graphics for the marketing pages.
 *
 * Drawn rather than photographed, for three reasons: stock photography of
 * people at whiteboards says nothing a reader believes, these are schematics
 * of the actual argument the copy is making, and vector art stays sharp at
 * any size while costing a few kilobytes inside the JS bundle rather than a
 * network round trip per image.
 *
 * Everything is stroked in `currentColor` or a CSS variable, so the whole set
 * inverts correctly in dark mode without a second asset.
 */

const RULE = 'var(--rule)';
const INK = 'var(--ink)';
const SOFT = 'var(--ink-soft)';
const ACCENT = 'var(--accent)';

/**
 * Hero: scattered, mismatched sources resolving through a governed layer
 * into one clean output. This is the whole pitch in one picture -- the model
 * is the small box on the right, and everything expensive is to its left.
 */
export function SourcesToOutput() {
  // Deliberately uneven: real source systems are not a tidy column.
  const sources = [
    { y: 24, w: 74 },
    { y: 56, w: 52 },
    { y: 88, w: 86 },
    { y: 120, w: 44 },
    { y: 152, w: 68 },
    { y: 184, w: 58 },
  ];

  return (
    <svg
      viewBox="0 0 440 240"
      className="figure"
      role="img"
      aria-label="Mismatched source systems converging through a governance layer into a single consistent output"
    >
      {sources.map((s) => (
        <g key={s.y}>
          <rect
            x={0}
            y={s.y}
            width={s.w}
            height={16}
            rx={2}
            fill="none"
            stroke={RULE}
            strokeWidth={1.5}
          />
          <path
            d={`M ${s.w} ${s.y + 8} C 150 ${s.y + 8}, 150 120, 196 120`}
            fill="none"
            stroke={RULE}
            strokeWidth={1.25}
          />
        </g>
      ))}

      {/* The governed layer: the part nobody budgets for. */}
      <rect
        x={196}
        y={40}
        width={34}
        height={160}
        rx={4}
        fill="none"
        stroke={ACCENT}
        strokeWidth={2}
      />
      {[72, 104, 136, 168].map((y) => (
        <line key={y} x1={204} y1={y} x2={222} y2={y} stroke={ACCENT} strokeWidth={1.5} />
      ))}

      <path d="M 230 120 L 300 120" fill="none" stroke={SOFT} strokeWidth={1.5} />
      <path d="M 294 115 L 301 120 L 294 125 Z" fill={SOFT} />

      {/* One output, consistent, with an owner. */}
      <rect
        x={310}
        y={64}
        width={128}
        height={112}
        rx={3}
        fill="none"
        stroke={INK}
        strokeWidth={2}
      />
      {[88, 110, 132].map((y) => (
        <line key={y} x1={326} y1={y} x2={422} y2={y} stroke={RULE} strokeWidth={6} />
      ))}
      <line x1={326} y1={154} x2={382} y2={154} stroke={ACCENT} strokeWidth={6} />
    </svg>
  );
}

/**
 * The pilot/production gap. A pilot is one box that worked once; production
 * is the same box replicated, observed, and on someone's rota.
 */
export function PilotToProduction() {
  const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  return (
    <svg
      viewBox="0 0 440 220"
      className="figure"
      role="img"
      aria-label="A single pilot workload on the left, the same workload replicated and monitored in production on the right"
    >
      <rect
        x={8}
        y={78}
        width={92}
        height={64}
        rx={3}
        fill="none"
        stroke={SOFT}
        strokeWidth={2}
      />
      <circle cx={54} cy={110} r={11} fill="none" stroke={SOFT} strokeWidth={2} />
      <path d="M 49 110 L 53 114 L 60 106" fill="none" stroke={SOFT} strokeWidth={2} />

      <path d="M 118 110 L 186 110" fill="none" stroke={RULE} strokeWidth={1.5} />
      <path d="M 180 105 L 187 110 L 180 115 Z" fill={RULE} />

      {/* Nine of them, which is where the interesting problems start. */}
      {cells.map((i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        return (
          <rect
            key={i}
            x={204 + col * 54}
            y={48 + row * 48}
            width={44}
            height={38}
            rx={2}
            fill="none"
            stroke={i === 4 ? ACCENT : RULE}
            strokeWidth={i === 4 ? 2 : 1.5}
          />
        );
      })}

      {/* The things that only appear at scale. */}
      <line x1={204} y1={30} x2={356} y2={30} stroke={INK} strokeWidth={1.5} />
      <line x1={204} y1={26} x2={204} y2={34} stroke={INK} strokeWidth={1.5} />
      <line x1={356} y1={26} x2={356} y2={34} stroke={INK} strokeWidth={1.5} />

      <line x1={376} y1={48} x2={376} y2={182} stroke={RULE} strokeWidth={1.5} />
      {[58, 96, 134, 172].map((y) => (
        <line key={y} x1={372} y1={y} x2={380} y2={y} stroke={RULE} strokeWidth={1.5} />
      ))}
    </svg>
  );
}

/**
 * Twenty-five years as a single line: the BI era's hard problems, then the
 * same problems under a new name. The line does not restart at the join,
 * which is the point being made.
 */
export function Timeline() {
  const marks = [
    { x: 40, label: 'Warehouses' },
    { x: 150, label: 'Semantic layers' },
    { x: 268, label: 'Governance' },
    { x: 386, label: 'AI' },
  ];

  return (
    <svg
      viewBox="0 0 440 120"
      className="figure"
      role="img"
      aria-label="A continuous timeline running from data warehouses through semantic layers and governance to AI"
    >
      <line x1={16} y1={46} x2={424} y2={46} stroke={RULE} strokeWidth={1.5} />
      {/* The last leg is accented, but it is the same line. */}
      <line x1={330} y1={46} x2={424} y2={46} stroke={ACCENT} strokeWidth={2} />

      {marks.map((m, i) => (
        <g key={m.label}>
          <circle
            cx={m.x}
            cy={46}
            r={i === marks.length - 1 ? 6 : 4}
            fill={i === marks.length - 1 ? ACCENT : 'var(--bg)'}
            stroke={i === marks.length - 1 ? ACCENT : SOFT}
            strokeWidth={1.5}
          />
          <text
            x={m.x}
            y={76}
            textAnchor="middle"
            fontSize={12}
            fill={SOFT}
            fontFamily="var(--font)"
          >
            {m.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Small glyphs for the service cards. One stroke weight, one idea each. */
export function ServiceIcon({ name }: { name: 'assess' | 'data' | 'scale' | 'oversee' }) {
  const common = {
    viewBox: '0 0 32 32',
    className: 'service-icon',
    'aria-hidden': true as const,
    fill: 'none',
    stroke: ACCENT,
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (name === 'assess') {
    // A ranked list: the deliverable, not a magnifying glass.
    return (
      <svg {...common}>
        <line x1={6} y1={9} x2={26} y2={9} />
        <line x1={6} y1={16} x2={21} y2={16} />
        <line x1={6} y1={23} x2={14} y2={23} />
      </svg>
    );
  }

  if (name === 'data') {
    // Stacked stores.
    return (
      <svg {...common}>
        <ellipse cx={16} cy={8} rx={10} ry={4} />
        <path d="M 6 8 v 8 c 0 2.2 4.5 4 10 4 s 10 -1.8 10 -4 v -8" />
        <path d="M 6 16 v 8 c 0 2.2 4.5 4 10 4 s 10 -1.8 10 -4 v -8" />
      </svg>
    );
  }

  if (name === 'scale') {
    // One unit becoming many.
    return (
      <svg {...common}>
        <rect x={5} y={5} width={9} height={9} rx={1} />
        <rect x={18} y={5} width={9} height={9} rx={1} />
        <rect x={5} y={18} width={9} height={9} rx={1} />
        <rect x={18} y={18} width={9} height={9} rx={1} />
      </svg>
    );
  }

  // Oversight: a handover, not an eye.
  return (
    <svg {...common}>
      <path d="M 5 22 l 7 -7 l 5 5 l 10 -10" />
      <path d="M 21 10 h 6 v 6" />
    </svg>
  );
}
