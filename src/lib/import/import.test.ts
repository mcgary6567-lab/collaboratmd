import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { autoMap, normalizeDate, profileColumn, splitName, toPatientRow, type Mapping } from "./patients";

const today = new Date("2026-09-24T12:00:00Z");

describe("CSV parsing", () => {
  it("handles quotes, embedded delimiters and line breaks, CRLF and a BOM", () => {
    const t = parseCsv('﻿Name,Notes,DOB\r\n"Doe, Jane","said ""hi""\r\nthen left",01/02/1980\r\nRoe Rich,,1975-07-04\r\n');
    expect(t.headers).toEqual(["Name", "Notes", "DOB"]);
    expect(t.rows).toEqual([["Doe, Jane", 'said "hi"\r\nthen left', "01/02/1980"], ["Roe Rich", "", "1975-07-04"]]);
  });

  it("detects semicolon, tab and pipe delimiters and pads short rows", () => {
    expect(parseCsv("a;b;c\n1;2").rows).toEqual([["1", "2", ""]]);
    expect(parseCsv("a\tb\n1\t2").delimiter).toBe("\t");
    expect(parseCsv("a|b\n1|2").rows).toEqual([["1", "2"]]);
  });

  it("refuses an empty file", () => {
    expect(() => parseCsv("\n\n")).toThrow(/empty/);
  });
});

describe("value normalization", () => {
  it("reads the common date forms and rejects impossible ones", () => {
    expect(normalizeDate("1980-02-29", today)).toBe("1980-02-29");
    expect(normalizeDate("2/9/1980", today)).toBe("1980-02-09");
    expect(normalizeDate("19800209", today)).toBe("1980-02-09");
    expect(normalizeDate("02/09/80", today)).toBe("1980-02-09");
    expect(normalizeDate("02/09/19", today)).toBe("2019-02-09");
    expect(normalizeDate("1981-02-29", today)).toBeNull();
    expect(normalizeDate("13/01/1980", today)).toBeNull();
  });

  it("splits full names either way round", () => {
    expect(splitName("Doe, Jane A")).toEqual({ firstName: "Jane", lastName: "Doe" });
    expect(splitName("Jane Anne Doe")).toEqual({ firstName: "Jane", lastName: "Doe" });
    expect(splitName("Cher")).toBeNull();
  });
});

describe("column mapping", () => {
  const map = (headers: string[], rows: string[][]) => {
    const profiles = headers.map((h, i) => profileColumn(h, rows.map((r) => r[i])));
    return Object.fromEntries(autoMap(profiles).filter((c) => c.column !== null).map((c) => [c.field, headers[c.column!]]));
  };

  it("maps an athena-style export", () => {
    expect(map(
      ["Patient ID", "Last Name", "First Name", "DOB", "Sex", "Home Phone", "Address 1", "City", "State", "Zip", "Primary Insurance", "Policy Number", "Group #"],
      [["A1001", "Doe", "Jane", "01/02/1980", "F", "(214) 555-0101", "1 Main St", "Dallas", "TX", "75201", "Aetna", "W1234567", "G1"]],
    )).toEqual({
      mrn: "Patient ID", lastName: "Last Name", firstName: "First Name", dob: "DOB", sex: "Sex", phone: "Home Phone", address1: "Address 1",
      city: "City", state: "State", zip: "Zip", payerName: "Primary Insurance", memberId: "Policy Number", groupNumber: "Group #",
    });
  });

  it("maps terse names and a combined name column", () => {
    expect(map(["Pt_Name", "BirthDt", "Gender", "Email", "Chart"], [["Doe, Jane", "1980-01-02", "female", "j@x.com", "C-77"]])).toEqual({
      fullName: "Pt_Name", dob: "BirthDt", sex: "Gender", email: "Email", mrn: "Chart",
    });
  });

  it("describes columns without their values", () => {
    const p = profileColumn("DOB", ["01/02/1980", "1975-07-04", ""]);
    expect(p).toEqual({ header: "DOB", filled: 2 / 3, shapes: ["date"] });
    expect(JSON.stringify(profileColumn("Name", ["Doe, Jane"]))).not.toContain("Jane");
  });
});

describe("rows", () => {
  const mapping: Mapping = { fullName: 0, dob: 1, sex: 2, phone: 3, zip: 4, email: 5 };

  it("normalizes a good row", () => {
    expect(toPatientRow(["Doe, Jane", "2/9/1980", "Female", "1 (214) 555 0101", "752011234", "Jane@Example.com"], mapping, today)).toEqual({
      ok: true,
      value: { mrn: "", firstName: "Jane", lastName: "Doe", dob: "1980-02-09", sex: "F", phone: "214-555-0101", email: "jane@example.com", address1: "", city: "", state: "", zip: "75201-1234", payerName: "", memberId: "", groupNumber: "" },
    });
  });

  it("says why a row cannot be imported", () => {
    expect(toPatientRow(["Doe, Jane", "", "F", "", "", ""], mapping, today)).toEqual({ ok: false, error: "Missing date of birth" });
    expect(toPatientRow(["Doe, Jane", "31/31/1980", "F", "", "", ""], mapping, today)).toEqual({ ok: false, error: 'Unreadable date of birth "31/31/1980"' });
    expect(toPatientRow(["Cher", "1980-01-01", "F", "", "", ""], mapping, today)).toEqual({ ok: false, error: "Missing first or last name" });
    expect(toPatientRow(["Doe, Jane", "2030-01-01", "F", "", "", ""], mapping, today)).toEqual({ ok: false, error: "Date of birth is in the future" });
  });
});
