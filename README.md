# Cornerstone School App

Installable web app (PWA) for Cornerstone Christian School families and staff. Separate from all AdrenalineX projects.

- **App:** https://app.csjax.org (Vercel project `cornerstone-school-app`)
- **Admin:** https://app.csjax.org/admin — send push notifications, post announcements, refresh website content
- **Database:** Supabase project `cornerstone-school-app` (ref `cvvdwhgdiqnoqgxtgzfw`)

## How content gets into the app
| Content | Source | When |
|---|---|---|
| Calendar | Google Calendar `ccsjax.org_2pbo7t17fq764q7u13u9jvce8c@group.calendar.google.com` | Daily 5:00 PM ET + "Update now" |
| Announcements | csjax.org/news-and-events/announcements.cfm (+ admin posts) | Daily 5:00 PM ET |
| Field trip permission slips | csjax.org Document Library → Field Trips Permission Slips | Daily 5:00 PM ET |
| Documents & school forms | csjax.org Document Library | Daily 5:00 PM ET |
| Push notifications | Sent from /admin | On demand |

The daily job is a Supabase `pg_cron` task (`csjax-daily-sync`) that calls the `sync-website` Edge Function at 21:00 and 22:00 UTC; the function only runs the update at 5 PM New York time, so it follows daylight saving.

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
