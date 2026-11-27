import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const require = NodeModule.createRequire(import.meta.url);
const { chromium } = require(process.env.WORKBENCH_PLAYWRIGHT ?? "playwright");
const design = NodePath.resolve(process.argv[2] ?? "docs/design-html");
const output = NodePath.resolve(process.argv[3] ?? ".scratch/agent-team-workbench/reference");
const boards = (await NodeFSP.readdir(design))
  .filter((name) => /^\d\d-\d\d-.+\.html$/.test(name))
  .sort();
NodeAssert.equal(boards.length, 10, "Pencil must contain all ten business boards");
await NodeFSP.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const file of boards) {
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
    try {
      await page.goto(NodeURL.pathToFileURL(NodePath.resolve(design, file)).href, {
        waitUntil: "domcontentloaded",
        timeout: 10_000,
      });
      const prefix = file.slice(0, 5).replace("-", ".");
      const board = page
        .locator(`[data-pencil-name^="${prefix} "]`)
        .filter({ visible: true })
        .last();
      const metrics = await board.evaluate(async (node) => {
        await document.fonts.ready;
        const rect = node.getBoundingClientRect();
        const collect = (item) => {
          const bounds = item.getBoundingClientRect();
          const css = getComputedStyle(item);
          return {
            name: item.getAttribute("data-pencil-name"),
            text: item.childElementCount ? undefined : item.textContent.trim() || undefined,
            x: Math.round(bounds.x - rect.x),
            y: Math.round(bounds.y - rect.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
            color: css.color,
            background: css.backgroundColor,
            border: css.borderColor,
            radius: css.borderRadius,
            font: `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`,
          };
        };
        return [collect(node), ...[...node.querySelectorAll("[data-pencil-name]")].map(collect)];
      });
      NodeAssert.equal(metrics[0].width, 2560, file);
      NodeAssert.equal(metrics[0].height, { "01.02": 2296, "03.01": 2496 }[prefix] ?? 1440, file);
      const name = file.replace(".html", "");
      await board.screenshot({
        path: NodePath.resolve(output, `${name}.png`),
        animations: "disabled",
      });
      await NodeFSP.writeFile(
        NodePath.resolve(output, `${name}.json`),
        `${JSON.stringify(metrics, null, 2)}\n`,
      );
      console.log(`${name} ${metrics.length} nodes`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
