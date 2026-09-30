// Render the documentation to PDF with headless Chromium:  node docs/src/build_docs.js
// Output: docs/Tf_Studio_User_Guide.pdf, docs/Tf_Studio_Quick_Start.pdf (also copied to site/docs/)
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const here = __dirname, out = path.join(here, ".."), site = path.join(here, "..", "..", "site", "docs");
const footer = title => `<div style="width:100%;font-size:8px;color:#8a96a6;padding:0 0.7in;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif"><span>${title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
(async () => {
  const b = await chromium.launch();
  fs.mkdirSync(site, { recursive: true });
  for (const [src, dst, title, first] of [["user_guide.html", "Tf_Studio_User_Guide.pdf", "Tf Studio (Beta) · User Guide · v1.2", false], ["quick_start.html", "Tf_Studio_Quick_Start.pdf", "Tf Studio (Beta) · Quick Start · v1.2", true]]) {
    const p = await b.newPage();
    await p.goto("file://" + path.join(here, src), { waitUntil: "networkidle" });
    await p.pdf({ path: path.join(out, dst), format: "Letter", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer(title) });
    if (src === "user_guide.html") {   // full-bleed cover without footer, prepended to the body
      const c = await b.newPage(); await c.goto("file://" + path.join(here, "user_guide_cover.html"), { waitUntil: "networkidle" });
      const coverPdf = path.join(here, "_cover.pdf"); await c.pdf({ path: coverPdf, format: "Letter", printBackground: true, preferCSSPageSize: true }); await c.close();
      require("child_process").execFileSync("qpdf", ["--empty", "--pages", coverPdf, path.join(out, dst), "--", path.join(out, "_ug.pdf")]);
      fs.renameSync(path.join(out, "_ug.pdf"), path.join(out, dst)); fs.unlinkSync(coverPdf);
    }
    fs.copyFileSync(path.join(out, dst), path.join(site, dst));
    console.log("wrote", dst);
    await p.close();
  }
  await b.close();
})();
