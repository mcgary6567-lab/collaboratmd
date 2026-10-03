import { partLabel, PARTS, TIME_OFF_KINDS } from "@/server/shifts";
import { fmtDate } from "@/lib/utils";

const day = (v: string) => fmtDate(`${v}T00:00:00`);

/** "Vacation, Oct 5, 2026 to Oct 7, 2026" or "Sick, Oct 5, 2026 (Morning)". */
export function offText(o: { kind: string; startsOn: string; endsOn: string; part: string; fromTime: string | null; toTime: string | null }) {
  const part = partLabel(o);
  return `${TIME_OFF_KINDS[o.kind] ?? o.kind}, ${day(o.startsOn)}${o.endsOn !== o.startsOn ? ` to ${day(o.endsOn)}` : ""}${part ? ` (${part.toLowerCase()})` : ""}`;
}

/** Whole days, or part of the first day: a morning, an afternoon (the halves of that day's shift) or set hours. */
export function PartFields() {
  return (
    <>
      <label className="block"><span className="label">How much</span>
        <select name="part" className="input">{Object.entries(PARTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="label">Set hours from</span><input type="time" name="fromTime" className="input" /></label>
        <label className="block"><span className="label">to</span><input type="time" name="toTime" className="input" /></label>
      </div>
    </>
  );
}
