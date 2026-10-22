const C = self.DISMISSAL_CONFIG;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
const fmt = ms => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const to12 = hm => { const [h, m] = hm.split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

async function render() {
  const { lastRun, settings, ingestKey } = await chrome.storage.local.get(['lastRun', 'settings', 'ingestKey']);
  const s = { ...C.DEFAULTS, ...(settings || {}) };
  $('time').value = s.time; $('weekdays').checked = s.weekdaysOnly; $('recheck').checked = s.recheck; $('until').value = s.recheckUntil;
  $('key').value = ingestKey || C.INGEST_KEY || '';

  const st = $('status');
  if (!lastRun) st.innerHTML = `<b>Not run yet</b><span class="muted">Next pull: ${to12(s.time)} on school days</span>`;
  else if (lastRun.ok) {
    st.innerHTML = `<b class="ok">Boards updated</b>${fmt(lastRun.at)} · ${lastRun.teachers} teachers · ${lastRun.students} students` +
      (lastRun.lastError ? `<div class="err muted">Later re-check failed: ${esc(lastRun.lastError.error)}</div>` : '') +
      `<div class="muted">Daily pull: ${to12(s.time)}</div>`;
  } else {
    st.innerHTML = `<b class="err">Last pull failed</b>${fmt(lastRun.at)}<div class="err">${esc(lastRun.error)}</div>`;
  }
  const list = (lastRun && lastRun.list) || [];
  $('list').innerHTML = list.map(t => `<li><a href="${C.BOARD_BASE_URL}${esc(t.slug)}" target="_blank">${esc(t.name)} — ${C.BOARD_BASE_URL.replace('https://', '')}${esc(t.slug)}</a></li>`).join('') || '<li class="muted">Appears after the first pull.</li>';
}

$('run').onclick = async () => {
  $('run').disabled = true; $('run').textContent = 'Pulling from KidAccount…';
  await chrome.runtime.sendMessage({ type: 'runNow' });
  $('run').disabled = false; $('run').textContent = 'Run now';
  render();
};
$('save').onclick = async () => {
  await chrome.storage.local.set({
    settings: { time: $('time').value || C.DEFAULTS.time, weekdaysOnly: $('weekdays').checked, recheck: $('recheck').checked, recheckUntil: $('until').value || C.DEFAULTS.recheckUntil },
    ingestKey: $('key').value.trim()
  });
  $('saved').textContent = 'Saved.';
  render();
};
$('all').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: C.BOARD_BASE_URL.replace(/\/$/, '') }); };
render();
