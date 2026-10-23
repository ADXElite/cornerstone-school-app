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
- **Campus only:** `/api/dismissal` answers only requests from the IPs in the Vercel env var `DISMISSAL_ALLOWED_IPS` (currently `107.1.157.26`). Everyone else sees "Campus network only".
- **Data:** table `public.dismissal_boards` (no public access). The Chrome extension writes through `ingest_dismissal(key, boards)`; the API reads through `read_dismissal(key, slug)` using `DISMISSAL_READ_KEY`. Both keys live in `private.config`.
- **Source:** `chrome-extension/` — pulls every teacher page from KidAccount (teacherlist.php → teacherspage.php) at 2:15 PM on weekdays in the background of a signed-in Chrome, then uploads. Boards refresh themselves every minute and fit the screen.
- The upload key is entered in the extension's Settings (not stored in this repo).

### Classroom Chromebook kiosk (`/kiosk`)
- **URL:** `https://app.csjax.org/kiosk` — full-screen app. On first launch the teacher taps their class; the choice is saved on that device and the board opens automatically after every restart.
- **Change class:** tap the faint **Change class** button in the bottom-right corner of the board.
- **Preset a device (optional):** `https://app.csjax.org/kiosk?board=<teacher-slug>` skips the picker.
- **Push with Google Admin:** Admin console → Devices → Chrome → Apps & extensions → **Kiosks** → pick the classroom OU → **+** → **Add by URL** → `https://app.csjax.org/kiosk`. Then set it as the auto-launch kiosk app for that OU (Kiosks → Auto-launch app). The Dismissal Sync extension is *not* needed on these devices.
- Campus-only rules still apply: off the school network the kiosk shows "Campus network only".

