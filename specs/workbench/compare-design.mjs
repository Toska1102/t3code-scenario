import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

const [referenceDir, runtimeDir, differenceDir] = process.argv.slice(2);
NodeAssert.ok(
  referenceDir && runtimeDir && differenceDir,
  "Usage: node compare-design.mjs <reference screenshots> <runtime screenshots> <output folder>",
);
const require = NodeModule.createRequire(import.meta.url);
const { chromium } = require(process.env.WORKBENCH_PLAYWRIGHT ?? "playwright");
const files = (await NodeFSP.readdir(referenceDir))
  .filter((file) => /^\d\d-\d\d-.+\.png$/.test(file))
  .sort();
NodeAssert.equal(files.length, 10, "Expected screenshots of all ten reference boards");
await NodeFSP.mkdir(differenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  const page = await browser.newPage();
  for (const file of files) {
    const expected = await NodeFSP.readFile(NodePath.join(referenceDir, file));
    let actual;
    try {
      actual = await NodeFSP.readFile(NodePath.join(runtimeDir, file));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      report.push({ file, status: "missing" });
      continue;
    }
    const result = await page.evaluate(
      async ([before, after]) => {
        async function pixels(encoded) {
          const image = new Image();
          image.src = `data:image/png;base64,${encoded}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          return {
            width: image.width,
            height: image.height,
            data: context.getImageData(0, 0, image.width, image.height).data,
          };
        }
        const [design, runtime] = await Promise.all([pixels(before), pixels(after)]);
        if (design.width !== runtime.width || design.height !== runtime.height) {
          return {
            status: "dimensions",
            design: [design.width, design.height],
            runtime: [runtime.width, runtime.height],
          };
        }
        const overlay = new ImageData(design.width, design.height);
        let changed = 0;
        for (let i = 0; i < design.data.length; i += 4) {
          const different =
            design.data[i] !== runtime.data[i] ||
            design.data[i + 1] !== runtime.data[i + 1] ||
            design.data[i + 2] !== runtime.data[i + 2] ||
            design.data[i + 3] !== runtime.data[i + 3];
          if (different) changed++;
          overlay.data[i] = different ? 255 : runtime.data[i] / 2;
          overlay.data[i + 1] = different ? 0 : runtime.data[i + 1] / 2;
          overlay.data[i + 2] = different ? 128 : runtime.data[i + 2] / 2;
          overlay.data[i + 3] = 255;
        }
        if (!changed) return { status: "identical", changed };
        const canvas = document.createElement("canvas");
        canvas.width = design.width;
        canvas.height = design.height;
        canvas.getContext("2d").putImageData(overlay, 0, 0);
        return {
          status: "different",
          changed,
          total: design.width * design.height,
          overlay: canvas.toDataURL("image/png").split(",")[1],
        };
      },
      [expected.toString("base64"), actual.toString("base64")],
    );
    const { overlay, ...entry } = result;
    if (overlay)
      await NodeFSP.writeFile(NodePath.join(differenceDir, file), Buffer.from(overlay, "base64"));
    report.push({ file, ...entry });
  }
} finally {
  await browser.close();
}
await NodeFSP.writeFile(
  NodePath.join(differenceDir, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.table(report);
if (report.some((entry) => entry.status !== "identical")) process.exitCode = 1;
