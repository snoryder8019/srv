// Resolve the current shift time + local date for a brand
// Uses brand.settings.timezone and shift hour boundaries

function getShiftInfo(brand) {
  const s = brand?.settings || {};
  const tz = s.timezone || 'America/New_York';
  const openHr = s.shiftOpen ?? 6;
  const midHr = s.shiftMid ?? 14;
  const closeHr = s.shiftClose ?? 18;
  const endHr = s.shiftEnd ?? 2;

  // Get current local time in the brand's timezone
  const now = new Date();
  const localStr = now.toLocaleString('en-US', { timeZone: tz });
  const local = new Date(localStr);
  const hour = local.getHours();

  // Determine shift
  let shiftTime;
  if (endHr > 0 && hour < endHr) {
    // After midnight but before end = still close shift, date is yesterday
    shiftTime = 'close';
    local.setDate(local.getDate() - 1);
  } else if (hour >= closeHr) {
    shiftTime = 'close';
  } else if (hour >= midHr) {
    shiftTime = 'mid';
  } else if (hour >= openHr) {
    shiftTime = 'open';
  } else {
    // Before open hour (e.g. 3am-6am) — still previous close
    shiftTime = 'close';
    local.setDate(local.getDate() - 1);
  }

  const date = local.toISOString().slice(0, 10);

  return { shiftTime, date, hour, timezone: tz, localTime: local };
}

module.exports = { getShiftInfo };
