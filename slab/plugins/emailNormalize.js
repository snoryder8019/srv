// Normalize an email so common spam-dodging variants collapse to one key.
// - lowercase + trim
// - strip "+tag" from local part
// - for gmail/googlemail, also strip dots from local part
//
// Used by:
//   • routes/index.js POST /contact   (blocklist lookup)
//   • routes/admin/inquiries.js       (blocklist add on Spam action)

export function normalizeEmail(input) {
  if (!input || typeof input !== 'string') return '';
  const raw = input.trim().toLowerCase();
  const at = raw.lastIndexOf('@');
  if (at < 1 || at === raw.length - 1) return raw;
  let local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}
