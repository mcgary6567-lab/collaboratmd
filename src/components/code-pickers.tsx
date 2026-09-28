import { PLACES_OF_SERVICE } from "@/lib/codes/pos";
import { COMMON_TAXONOMIES } from "@/lib/codes/taxonomy";

/** The full CMS place of service list. */
export function PosOptions() {
  return <>{PLACES_OF_SERVICE.map(([code, name]) => <option key={code} value={code}>{code} - {name}</option>)}</>;
}

/**
 * A taxonomy code input with the common codes as suggestions (typing a
 * specialty name or code narrows them); any valid NUCC code can still be typed.
 */
export function TaxonomyInput({ name = "taxonomy", defaultValue, required, className = "input", id = "taxonomy-options", placeholder }: { name?: string; defaultValue?: string | null; required?: boolean; className?: string; id?: string; placeholder?: string }) {
  return (
    <>
      <input name={name} className={className} defaultValue={defaultValue ?? ""} required={required} placeholder={placeholder} aria-label="Taxonomy code" list={id} pattern="[0-9]{3}[0-9A-Za-z]{6}[Xx]" title="10 characters, ending in X, like 207Q00000X" autoComplete="off" />
      <datalist id={id}>
        {COMMON_TAXONOMIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </datalist>
    </>
  );
}
