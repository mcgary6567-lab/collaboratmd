import { ChevronDown } from "lucide-react";

/**
 * Collapsible FAQ.
 *
 * Built on the native disclosure element rather than component state: it needs
 * no JavaScript to open, it is keyboard operable and screen-reader announced
 * for free, and the browser's own find-in-page can reach text inside a closed
 * answer. A hand-rolled accordion gives up all four.
 *
 * The first item opens by default so the section does not read as an empty
 * list of questions.
 */
export function Faq({
  items,
  openFirst = true,
}: {
  items: { q: string; a: string }[];
  openFirst?: boolean;
}) {
  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {items.map(({ q, a }, i) => (
        <details key={q} open={openFirst && i === 0} className="group">
          <summary
            className="flex cursor-pointer list-none items-center justify-between gap-6 px-6 py-5 transition-colors hover:bg-slate-50 [&::-webkit-details-marker]:hidden"
          >
            <h3 className="text-base font-bold text-slate-900 group-open:text-green-700">{q}</h3>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors group-open:bg-green-600 group-open:text-white">
              <ChevronDown className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
            </span>
          </summary>
          <p className="px-6 pb-5 pr-16 text-[15px] leading-relaxed text-slate-600">{a}</p>
        </details>
      ))}
    </div>
  );
}
