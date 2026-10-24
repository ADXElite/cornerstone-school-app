# Cornerstone School App

Installable web app (PWA) for Cornerstone Christian School families and staff. Separate from all AdrenalineX projects.

- **App:** https://app.csjax.org (Vercel project `cornerstone-school-app`)
- **Admin:** https://app.csjax.org/admin — send push notifications, post announcements, refresh website content
- **Database:** Supabase project `cornerstone-school-app` (ref `cvvdwhgdiqnoqgxtgzfw`)

## How content gets into the app
| Content | Source | When |
|---|---|---|
| Calendar | Google Calendar `ccsjax.org_2pbo7t17fq764q7u13u9jvce8c@group.calendar.google.com` | Daily 11:00 AM & 6:00 PM ET + "Update now" |
| Announcements | csjax.org/news-and-events/announcements.cfm (+ admin posts) | Daily 11:00 AM & 6:00 PM ET |
| Field trip permission slips | csjax.org School Info → Field Trip Permission Slips (/school-info/field-trip-permission-slips.cfm) | Daily 11:00 AM & 6:00 PM ET |
| Documents & school forms | csjax.org Document Library | Daily 11:00 AM & 6:00 PM ET |
| Push notifications | Sent from /admin | On demand |

The daily job is a Supabase `pg_cron` task (`csjax-daily-sync`) that calls the `sync-website` Edge Function at 15:00, 16:00, 22:00 and 23:00 UTC; the function only runs the update at 11 AM and 6 PM New York time, so it follows daylight saving.

## Files
- `index.html` — the app (Home, Calendar, Field Trips, Info, Links, Contact)
- `admin.html` — admin sign-in and tools
- `sw.js` — offline support and push notification display
- `manifest.webmanifest`, `icons/` — install name and icons
- `supabase/functions/sync-website` — website + calendar sync
- `supabase/functions/send-push` — sends Web Push to every subscribed device

## Landscape and iPhone Duo
- The installed app can rotate (`orientation: any` in the manifest).
- On touch screens held sideways (iPhone Duo open or closed, iPhones in landscape, iPad mini), the bottom tab bar becomes a side rail on the left, the header shrinks, and each screen splits into two columns (e.g. Field Trips: grade picker left, trips right). Event details open as a centered card.
- When iPhone Duo is partially folded like a book, Safari's Viewport Segments support (preview in Safari 27.1, behind a feature flag) lines the two columns up with the two halves so nothing sits on the fold. Without it, the normal landscape layout is used.
- Portrait phones and desktop browsers are unchanged.

## Push notifications
- iPhone/iPad: works on iOS 16.4+ after the app is added to the Home Screen and opened from there.
- Android/desktop Chrome, Edge, Firefox: works in the browser or installed app.
- VAPID keys live in the private `private.config` table (not exposed through the API).

## Adding another admin
1. Supabase → Authentication → Users → **Add user** (email + password, *Auto Confirm User*).
2. SQL editor: `insert into public.admins (email) values ('name@csjax.org');`

Pushing to `main` deploys automatically once the repo is connected in Vercel → Settings → Git.

## Dismissal boards (classroom smartboards)
- **Boards:** `https://app.csjax.org/dismissal/<teacher-name>` (e.g. `/dismissal/raja-backmon`); list of all boards at `/dismissal`.
- **Combined boards:** `/dismissal/williams-newkirk` shows Jarrodd Williams' and Alexandria Newkirk's classes together (each student tagged with their teacher). Add more in the `COMBINED` list at the top of `api/dismissal.js`; teachers in a combined board are hidden from the class lists. Name overrides (e.g. Nichelle English-Wilson → **Nichelle Wilson**, link `/dismissal/nichelle-wilson`) live in `RENAME` in the same file.
- **Campus only:** `/api/dismissal` answers only requests from the IPs in the Vercel env var `DISMISSAL_ALLOWED_IPS` (currently `107.1.157.26`). Everyone else sees "Campus network only".
- **Data:** table `public.dismissal_boards` (no public access). The Chrome extension writes through `ingest_dismissal(key, boards)`; the API reads through `read_dismissal(key, slug)` using `DISMISSAL_READ_KEY`. Both keys live in `private.config`.
- **Source:** `chrome-extension/` — pulls every teacher page from KidAccount (teacherlist.php → teacherspage.php) at 2:20 PM on weekdays in the background of a signed-in Chrome, then uploads. Boards refresh themselves every minute and fit the screen.
- The upload key is entered in the extension's Settings (not stored in this repo).

### Classroom Chromebook kiosk (`/kiosk`)
- **URL:** `https://app.csjax.org/kiosk` — full-screen app. On first launch the teacher taps their class; the choice is saved on that device and the board opens automatically after every restart.
- **Change class:** tap the faint **Change class** button in the bottom-right corner of the board.
- **Preset a device (optional):** `https://app.csjax.org/kiosk?board=<teacher-slug>` skips the picker.
- **Push with Google Admin:** Admin console → Devices → Chrome → Apps & extensions → **Kiosks** → pick the classroom OU → **+** → **Add by URL** → `https://app.csjax.org/kiosk`. Then set it as the auto-launch kiosk app for that OU (Kiosks → Auto-launch app). The Dismissal Sync extension is *not* needed on these devices.
- Campus-only rules still apply: off the school network the kiosk shows "Campus network only".

### Show the board only 2:30–3:30 PM (no kiosk lock)
`kiosk-launcher/` is a small extension for the classroom Chromebooks/Chromeboxes. On school days it opens `https://app.csjax.org/kiosk` full-screen at **2:30 PM** and closes it at **3:30 PM**, so the device is free for teaching the rest of the day. KidAccount is pulled at 2:20 PM by the Dismissal Sync extension, so the board is ready when it opens.
- If the device starts or wakes during the window, the board opens then. Teachers can tap **Close board** (bottom-right of the board) to close it; it then stays closed until the next school day.
- **Deploy:** zip the `kiosk-launcher` folder → Chrome Web Store Developer Dashboard → upload as a **Private** (domain-only) item → Admin console → Devices → Chrome → Apps & extensions → **Users & browsers** → classroom OU → **+** → Add from Chrome Web Store (or by ID) → **Force install**. Use this *instead of* the kiosk auto-launch setup above.
- **Optional policy** (same screen → *Policy for extensions*), JSON:
  `{"board": {"Value": "raja-backmon"}, "start": {"Value": "14:30"}, "end": {"Value": "15:30"}, "weekdaysOnly": {"Value": true}}`
  Leave `board` out to let the teacher pick the class on screen (saved on that device).

