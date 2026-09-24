import { describe, expect, it } from "vitest";
import { netCollection } from "./analytics";

describe("net collection", () => {
  it("is collected over charges less contractual adjustments, counting unlinked patient payments", () => {
    // $100 billed, $40 contractual, so $60 collectible; $50 from the payer, $5 on the claim and $3 unlinked from the patient.
    expect(netCollection({ charges: "10000", contractual: "4000", collected: "5500", unlinked_patient: "300" })).toBeCloseTo(5800 / 6000);
  });

  it("has no value until something in the cohort is collectible", () => {
    expect(netCollection({ charges: "0", contractual: "0", collected: "0", unlinked_patient: "0" })).toBeNull();
    expect(netCollection({})).toBeNull();
  });
});
