/**
 * Hero figure: a client's existing systems drawn in ink, with the advisory
 * work marked up in red the way a reviewer marks up a drawing. The three red
 * notes are the three hard parts named in the lede next to it.
 *
 * The red strokes draw themselves once on load (see `.redline` in styles.css);
 * `pathLength={1}` lets one dash rule animate paths of any length.
 */
const INK_BOXES = [
  { x: 10, y: 28, label: 'Customer records' },
  { x: 205, y: 28, label: 'Order system' },
  { x: 400, y: 28, label: 'Finance ledger' },
  { x: 10, y: 306, label: 'Support desk' },
  { x: 400, y: 306, label: 'Warehouse' },
];

export function SystemDrawing() {
  return (
    <figure className="drawing">
      <svg viewBox="0 0 560 386" role="img" aria-labelledby="drawing-title drawing-desc">
        <title id="drawing-title">Where a model connects to existing systems</title>
        <desc id="drawing-desc">
          Five existing systems drawn in ink: customer records, order system, finance
          ledger, support desk and warehouse. Marked in red, a model reads from the
          order system, writes to the warehouse, and a person signs off at the
          support desk.
        </desc>

        <g className="ink-lines">
          <path d="M160 54 H205 M355 54 H400 M85 80 V306 M475 80 V306 M160 332 H400" />
        </g>
        {INK_BOXES.map((b) => (
          <g key={b.label}>
            <rect className="ink-box" x={b.x} y={b.y} width="150" height="52" />
            <text className="ink-label" x={b.x + 75} y={b.y + 31} textAnchor="middle">
              {b.label}
            </text>
          </g>
        ))}

        <g className="redline">
          {/* the new piece, boxed by hand */}
          <path pathLength={1} style={{ ['--i' as string]: 0 }} d="M213 168 C250 164 310 166 348 169 C350 185 349 200 347 217 C300 220 255 219 214 216 C211 200 212 184 213 166" />
          {/* reads */}
          <path pathLength={1} style={{ ['--i' as string]: 1 }} d="M281 84 C279 110 282 135 280 160 M273 150 L280 162 L288 151" />
          {/* writes */}
          <path pathLength={1} style={{ ['--i' as string]: 2 }} d="M350 196 C415 198 448 245 456 298 M446 288 L456 300 L463 286" />
          {/* sign-off */}
          <path pathLength={1} style={{ ['--i' as string]: 3 }} d="M211 196 C150 200 118 246 108 298 M100 286 L108 300 L118 289" />
        </g>
        <g className="redline-notes">
          <text x="280" y="199" textAnchor="middle" className="redline-node">the model</text>
          <text x="294" y="128">reads from here</text>
          <text x="360" y="182">writes to here</text>
          <text x="144" y="260">a person signs off here</text>
        </g>
      </svg>
      <figcaption>
        Your systems are the part in ink. The work is the part in red.
      </figcaption>
    </figure>
  );
}
