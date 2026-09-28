import { describe, expect, it } from "vitest";
import { fmtClock as clock, fmtDate, fmtDateTime as dateTime, statusLabel } from "./utils";
import { pagesFor } from "./nav";
import { timeZoneName, US_TIME_ZONES, validTimeZone } from "@/server/practice-time";

// Some ICU versions put a narrow no-break space before AM/PM.
const plain = (s: string) => s.replace(/ /g, " ");
const fmtDateTime = (d: Date, tz?: string) => plain(dateTime(d, tz));
const fmtClock = (d: Date) => plain(clock(d));

describe("US formats", () => {
  it("shows a moment on the practice's clock, with its zone, and no leading zero on the hour", () => {
    const at = new Date("2026-09-28T13:05:00Z");
    expect(fmtDateTime(at, "America/New_York")).toBe("Sep 28, 2026, 9:05 AM EDT");
    expect(fmtDateTime(at, "America/Los_Angeles")).toBe("Sep 28, 2026, 6:05 AM PDT");
    // Late evening in Los Angeles is already the next day in UTC.
    expect(fmtDate(new Date("2026-09-29T03:00:00Z"), "America/Los_Angeles")).toBe("Sep 28, 2026");
  });

  it("never moves a calendar date, and shows an appointment's clock time as stored", () => {
    expect(fmtDate("2026-09-01")).toBe("Sep 1, 2026");
    expect(fmtDate("1984-03-02", "Pacific/Honolulu")).toBe("Mar 2, 1984");
    expect(fmtClock(new Date("2026-09-28T09:05:00Z"))).toBe("Sep 28, 2026, 9:05 AM");
  });

  it("names claim statuses and time zones in words", () => {
    expect(statusLabel("partially_paid")).toBe("Partially paid");
    expect(statusLabel("billed_secondary")).toBe("At secondary");
    expect(statusLabel("some_new_state")).toBe("Some new state");
    for (const tz of US_TIME_ZONES) expect(validTimeZone(tz)).toBe(true);
    expect(timeZoneName("America/Phoenix")).toMatch(/Arizona/);
    expect(timeZoneName("Pacific/Guam")).toMatch(/Guam/);
  });

  it("search finds settings pages that are not in the menu, for administrators only", () => {
    expect(pagesFor("admin", false).some((p) => p.href === "/settings/team")).toBe(true);
    expect(pagesFor("biller", false).some((p) => p.href === "/settings/team")).toBe(false);
    const hrefs = pagesFor("admin", true).map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
