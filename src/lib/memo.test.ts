import { describe, expect, it } from "vitest";
import { forget, memo } from "./memo";

describe("summary cache", () => {
  it("computes once within the time limit, again after it, and not at all for a failure", async () => {
    let n = 0;
    const f = async () => ++n;
    expect(await memo("k", 1000, f, 0)).toBe(1);
    expect(await Promise.all([memo("k", 1000, f, 500), memo("k", 1000, f, 999)])).toEqual([1, 1]);
    expect(await memo("k", 1000, f, 1001)).toBe(2);
    forget("k");
    expect(await memo("k", 1000, f, 1002)).toBe(3);
    await expect(memo("bad", 1000, async () => { throw new Error("x"); }, 0)).rejects.toThrow("x");
    expect(await memo("bad", 1000, async () => "ok", 1)).toBe("ok");
  });
});
