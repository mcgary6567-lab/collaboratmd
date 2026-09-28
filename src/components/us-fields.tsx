import { US_STATES } from "@/lib/us";

/** A US state or territory: a list, never free text. */
export function StateSelect({ name = "state", defaultValue, required, disabled, className = "select", id }: { name?: string; defaultValue?: string | null; required?: boolean; disabled?: boolean; className?: string; id?: string }) {
  return (
    <select name={name} id={id} className={className} defaultValue={defaultValue ?? ""} required={required} disabled={disabled} autoComplete="address-level1">
      <option value="">{required ? "Choose..." : "State"}</option>
      {US_STATES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
    </select>
  );
}

/** ZIP and phone inputs with the right keyboard on a phone. */
export function ZipInput({ name = "zip", defaultValue, required, disabled, className = "input" }: { name?: string; defaultValue?: string | null; required?: boolean; disabled?: boolean; className?: string }) {
  return <input name={name} className={className} defaultValue={defaultValue ?? ""} required={required} disabled={disabled} inputMode="numeric" autoComplete="postal-code" pattern="\d{5}(-?\d{4})?" title="5 digits, or ZIP+4" maxLength={10} />;
}

export function PhoneInput({ name = "phone", defaultValue, required, disabled, className = "input" }: { name?: string; defaultValue?: string | null; required?: boolean; disabled?: boolean; className?: string }) {
  return <input name={name} type="tel" className={className} defaultValue={defaultValue ?? ""} required={required} disabled={disabled} autoComplete="tel" placeholder="(555) 010-1234" />;
}
