/**
 * Diagnosis finder: turns everyday words into the terms ICD-10 descriptions
 * use, then ranks the practice's code list by how many words match.
 */

const SYNONYMS: Record<string, string[]> = {
  "high blood pressure": ["hypertension"],
  "blood pressure": ["hypertension"],
  htn: ["hypertension"],
  sugar: ["diabetes"],
  diabetic: ["diabetes"],
  dm2: ["type 2 diabetes"],
  t2dm: ["type 2 diabetes"],
  cholesterol: ["hyperlipidemia"],
  lipids: ["hyperlipidemia"],
  "heart attack": ["myocardial infarction"],
  mi: ["myocardial infarction"],
  afib: ["atrial fibrillation"],
  chf: ["heart failure"],
  copd: ["chronic obstructive pulmonary"],
  flu: ["influenza"],
  cold: ["nasopharyngitis", "upper respiratory infection"],
  uri: ["upper respiratory infection"],
  uti: ["urinary tract infection"],
  "sore throat": ["pharyngitis"],
  strep: ["streptococcal pharyngitis"],
  "ear infection": ["otitis media"],
  "sinus infection": ["sinusitis"],
  "back pain": ["low back pain", "dorsalgia"],
  "lower back": ["low back pain"],
  "neck pain": ["cervicalgia"],
  "knee pain": ["pain in knee"],
  "shoulder pain": ["pain in shoulder"],
  headache: ["headache"],
  migraine: ["migraine"],
  depressed: ["depressive"],
  depression: ["depressive"],
  anxious: ["anxiety"],
  "can't sleep": ["insomnia"],
  sleep: ["insomnia"],
  overweight: ["overweight", "obesity"],
  obese: ["obesity"],
  "acid reflux": ["gastro-esophageal reflux"],
  gerd: ["gastro-esophageal reflux"],
  heartburn: ["gastro-esophageal reflux"],
  physical: ["general adult medical examination"],
  checkup: ["general adult medical examination"],
  "well visit": ["general adult medical examination", "routine child health examination"],
  vaccine: ["immunization"],
  shot: ["immunization"],
  thyroid: ["hypothyroidism"],
  "low thyroid": ["hypothyroidism"],
  anemic: ["anemia"],
  "shortness of breath": ["dyspnea"],
  sob: ["dyspnea"],
  "chest pain": ["chest pain"],
  dizzy: ["dizziness"],
  rash: ["rash", "dermatitis"],
  asthma: ["asthma"],
  arthritis: ["osteoarthritis"],
  sprain: ["sprain"],
};

const STOP = new Set(["the", "and", "of", "with", "without", "a", "an", "in", "on", "for", "to", "pt", "patient", "has", "c/o", "unspecified"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9. -]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

export function expandQuery(query: string): string[] {
  const q = query.toLowerCase();
  const terms = new Set<string>(words(q));
  for (const [phrase, targets] of Object.entries(SYNONYMS)) {
    if (new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(q)) for (const t of targets) for (const w of words(t)) terms.add(w);
  }
  return [...terms];
}

export function suggestDiagnoses(query: string, codes: { code: string; description: string }[], limit = 8) {
  const terms = expandQuery(query);
  if (!terms.length) return [];
  return codes
    .map((c) => {
      const desc = c.description.toLowerCase();
      const codeHit = terms.some((t) => c.code.toLowerCase().startsWith(t));
      const hits = terms.filter((t) => desc.includes(t)).length;
      return { ...c, score: hits + (codeHit ? 3 : 0) };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map(({ code, description }) => ({ code, description }));
}
