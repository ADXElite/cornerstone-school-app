importScripts('config.js');
const C = self.DISMISSAL_CONFIG;
const CATCH_UP_UNTIL = '17:00';      // if Chrome was closed at 2:30, still run when it opens before 5 PM
const RECHECK_EVERY_MIN = 10;

// ---------- schedule: a 1-minute heartbeat that decides whether a pull is due ----------
chrome.runtime.onInstalled.addListener(async d => {
  // v1.0.2 moved the daily pull from 2:15 to 2:30 PM; move a saved 2:15 setting along with it.
  if (d.reason === 'update') {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings && settings.time === '14:15') await chrome.storage.local.set({ settings: { ...settings, time: '14:30' } });
  }
  ensureAlarm();
});
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tick') maybeRun(); });
function ensureAlarm() { chrome.alarms.create('tick', { periodInMinutes: 1 }); maybeRun(); }

function nyParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, weekday: p.weekday };
}

async function getSettings() {
  const s = await chrome.storage.local.get(['settings', 'ingestKey']);
  return { ...C.DEFAULTS, ...(s.settings || {}), ingestKey: s.ingestKey || C.INGEST_KEY };
}

let running = false;
async function maybeRun() {
  if (running) return;
  const s = await getSettings();
  const now = nyParts();
  if (s.weekdaysOnly && (now.weekday === 'Sat' || now.weekday === 'Sun')) return;
  if (now.hm < s.time) return;
  const { lastRun } = await chrome.storage.local.get('lastRun');
  // A manual pull earlier in the day doesn't count — the 2:30 pull still happens.
  const ranToday = lastRun && lastRun.date === now.date && lastRun.ok && (lastRun.hm || '') >= s.time;
  if (!ranToday) {
    // After a failure, retry every 5 minutes (e.g. once someone signs back in to KidAccount)
    if (lastRun && lastRun.date === now.date && Date.now() - lastRun.at < 5 * 60000) return;
    if (now.hm <= CATCH_UP_UNTIL) return runSync('scheduled');
    return;
  }
  if (s.recheck && now.hm <= s.recheckUntil && Date.now() - lastRun.at >= RECHECK_EVERY_MIN * 60000) {
    return runSync('recheck');
  }
}

// ---------- messages from the popup ----------
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'runNow') { runSync('manual').then(reply); return true; }
});

// ---------- the pull ----------
async function runSync(reason) {
  if (running) return { ok: false, error: 'Already running' };
  running = true;
  const started = Date.now();
  let tab;
  try {
    const s = await getSettings();
    if (!s.ingestKey) throw new Error('Upload key missing — open the extension and paste it in Settings.');

    // Open KidAccount in a background tab so requests carry your normal KidAccount sign-in.
    tab = await chrome.tabs.create({ url: C.KIDACCOUNT_LIST_URL, active: false });
    await waitForLoad(tab.id);
    const t = await chrome.tabs.get(tab.id);
    if (!/teacherlist\.php/i.test(t.url || '')) throw new Error('Not signed in to KidAccount — sign in in Chrome, then click Run now.');

    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeAllTeachers });
    if (!result || result.error) throw new Error(result?.error || 'Could not read KidAccount');
    if (!result.teachers.length) throw new Error('No teachers found on the KidAccount teacher list.');

    const date = nyParts().date;
    const boards = result.teachers.map(t => ({ ...t, slug: slugify(t.teacher_name), board_date: date }));

    const r = await fetch(`${C.SUPABASE_URL}/rest/v1/rpc/ingest_dismissal`, {
      method: 'POST',
      headers: { apikey: C.SUPABASE_KEY, Authorization: `Bearer ${C.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: s.ingestKey, p_boards: boards })
    });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Upload key was rejected.' : `Upload failed (${r.status}).`);

    const students = boards.reduce((n, b) => n + b.groups.reduce((m, g) => m + g.students.length, 0), 0);
    const status = { ok: true, at: Date.now(), date, hm: nyParts().hm, reason, teachers: boards.length, students,
      list: boards.map(b => ({ name: b.teacher_name, slug: b.slug })), ms: Date.now() - started };
    await chrome.storage.local.set({ lastRun: status });
    chrome.action.setBadgeText({ text: '' });
    return status;
  } catch (e) {
    const status = { ok: false, at: Date.now(), date: nyParts().date, reason, error: String(e.message || e) };
    const prev = (await chrome.storage.local.get('lastRun')).lastRun;
    // Keep today's success if a later recheck fails, but record the error.
    await chrome.storage.local.set({ lastRun: prev && prev.ok && prev.date === status.date ? { ...prev, lastError: status } : status });
    chrome.action.setBadgeBackgroundColor({ color: '#E4010D' });
    chrome.action.setBadgeText({ text: '!' });
    const alreadyWarned = prev && !prev.ok && prev.date === status.date;
    if (reason === 'manual' || (reason === 'scheduled' && !alreadyWarned)) chrome.notifications.create({
      type: 'basic', iconUrl: 'icon128.png', title: 'Dismissal boards did not update', message: status.error, priority: 2
    });
    return status;
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
    running = false;
  }
}

function slugify(name) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function waitForLoad(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); reject(new Error('KidAccount took too long to load.')); }, timeoutMs);
    function fn(id, info) {
      if (id === tabId && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(fn); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

// Runs inside the KidAccount page. Reads the teacher list, then each teacher's dismissal page.
async function scrapeAllTeachers() {
  try {
    const links = [...document.querySelectorAll('a[href*="teacherspage.php?teacher="]')]
      .filter(a => a.textContent.trim() && !/^my class$/i.test(a.textContent.trim()));
    const seen = new Set();
    const teachers = [];
    for (const a of links) {
      const id = new URL(a.href, location.href).searchParams.get('teacher');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      teachers.push({ teacher_id: id, teacher_name: a.textContent.trim().replace(/\s+/g, ' '), href: a.href });
    }
    const out = [];
    for (const t of teachers) {
      const res = await fetch(t.href, { credentials: 'include', cache: 'no-store' });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const groups = [];
      const absent = [];
      for (const fs of doc.querySelectorAll('fieldset')) {
        const method = fs.querySelector('legend')?.textContent.trim() || 'Other';
        const students = [];
        for (const c of fs.querySelectorAll(':scope > div.container, div.container')) {
          if (c.closest('fieldset') !== fs) continue;
          const fig = c.querySelector('figcaption');
          // First and last name are separated by a <br> (sometimes inside a <font>), so turn every <br> into a space
          let name = '';
          if (fig) { const f = fig.cloneNode(true); f.querySelectorAll('br').forEach(b => b.replaceWith(' ')); name = f.textContent.replace(/\s+/g, ' ').trim(); }
          if (!name) continue;
          const detail = c.querySelector('.submethod')?.textContent.trim() || '';
          const popup = c.nextElementSibling;
          const isAbsent = !!(popup && popup.classList.contains('popup-content') &&
            [...popup.querySelectorAll('a')].some(x => /mark as present/i.test(x.textContent)));
          if (isAbsent) absent.push(name); else students.push({ name, detail });
        }
        groups.push({ key: fs.className.trim(), method, students });
      }
      out.push({ teacher_id: t.teacher_id, teacher_name: t.teacher_name, groups, absent });
    }
    return { teachers: out };
  } catch (e) {
    return { error: 'Reading KidAccount failed: ' + e.message };
  }
}
