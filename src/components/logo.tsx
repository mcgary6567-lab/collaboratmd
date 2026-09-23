/**
 * CollaboratMD brand mark and wordmark.
 *
 * The mark is a medical cross built from two overlapping rounded bars rather
 * than one solid glyph: the overlap is the point, since the product's job is
 * to put the practice, the biller and the payer on the same claim. Drawn as
 * inline SVG so it stays sharp at every size, needs no binary asset in the
 * repository, and can be recolored from CSS.
 *
 * `id` must be unique per rendered instance because SVG gradient ids are
 * document-global; two marks sharing one id would both paint the first
 * gradient defined.
 */

export function LogoMark({
  className = "h-9 w-9",
  id = "cmd-mark",
}: {
  className?: string;
  id?: string;
}) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="CollaboratMD">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#15803d" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      {/* Vertical bar: the practice. Horizontal bar: the payer. They meet. */}
      <rect x="13.2" y="5.6" width="5.6" height="20.8" rx="2.8" fill="#ffffff" fillOpacity="0.95" />
      <rect x="5.6" y="13.2" width="20.8" height="5.6" rx="2.8" fill="#ffffff" fillOpacity="0.68" />
    </svg>
  );
}

/** Mark plus wordmark. `tone="light"` is for dark backgrounds. */
export function Logo({
  className = "",
  markClassName = "h-9 w-9",
  textClassName = "text-[15px]",
  tone = "dark",
  id = "cmd-mark",
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  tone?: "dark" | "light";
  id?: string;
}) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark className={markClassName} id={id} />
      <span className={`font-bold tracking-tight ${textClassName} ${tone === "light" ? "text-white" : "text-slate-900"}`}>
        Collaborat<span className={tone === "light" ? "text-green-300" : "text-green-600"}>MD</span>
      </span>
    </span>
  );
}
