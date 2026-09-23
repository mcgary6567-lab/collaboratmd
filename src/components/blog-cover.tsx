/**
 * Cover artwork for the blog.
 *
 * Each article gets a generated illustration rather than a stock photograph:
 * the motif is drawn from the subject of the piece, it stays sharp at any
 * size, it costs the repository no binary asset, and it carries no licensing
 * question. All five share one palette so the index reads as a set.
 */

export type CoverVariant = "aging" | "denials" | "clean" | "remittance" | "eligibility";

const AGING = [34, 52, 68, 81, 92, 74, 58, 44, 36, 28, 21, 16];
const TREND = [42, 48, 45, 56, 62, 58, 71, 76, 72, 84, 88, 95];

function Frame({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 400 225"
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ecfdf5" />
          <stop offset="55%" stopColor="#d1fae5" />
          <stop offset="100%" stopColor="#a7f3d0" />
        </linearGradient>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#16a34a" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#16a34a" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <rect width="400" height="225" fill={`url(#${id}-bg)`} />
      {[45, 90, 135, 180].map((y) => (
        <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="#059669" strokeOpacity="0.09" strokeWidth="1" />
      ))}
      {children}
    </svg>
  );
}

/** Descending bars: a receivable being worked down. */
function Aging({ id }: { id: string }) {
  return (
    <Frame id={id}>
      {AGING.map((v, i) => (
        <rect
          key={i}
          x={26 + i * 30}
          y={195 - v * 1.45}
          width={17}
          height={v * 1.45}
          rx={4}
          fill="#16a34a"
          fillOpacity={0.3 + (1 - i / AGING.length) * 0.55}
        />
      ))}
      <line x1="20" y1="195" x2="380" y2="195" stroke="#047857" strokeOpacity="0.35" strokeWidth="1.5" />
      <line x1="20" y1="108" x2="380" y2="108" stroke="#047857" strokeWidth="1.5" strokeDasharray="6 5" strokeOpacity="0.55" />
    </Frame>
  );
}

/** A ring with one recovered segment lifted out of it. */
function Denials({ id }: { id: string }) {
  const c = 2 * Math.PI * 58;
  const seg = [0.41, 0.24, 0.16, 0.11, 0.08];
  let off = 0;
  return (
    <Frame id={id}>
      <g transform="translate(200,112) rotate(-90)">
        {seg.map((s, i) => {
          const dash = s * c;
          const el = (
            <circle
              key={i}
              r="58"
              fill="none"
              stroke="#16a34a"
              strokeOpacity={0.85 - i * 0.14}
              strokeWidth={i === 0 ? 26 : 20}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-off}
            />
          );
          off += dash;
          return el;
        })}
      </g>
      <circle cx="200" cy="112" r="36" fill="#ffffff" fillOpacity="0.92" />
      <path
        d="M186 112 l10 10 l19 -21"
        fill="none"
        stroke="#16a34a"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Frame>
  );
}

/** A rising line with a scrub gate part way along it. */
function Clean({ id }: { id: string }) {
  const step = 360 / (TREND.length - 1);
  const pts = TREND.map((v, i) => [20 + i * step, 200 - v * 1.6] as const);
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return (
    <Frame id={id}>
      <path d={`${d} L 380,205 L 20,205 Z`} fill={`url(#${id}-fill)`} />
      <path d={d} fill="none" stroke="#15803d" strokeWidth="3.5" strokeLinecap="round" />
      {pts.filter((_, i) => i % 3 === 0).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5.5" fill="#ffffff" stroke="#15803d" strokeWidth="3" />
      ))}
    </Frame>
  );
}

/** Document rows with amounts reconciling on the right. */
function Remittance({ id }: { id: string }) {
  const rows = [0, 1, 2, 3, 4];
  return (
    <Frame id={id}>
      <rect x="44" y="34" width="312" height="158" rx="14" fill="#ffffff" fillOpacity="0.9" />
      <rect x="44" y="34" width="312" height="30" rx="14" fill="#16a34a" fillOpacity="0.16" />
      <rect x="62" y="44" width="92" height="9" rx="4.5" fill="#15803d" fillOpacity="0.55" />
      {rows.map((r) => (
        <g key={r}>
          <rect x="62" y={82 + r * 22} width={120 - r * 12} height="8" rx="4" fill="#0f172a" fillOpacity="0.16" />
          <rect x="198" y={82 + r * 22} width="52" height="8" rx="4" fill="#0f172a" fillOpacity="0.1" />
          <rect x="272" y={80 + r * 22} width={66 - r * 6} height="12" rx="6" fill="#16a34a" fillOpacity={0.7 - r * 0.09} />
        </g>
      ))}
    </Frame>
  );
}

/** A coverage card behind a shield: the check that happens before the visit. */
function Eligibility({ id }: { id: string }) {
  return (
    <Frame id={id}>
      <rect x="66" y="58" width="208" height="126" rx="16" fill="#ffffff" fillOpacity="0.9" />
      <rect x="86" y="80" width="86" height="10" rx="5" fill="#0f172a" fillOpacity="0.18" />
      <rect x="86" y="102" width="132" height="8" rx="4" fill="#0f172a" fillOpacity="0.11" />
      <rect x="86" y="120" width="104" height="8" rx="4" fill="#0f172a" fillOpacity="0.11" />
      <rect x="86" y="146" width="72" height="16" rx="8" fill="#16a34a" fillOpacity="0.65" />
      <path
        d="M292 52 l46 17 v41 c0 30 -20 54 -46 64 c-26 -10 -46 -34 -46 -64 v-41 Z"
        fill="#16a34a"
        fillOpacity="0.9"
      />
      <path
        d="M276 121 l11 12 l22 -26"
        fill="none"
        stroke="#ffffff"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Frame>
  );
}

const VARIANTS: Record<CoverVariant, (p: { id: string }) => React.ReactElement> = {
  aging: Aging,
  denials: Denials,
  clean: Clean,
  remittance: Remittance,
  eligibility: Eligibility,
};

export function BlogCover({ variant, id }: { variant: CoverVariant; id: string }) {
  const Art = VARIANTS[variant];
  return <Art id={id} />;
}
