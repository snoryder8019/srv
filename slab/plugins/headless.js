// ─────────────────────────────────────────────────────────────────────────────
// Shared headless-Chrome helper (puppeteer). Renders a self-contained HTML
// string to a print-ready PDF or a high-DPI PNG. Used by Print Studio export.
// One browser is launched per call and always closed — render volume is low.
// ─────────────────────────────────────────────────────────────────────────────
import puppeteer from 'puppeteer';

const LAUNCH = { headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] };

// Wait for web fonts + images so nothing renders half-loaded.
async function settle(page) {
  try {
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const imgs = Array.from(document.images).map((i) => i.complete ? null :
        new Promise((res) => { i.onload = i.onerror = res; }));
      await Promise.all(imgs);
    });
  } catch { /* best-effort */ }
}

// Render HTML → PDF buffer at exact physical size. wIn/hIn are full bleed inches.
export async function htmlToPdf(html, wIn, hIn) {
  const browser = await puppeteer.launch(LAUNCH);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await settle(page);
    // puppeteer v24 returns a Uint8Array — wrap as a Node Buffer so archiver
    // .append() and Express res.send() accept it.
    return Buffer.from(await page.pdf({
      width: `${wIn}in`, height: `${hIn}in`,
      printBackground: true, pageRanges: '1', preferCSSPageSize: false,
    }));
  } finally {
    await browser.close();
  }
}

// Render HTML → PNG buffer at the given DPI (capped so huge posters stay sane).
export async function htmlToPng(html, wIn, hIn, dpi = 300) {
  const browser = await puppeteer.launch(LAUNCH);
  try {
    const page = await browser.newPage();
    // CSS renders at 96px/in; deviceScaleFactor lifts that to the target dpi.
    const scale = Math.min(dpi / 96, 3.2);
    await page.setViewport({
      width: Math.round(wIn * 96), height: Math.round(hIn * 96), deviceScaleFactor: scale,
    });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await settle(page);
    const el = await page.$('.material');
    const shot = await (el ? el.screenshot({ omitBackground: false }) : page.screenshot({ fullPage: true }));
    return Buffer.from(shot); // Uint8Array → Buffer for archiver / res.send
  } finally {
    await browser.close();
  }
}

// Render many items with ONE browser (used by the ZIP export so we don't pay a
// browser launch per format). items: [{html, wIn, hIn, kind:'pdf'|'png', name}].
// Returns [{name, buffer}]; a failed item is skipped (logged by the caller path).
export async function htmlToBatch(items, dpi = 300) {
  const browser = await puppeteer.launch(LAUNCH);
  const out = [];
  try {
    for (const it of items) {
      const page = await browser.newPage();
      try {
        if (it.kind === 'png') {
          page.setViewport({ width: Math.round(it.wIn * 96), height: Math.round(it.hIn * 96), deviceScaleFactor: Math.min(dpi / 96, 3.2) });
        }
        await page.setContent(it.html, { waitUntil: 'networkidle0', timeout: 30000 });
        await settle(page);
        let buf;
        if (it.kind === 'png') {
          const el = await page.$('.material');
          buf = await (el ? el.screenshot({ omitBackground: false }) : page.screenshot({ fullPage: true }));
        } else {
          buf = await page.pdf({ width: `${it.wIn}in`, height: `${it.hIn}in`, printBackground: true, pageRanges: '1' });
        }
        out.push({ name: it.name, buffer: Buffer.from(buf) });
      } catch (e) {
        out.push({ name: it.name, error: e.message });
      } finally {
        await page.close();
      }
    }
    return out;
  } finally {
    await browser.close();
  }
}
