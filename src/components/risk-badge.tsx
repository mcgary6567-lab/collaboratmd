import type { Risk } from "@/server/risk";

const TONES = {
  low: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

export function RiskBadge({ risk, compact = false }: { risk: Risk; compact?: boolean }) {
  return (
    <span className={`badge ${TONES[risk.level]}`} title={risk.reasons.join("\n") || "No warning signs"}>
      {compact ? `${risk.level} risk` : `${risk.level} risk · ${risk.score}`}
    </span>
  );
}
