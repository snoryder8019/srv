/**
 * PDF text extraction (pure-JS, no native deps).
 *
 * Wells Fargo (and most bank) statements are text-based PDFs, so we can pull the
 * transaction text without OCR. We import pdf-parse's lib entry directly rather
 * than the package root — the root runs a debug harness that reads a sample file
 * from disk when `module.parent` is falsy, which breaks under ESM.
 *
 * Returns { text, pages, info } — text is the concatenated page text. Throws on a
 * corrupt/encrypted PDF so callers can fall back to manual entry.
 */
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export async function extractPdfText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('empty PDF buffer');
  const data = await pdfParse(buffer, { max: 0 }); // max:0 → all pages
  return {
    text: String(data.text || ''),
    pages: data.numpages || 0,
    info: data.info || {},
  };
}
