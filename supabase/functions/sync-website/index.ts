// Pulls the latest content from csjax.org and the school Google Calendar into the app database.
// Runs daily at 11:00 AM and 6:00 PM America/New_York (pg_cron) and on demand from the admin page.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://www.csjax.org";
const CAL_ID = "ccsjax.org_2pbo7t17fq764q7u13u9jvce8c@group.calendar.google.com";
const ICS_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CAL_ID)}/public/basic.ics`;
const TZ = "America/New_York";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// ---------- helpers ----------
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
function decode(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isNaN(n) ? m : String.fromCodePoint(n); }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const clean = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/[\u200B\u00A0]/g, " ").replace(/\s+/g, " ").trim();
function absUrl(href: string) {
  href = decode(href.trim());
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return SITE + href;
  return SITE + "/" + href;
}
async function getText(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "CornerstoneSchoolApp/1.0 (+https://app.csjax.org)" } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return await r.text();
}
// Linear walk: yields text chunks and anchors in document order.
type Tok = { t: "text"; v: string } | { t: "a"; href: string; v: string };
function tokens(html: string): Tok[] {
  html = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const out: Tok[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const before = clean(html.slice(last, m.index));
    if (before) out.push({ t: "text", v: before });
    out.push({ t: "a", href: m[1], v: clean(m[2]) });
    last = re.lastIndex;
  }
  const tail = clean(html.slice(last));
  if (tail) out.push({ t: "text", v: tail });
  return out;
}
function between(html: string, start: string | RegExp, end: string | RegExp) {
  const s = typeof start === "string" ? html.indexOf(start) : html.search(start);
  if (s < 0) return "";
  const rest = html.slice(s);
  const e = typeof end === "string" ? rest.indexOf(end, 1) : rest.slice(1).search(end) + 1;
  return e > 0 ? rest.slice(0, e) : rest;
}
function parseUSDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

// ---------- Google Calendar (ICS) ----------
function parseICS(ics: string) {
  const lines = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const evs: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  for (const ln of lines) {
    if (ln === "BEGIN:VEVENT") cur = {};
    else if (ln === "END:VEVENT") { if (cur) evs.push(cur); cur = null; }
    else if (cur) {
      const i = ln.indexOf(":"); if (i < 0) continue;
      const [name, ...params] = ln.slice(0, i).split(";");
      const key = name.toUpperCase();
      if (key === "EXDATE") { cur.EXDATE = (cur.EXDATE ? cur.EXDATE + "," : "") + ln.slice(i + 1); continue; }
      cur[key] = ln.slice(i + 1);
      for (const p of params) { const [k, v] = p.split("="); if (k && v) cur[`${key};${k.toUpperCase()}`] = v; }
    }
  }
  return evs;
}
const icsText = (s = "") => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
// Event description: keep line breaks, turn Google's HTML into plain text
function icsDesc(s = "") {
  let t = s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<li[^>]*>/gi, "• ");
  t = t.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, h, x) => { const tx = x.replace(/<[^>]*>/g, "").trim(); return tx && tx !== h ? `${tx} (${h})` : h; });
  t = decode(t.replace(/<[^>]*>/g, ""));
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000) || null;
}
const nyParts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d).map((p) => [p.type, p.value]));
function nyDate(d: Date) { const p = nyParts(d); return `${p.year}-${p.month}-${p.day}`; }
function nyTime(d: Date) { const p = nyParts(d); return `${p.hour}:${p.minute} ${p.dayPeriod}`; }
// Convert a wall-clock time in America/New_York to a real Date.
function fromNY(y: number, mo: number, d: number, h: number, mi: number) {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const p = nyParts(guess);
  let hh = parseInt(p.hour) % 12; if (p.dayPeriod === "PM") hh += 12;
  const asNY = Date.UTC(+p.year, +p.month - 1, +p.day, hh, +p.minute);
  return new Date(guess.getTime() - (asNY - guess.getTime()));
}
function icsDate(v: string, tzid?: string): { date: Date; allDay: boolean } {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) throw new Error("bad date " + v);
  const [, y, mo, d, h, mi, , z] = m;
  if (!h) return { date: new Date(Date.UTC(+y, +mo - 1, +d, 12)), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)), allDay: false };
  // floating or TZID time – this calendar is America/New_York
  void tzid;
  return { date: fromNY(+y, +mo, +d, +h, +mi), allDay: false };
}
// UID|date keys of occurrences that have their own edited copy (RECURRENCE-ID) in the feed
let overridden = new Set<string>();
function expand(ev: Record<string, string>, from: Date, to: Date) {
  if (ev["RECURRENCE-ID"]) {
    const st = icsDate(ev.DTSTART);
    const en = ev.DTEND ? icsDate(ev.DTEND) : null;
    if (st.date > to || (en ? en.date : st.date).getTime() < from.getTime()) return [];
    return [{ start: st.date, end: en ? en.date : null, allDay: st.allDay }];
  }
  const st = icsDate(ev.DTSTART, ev["DTSTART;TZID"]);
  const en = ev.DTEND ? icsDate(ev.DTEND, ev["DTEND;TZID"]) : null;
  const dur = en ? en.date.getTime() - st.date.getTime() : 0;
  const starts: Date[] = [st.date];
  if (ev.RRULE) {
    const r = Object.fromEntries(ev.RRULE.split(";").map((x) => x.split("=")));
    const step = { DAILY: 1, WEEKLY: 7 }[r.FREQ as string];
    const interval = parseInt(r.INTERVAL || "1");
    const until = r.UNTIL ? icsDate(r.UNTIL.length === 8 ? r.UNTIL : r.UNTIL.replace(/Z$/, "") + "Z").date : to;
    const count = r.COUNT ? parseInt(r.COUNT) : 400;
    const byday = r.BYDAY ? r.BYDAY.split(",") : null;
    const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    if (step) {
      starts.length = 0;
      let n = 0;
      for (let t = st.date.getTime(); t <= Math.min(until.getTime(), to.getTime()) && n < count; t += 86400000) {
        const dt = new Date(t);
        const daysSince = Math.round((t - st.date.getTime()) / 86400000);
        let hit: boolean;
        if (step === 1) hit = daysSince % interval === 0;
        else {
          const week = Math.floor(daysSince / 7);
          const dow = DAYS[new Date(nyDate(dt) + "T12:00:00Z").getUTCDay()];
          hit = week % interval === 0 && (byday ? byday.includes(dow) : daysSince % 7 === 0);
        }
        if (hit) { starts.push(dt); n++; }
      }
    } else if (r.FREQ === "MONTHLY" || r.FREQ === "YEARLY") {
      // rare for school calendars: keep the first occurrence only
    }
  }
  if (ev.RDATE) for (const v of ev.RDATE.split(",")) { try { starts.push(icsDate(v.trim()).date); } catch (_) { /* ignore */ } }
  const ex = new Set((ev.EXDATE || "").split(",").filter(Boolean).map((v) => nyDate(icsDate(v.trim()).date)));
  for (const k of overridden) if (k.startsWith((ev.UID || "") + "|")) ex.add(k.split("|")[1]);
  return starts
    .filter((d) => d.getTime() + Math.max(dur, 0) >= from.getTime() && d <= to && !ex.has(nyDate(d)))
    .map((d) => ({ start: d, end: dur ? new Date(d.getTime() + dur) : null, allDay: st.allDay }));
}
async function syncCalendar() {
  const ics = await getText(ICS_URL);
  const evs = parseICS(ics);
  const from = new Date(Date.now() - 86400000 * 2), to = new Date(Date.now() + 86400000 * 400);
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  overridden = new Set(evs.filter((e) => e["RECURRENCE-ID"] && e.UID).map((e) => {
    try { const r = icsDate(e["RECURRENCE-ID"]); return `${e.UID}|${r.allDay ? r.date.toISOString().slice(0, 10) : nyDate(r.date)}`; } catch (_) { return ""; }
  }));
  for (const ev of evs) {
    if (!ev.DTSTART || (ev.STATUS || "").toUpperCase() === "CANCELLED") continue;
    try {
      for (const o of expand(ev, from, to)) {
        let time_label: string | null = null;
        let event_date = nyDate(o.start);
        if (o.allDay) {
          event_date = o.start.toISOString().slice(0, 10);
          if (o.end) {
            const last = new Date(o.end.getTime() - 86400000).toISOString().slice(0, 10);
            if (last > event_date) time_label = `Through ${new Date(last + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
          }
        } else {
          time_label = nyTime(o.start) + (o.end ? " – " + nyTime(o.end) : "");
        }
        const key = `${(icsText(ev.SUMMARY) || "").toLowerCase()}|${event_date}|${time_label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          source: "google", uid: ev.UID || null, title: icsText(ev.SUMMARY) || "School event",
          event_date, time_label, location: icsText(ev.LOCATION) || null,
          all_day: o.allDay, starts_at: o.start.toISOString(), ends_at: o.end ? o.end.toISOString() : null,
          description: icsDesc(ev.DESCRIPTION), grades: null, audience: "all",
        });
      }
    } catch (_) { /* skip malformed event */ }
  }
  const { error: dErr } = await admin.from("events").delete().eq("source", "google");
  if (dErr) throw dErr;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("events").insert(rows.slice(i, i + 500));
    if (error) throw error;
  }
  return { events: rows.length, vevents: evs.length };
}

// ---------- Announcements ----------
async function syncAnnouncements(debug: boolean) {
  const html = await getText(SITE + "/news-and-events/announcements.cfm");
  // Main content region: from the page heading to "Upcoming Events"
  let region = between(html, /<h1[^>]*>\s*Announcements/i, /Upcoming Events/i);
  if (!region) region = between(html, "content-start", /Upcoming Events/i);
  const items: { title: string; body: string; link: string | null }[] = [];
  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(region))) {
    const inner = m[1];
    if (/<li\b/i.test(inner)) continue;
    // Title: first heading/strong, else first line of text
    const tm = inner.match(/<(h[1-6]|strong|b)\b[^>]*>([\s\S]*?)<\/\1>/i);
    const text = clean(inner);
    if (!text || text.length < 3) continue;
    let title = tm ? clean(tm[2]) : "";
    const hrefs = [...inner.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((x) => x[1]).filter((h) => !/^(javascript:|#|mailto:)/i.test(h));
    const link = hrefs.length ? absUrl(hrefs[0]) : null;
    let body = text;
    if (!title) {
      const parts = inner.split(/<br\s*\/?>|<\/p>|<\/div>|\n/i).map(clean).filter(Boolean);
      title = parts[0] || text.slice(0, 80);
    }
    if (body.startsWith(title)) body = body.slice(title.length).trim();
    body = body.replace(/\bLink:\s*\S+/gi, "").replace(/\bhttps?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
    items.push({ title: title.slice(0, 160), body: body.slice(0, 800), link });
  }
  if (debug) return { count: items.length, items, regionSample: region.slice(0, 3000) };
  if (!items.length) throw new Error("No announcements found on csjax.org (page layout may have changed)");
  const { error: dErr } = await admin.from("announcements").delete().eq("source", "website");
  if (dErr) throw dErr;
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await admin.from("announcements").insert(items.map((it, i) => ({
    source: "website", title: it.title, body: it.body, link: it.link, audience: "all", pinned: false,
    publish_on: today, created_at: new Date(Date.now() - i * 1000).toISOString(),
  })));
  if (error) throw error;
  return { announcements: items.length };
}

// ---------- Field Trip Permission Slips (own page since Oct 2026) + Document Library ----------
// Field trip page: <h3 class="toolhead">Grade group</h3> then links like "Color Me Mine (11/06/2026)".
async function fetchFieldTrips() {
  const html = await getText(SITE + "/school-info/field-trip-permission-slips.cfm");
  const mainAt = html.search(/id=["']main_container["']/i);
  const footAt = html.search(/<footer\b/i);
  const body = html.slice(mainAt > 0 ? mainAt : 0, footAt > mainAt ? footAt : html.length);
  const trips: Record<string, unknown>[] = [];
  const groups: string[] = [];
  const re = /<h3[^>]*class=["'][^"']*toolhead[^"']*["'][^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*class=["'][^"']*toolhead|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const group = clean(m[1]);
    if (!group) continue;
    if (!groups.includes(group)) groups.push(group);
    for (const tk of tokens(m[2])) {
      if (tk.t !== "a" || !tk.v || /^(javascript:|#|mailto:|tel:)/i.test(tk.href)) continue;
      const date = parseUSDate(tk.v);
      // Title without the date, whether the date is written before "(11/06/2026) Trip" or after "Trip (11/06/2026)".
      const title = tk.v
        .replace(/\(\s*\d{1,2}\/\d{1,2}\/\d{4}\s*\)/, "")
        .replace(/^\d{1,2}\/\d{1,2}\/\d{4}\s*[-–—:]?\s*/, "")
        .replace(/\s*[-–—:]\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/, "")
        .replace(/\s+/g, " ").trim();
      trips.push({ grade_group: group, group_order: groups.indexOf(group), trip_date: date, title: title || tk.v, url: absUrl(tk.href), sort: trips.length });
    }
  }
  if (!groups.length) throw new Error("No grade groups found on Field Trip Permission Slips page (page layout may have changed)");
  return { trips, groups };
}

async function syncDocumentLibrary(debug: boolean) {
  const { trips, groups } = await fetchFieldTrips();
  const html = await getText(SITE + "/school-info/document-library.cfm");
  const docStart = html.search(/Document\s*Resources/i);
  const formStart = html.search(/School\s*Forms/i);
  const footer = html.search(/Footer Logo/i);

  // Documents and forms
  const docs: Record<string, unknown>[] = [];
  const grab = (start: number, end: number, category: string) => {
    if (start < 0) return;
    for (const tk of tokens(html.slice(start, end > start ? end : html.length))) {
      if (tk.t !== "a" || !tk.v || /^(javascript:|#|mailto:|tel:)/i.test(tk.href)) continue;
      if (/^(home|school info|document library)$/i.test(tk.v)) continue;
      docs.push({ category, title: tk.v, url: absUrl(tk.href), sort: docs.length });
    }
  };
  const docEnd = formStart > docStart ? formStart : footer;
  grab(docStart, docEnd, "Documents");
  grab(formStart, footer > formStart ? footer : html.length, "School Forms");

  if (debug) return { trips, docs, groups };
  // An empty list is valid now (no trips posted); the page itself was found above.
  await admin.from("field_trips").delete().gte("id", 0);
  if (trips.length) {
    const { error: e1 } = await admin.from("field_trips").insert(trips);
    if (e1) throw e1;
  }
  if (docs.length) {
    await admin.from("documents").delete().gte("id", 0);
    const { error: e2 } = await admin.from("documents").insert(docs);
    if (e2) throw e2;
  }
  return { field_trips: trips.length, documents: docs.length };
}

// ---------- entry ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  const { data: cfg } = await admin.rpc("get_private_config");
  const isCron = !!cfg?.cron_secret && req.headers.get("x-cron-secret") === cfg.cron_secret;

  // Manual runs must come from a signed-in admin.
  if (!isCron) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    const email = u?.user?.email?.toLowerCase();
    const { data: row } = email ? await admin.from("admins").select("email").eq("email", email).maybeSingle() : { data: null };
    if (!row) return json({ error: "Sign in as a school admin to refresh content." }, 401);
  }
  // pg_cron fires at 15:00, 16:00, 22:00 and 23:00 UTC; only the runs that land on 11 AM or 6 PM New York time do work.
  if (isCron && body.scheduled) {
    const p = nyParts(new Date());
    const due = (p.hour === "11" && p.dayPeriod === "AM") || (p.hour === "6" && p.dayPeriod === "PM");
    if (!due) return json({ skipped: "not 11 AM or 6 PM in New York" });
  }
  const debug = !!body.debug;
  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [name, fn] of [["calendar", () => syncCalendar()], ["announcements", () => syncAnnouncements(debug)], ["documentLibrary", () => syncDocumentLibrary(debug)]] as const) {
    if (debug && name === "calendar") { try { const ics = await getText(ICS_URL); results.calendar = { sample: parseICS(ics).filter((e) => /^2026101[56]|^20261019/.test(e.DTSTART || "") || /^2026101[56]/.test(e["RECURRENCE-ID"] || "")).map((e) => ({ s: e.SUMMARY, d: e.DTSTART, rid: e["RECURRENCE-ID"], rr: e.RRULE, uid: e.UID })) }; } catch (e) { errors.calendar = String(e); } continue; }
    try { results[name] = await fn(); } catch (e) { errors[name] = (e as Error).message || String(e); }
  }
  const ok = Object.keys(errors).length === 0;
  if (!debug) await admin.from("sync_runs").insert({ trigger: isCron ? "schedule" : "manual", ok, details: { results, errors } });
  return json({ ok, results, errors }, ok ? 200 : 207);
});
