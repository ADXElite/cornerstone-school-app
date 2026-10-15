# Cornerstone School App

Installable web app (PWA) for Cornerstone Christian School parents and staff.
Separate from all AdrenalineX projects.

- **Live site:** https://app.csjax.org (Vercel project `cornerstone-school-app`)
- **Database:** Supabase project `cornerstone-school-app` (ref `cvvdwhgdiqnoqgxtgzfw`)
- **Admin page:** https://app.csjax.org/admin — post announcements and calendar events

## Files
| File | Purpose |
|---|---|
| `index.html` | The app (Home, Calendar, Info, Links, Contact; Parent/Staff switch) |
| `admin.html` | Staff sign-in and posting screen |
| `manifest.webmanifest`, `icons/` | Home-screen install name and icons |
| `sw.js` | Offline support |
| `vercel.json` | Hosting headers |

## Data (Supabase)
- `announcements` — title, body, link, audience (all/parent/staff), pinned, publish_on, expires_on
- `events` — title, event_date, time_label, grades, audience
- `admins` — emails allowed to post

Anyone can read published announcements and events. Only signed-in users whose email is in `admins` can add, edit or remove them (enforced by row-level security).

## Adding a staff poster
1. Supabase → Authentication → Users → **Add user** → Create new user (email + password, tick *Auto Confirm User*).
2. SQL editor: `insert into public.admins (email) values ('name@csjax.org');`

Pushing to `main` deploys automatically.
