import { describe, expect, it } from "vitest";
import { emLevel, mdmLevel } from "./em";
import { expandQuery, suggestDiagnoses } from "./dx";
import { validateNoteCoding } from "@/lib/ai/code-note";

describe("E/M level", () => {
  it("levels by total time at each minimum", () => {
    expect(emLevel({ kind: "established", minutes: 9 }).code).toBeNull();
    expect(emLevel({ kind: "established", minutes: 10 }).code).toBe("99212");
    expect(emLevel({ kind: "established", minutes: 29 }).code).toBe("99213");
    expect(emLevel({ kind: "established", minutes: 30 }).code).toBe("99214");
    expect(emLevel({ kind: "established", minutes: 40 }).code).toBe("99215");
    expect(emLevel({ kind: "new", minutes: 15 }).code).toBe("99202");
    expect(emLevel({ kind: "new", minutes: 44 }).code).toBe("99203");
    expect(emLevel({ kind: "new", minutes: 60 }).code).toBe("99205");
  });

  it("adds 99417 for each full 15 minutes beyond the top level", () => {
    expect(emLevel({ kind: "new", minutes: 74 }).prolongedUnits).toBe(0);
    expect(emLevel({ kind: "new", minutes: 75 }).prolongedUnits).toBe(1);
    expect(emLevel({ kind: "established", minutes: 70 }).prolongedUnits).toBe(2);
  });

  it("MDM is met by two of three elements", () => {
    expect(mdmLevel({ problems: "high", data: "straightforward", risk: "moderate" })).toBe("moderate");
    expect(mdmLevel({ problems: "low", data: "low", risk: "high" })).toBe("low");
    expect(emLevel({ kind: "established", mdm: { problems: "moderate", data: "low", risk: "moderate" } }).code).toBe("99214");
  });

  it("uses whichever of time and MDM supports the higher level", () => {
    const r = emLevel({ kind: "established", minutes: 22, mdm: { problems: "moderate", data: "moderate", risk: "low" } });
    expect(r).toMatchObject({ byTime: "99213", byMdm: "99214", code: "99214", basis: "mdm", prolongedUnits: 0 });
    expect(emLevel({ kind: "established", minutes: 45, mdm: { problems: "low", data: "low", risk: "low" } })).toMatchObject({ code: "99215", basis: "time" });
  });
});

describe("diagnosis finder", () => {
  const codes = [
    { code: "I10", description: "Essential (primary) hypertension" },
    { code: "E11.9", description: "Type 2 diabetes mellitus without complications" },
    { code: "M54.50", description: "Low back pain, unspecified" },
    { code: "N39.0", description: "Urinary tract infection, site not specified" },
  ];
  it("maps everyday words to the terms codes use", () => {
    expect(expandQuery("high blood pressure")).toContain("hypertension");
    expect(suggestDiagnoses("pt has high blood pressure", codes)[0].code).toBe("I10");
    expect(suggestDiagnoses("sugar", codes)[0].code).toBe("E11.9");
    expect(suggestDiagnoses("UTI", codes)[0].code).toBe("N39.0");
    expect(suggestDiagnoses("lower back hurts", codes)[0].code).toBe("M54.50");
    expect(suggestDiagnoses("m54", codes)[0].code).toBe("M54.50");
    expect(suggestDiagnoses("", codes)).toEqual([]);
  });
});

describe("AI note coding output", () => {
  it("keeps only known codes, once each, and drops junk", () => {
    const out = validateNoteCoding(
      { cpts: [{ code: "99214", why: "moderate MDM" }, { code: "99999", why: "made up" }, { code: "99214", why: "dup" }], diagnoses: [{ code: "i10", why: "HTN" }, "bad"], gaps: ["no time documented", 5] },
      new Set(["99214"]),
      new Set(["I10"]),
    );
    expect(out).toEqual({ cpts: [{ code: "99214", why: "moderate MDM" }], diagnoses: [{ code: "I10", why: "HTN" }], gaps: ["no time documented"] });
    expect(validateNoteCoding(null, new Set(), new Set())).toEqual({ cpts: [], diagnoses: [], gaps: [] });
  });
});
