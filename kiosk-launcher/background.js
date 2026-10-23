// Cornerstone Dismissal Board Launcher
// Every minute: inside the dismissal window (default 2:30–3:15 PM New York time, weekdays) make sure the
// board is open full-screen; at the end of the window close it. If a teacher closes the board during
// the window, it stays closed for the rest of that day.
const KIOSK_URL = 'https://app.csjax.org/kiosk';
const DEFAULTS = { board: '', start: '14:30', end: '15:15', weekdaysOnly: true };

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tick') tick(); });
function setup() { chrome.alarms.create('tick', { periodInMinutes: 1 }); tick(); }

function nyNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, weekday: p.weekday };
}

const validHm = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// Settings can be set per device group in Google Admin (Apps & extensions → this extension → Policy for extensions).
async function settings() {
  let m = {};
  try { m = await chrome.storage.managed.get(null); } catch (_) {}
  return {
    board: String(m.board || DEFAULTS.board).toLowerCase().replace(/[^a-z0-9-]/g, ''),
    start: validHm(m.start) ? m.start : DEFAULTS.start,
    end: validHm(m.end) ? m.end : DEFAULTS.end,
    weekdaysOnly: typeof m.weekdaysOnly === 'boolean' ? m.weekdaysOnly : DEFAULTS.weekdaysOnly
  };
}

// The window we opened. Session storage is cleared when Chrome restarts, which is what we want.
async function ourWindow() {
  const { winId } = await chrome.storage.session.get('winId');
  if (winId == null) return null;
  try { return await chrome.windows.get(winId); } catch (_) { return null; }
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const s = await settings();
    const now = nyNow();
    const weekend = now.weekday === 'Sat' || now.weekday === 'Sun';
    const inWindow = !(s.weekdaysOnly && weekend) && now.hm >= s.start && now.hm < s.end;
    const win = await ourWindow();

    if (!inWindow) {
      if (win) { await chrome.storage.session.set({ closing: true }); await chrome.windows.remove(win.id); }
      return;
    }
    if (win) return;
    const { dismissedDate } = await chrome.storage.local.get('dismissedDate');
    if (dismissedDate === now.date) return;   // teacher closed it today — leave it closed

    const url = KIOSK_URL + (s.board ? '?board=' + encodeURIComponent(s.board) : '');
    const w = await chrome.windows.create({ url, type: 'popup', state: 'fullscreen', focused: true });
    await chrome.storage.session.set({ winId: w.id, closing: false });
  } catch (e) {
    console.warn('Dismissal launcher:', e);
  } finally {
    busy = false;
  }
}

chrome.windows.onRemoved.addListener(async id => {
  const { winId, closing } = await chrome.storage.session.get(['winId', 'closing']);
  if (id !== winId) return;
  await chrome.storage.session.remove(['winId', 'closing']);
  if (!closing) await chrome.storage.local.set({ dismissedDate: nyNow().date });
});
