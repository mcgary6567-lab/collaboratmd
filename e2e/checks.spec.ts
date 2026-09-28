import { expect, test } from "@playwright/test";
import { coveredControls, sidewaysOverflow, squashedControls } from "./helpers";

/**
 * The layout checks the accessibility crawl relies on, shown to catch what
 * they are for: each problem is planted on a page and must be reported. A
 * crawl that passes only means something if these do.
 */
test("the layout checks catch a squashed dropdown, a spilling button, a covered button and a too-wide page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login");
  expect(await squashedControls(page)).toEqual([]);
  expect(await sidewaysOverflow(page)).toEqual([]);

  // Replace the page's content with the planted problems, so nothing else moves them.
  await page.evaluate(() => {
    document.querySelector("main")!.innerHTML = `
      <div style="padding:16px;width:300px">
        <select style="width:56px;padding:4px 8px"><option>Card</option></select>
        <button style="width:40px;white-space:nowrap;overflow:visible">Email reset link</button>
        <input type="number" placeholder="25.00" style="width:48px;padding:4px 12px">
        <div class="card" style="width:120px"><select style="width:160px"><option>Normal</option></select></div>
        <div style="position:relative;height:60px;margin-top:16px">
          <button style="position:absolute;left:0;top:0">Sign out</button>
          <div style="position:absolute;left:0;top:0;width:200px;height:60px;background:#fff"></div>
        </div>
      </div>`;
  });
  expect((await squashedControls(page)).join("\n")).toMatch(/<select> "Card"/);
  expect((await squashedControls(page)).join("\n")).toMatch(/"Email reset link" label spills out/);
  expect((await squashedControls(page)).join("\n")).toMatch(/<input> "25.00" shows/);
  expect((await squashedControls(page)).join("\n")).toMatch(/<select> "Normal" reaches \d+px outside its card/);
  expect((await coveredControls(page)).join("\n")).toMatch(/"Sign out" under <div>/);
  expect(await sidewaysOverflow(page)).toEqual([]);
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<div style="width:600px;height:10px"></div>`));
  expect((await sidewaysOverflow(page)).length).toBeGreaterThan(0);
});
