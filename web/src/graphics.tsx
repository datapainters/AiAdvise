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
    { y: 10, w: 52, label: 'ERP' },
    { y: 46, w: 96, label: 'CRM exports' },
    { y: 82, w: 108, label: 'Finance ledger' },
    { y: 118, w: 94, label: 'Spreadsheets' },
    { y: 154, w: 112, label: 'Support tickets' },
    { y: 190, w: 76, label: 'Data lake' },
  ];
  const MID = 112;

  return (
    <svg
      viewBox="0 0 460 250"
      className="figure figure-sources"
      role="img"
      aria-label="Six mismatched source systems, from an ERP to a data lake, converging through a governed layer into a single trusted output"
    >
      {sources.map((s, i) => (
        <g key={s.label}>
          <path
            className="fig-flow"
            style={{ ['--i' as string]: i }}
            pathLength={1}
            d={`M ${s.w} ${s.y + 12} C 172 ${s.y + 12}, 168 ${MID}, 214 ${MID}`}
            fill="none"
            stroke="var(--rule-strong)"
            strokeWidth={1.5}
          />
          <rect
            x={0.75}
            y={s.y}
            width={s.w}
            height={24}
            rx={3}
            fill="var(--surface)"
            stroke="var(--rule-strong)"
            strokeWidth={1.5}
          />
          <text x={s.w / 2 + 0.75} y={s.y + 16} textAnchor="middle" className="fig-source">
            {s.label}
          </text>
        </g>
      ))}

      {/* The governed layer: the part nobody budgets for. */}
      <g className="fig-layer">
        <rect
          x={214}
          y={22}
          width={40}
          height={180}
          rx={5}
          fill="var(--accent-soft)"
          stroke={ACCENT}
          strokeWidth={2}
        />
        {[58, 94, 130, 166].map((y) => (
          <line key={y} x1={224} y1={y} x2={244} y2={y} stroke={ACCENT} strokeWidth={2} />
        ))}
      </g>

      <g className="fig-output">
        <path d={`M 254 ${MID} L 318 ${MID}`} fill="none" stroke={INK} strokeWidth={1.5} />
        <path d={`M 312 ${MID - 5} L 320 ${MID} L 312 ${MID + 5} Z`} fill={INK} />

        {/* One output, consistent, with an owner. */}
        <rect
          x={328}
          y={54}
          width={130}
          height={116}
          rx={4}
          fill="var(--surface)"
          stroke={INK}
          strokeWidth={2}
        />
        {[80, 102, 124].map((y) => (
          <line key={y} x1={344} y1={y} x2={442} y2={y} stroke={RULE} strokeWidth={6} />
        ))}
        <line x1={344} y1={148} x2={400} y2={148} stroke={ACCENT} strokeWidth={6} />
      </g>

      <g className="fig-captions">
        <text x={0.75} y={242}>
          Your sources
        </text>
        <text x={234} y={242} textAnchor="middle">
          Governed layer
        </text>
        <text x={393} y={242} textAnchor="middle">
          One trusted output
        </text>
      </g>
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


/**
 * How one session runs, as a loop: you set the agenda, we meet, notes are
 * kept against each topic, a summary and the time recorded follow, and the
 * open topics carry into the next agenda.
 */
export function SessionLoop() {
  const steps = [
    { x: 6, label: 'Agenda', sub: 'you set it' },
    { x: 116, label: 'Session', sub: 'video or message' },
    { x: 226, label: 'Notes', sub: 'per topic' },
    { x: 336, label: 'Summary', sub: 'with time used' },
  ];

  return (
    <svg
      viewBox="0 0 440 200"
      className="figure"
      role="img"
      aria-label="Four steps in a loop: agenda, session, notes, summary, then back to the next agenda"
    >
      {steps.map((s, i) => (
        <g key={s.label}>
          <rect
            x={s.x}
            y={58}
            width={98}
            height={60}
            rx={3}
            fill="none"
            stroke={i === 0 ? ACCENT : RULE}
            strokeWidth={i === 0 ? 2 : 1.5}
          />
          <text x={s.x + 49} y={84} textAnchor="middle" fontSize={13} fontWeight={600} fill={INK}>
            {s.label}
          </text>
          <text x={s.x + 49} y={102} textAnchor="middle" fontSize={10} fill={SOFT}>
            {s.sub}
          </text>
          {i < steps.length - 1 && (
            <path d={`M ${s.x + 100} 88 L ${s.x + 108} 88`} fill="none" stroke={SOFT} strokeWidth={1.5} />
          )}
        </g>
      ))}

      {/* What is still open goes back onto the next agenda. */}
      <path
        d="M 385 120 L 385 158 L 55 158 L 55 124"
        fill="none"
        stroke={SOFT}
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />
      <path d="M 50 130 L 55 121 L 60 130 Z" fill={SOFT} />
      <text x={220} y={178} textAnchor="middle" fontSize={10} fill={SOFT}>
        open topics carry into the next session
      </text>
    </svg>
  );
}
