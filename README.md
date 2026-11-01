# Komal 💬
A private WhatsApp-style messenger that runs on **your laptop**. Your friends install it on their phones like a normal app.

**Features:** phone-number accounts · profile photos · 1-to-1 chats · groups · send photos (camera or gallery, auto-compressed) ·
sent / delivered / read ticks · typing & online / last seen · unread badges · push notifications even when the app is closed ·
dark mode · installable app (PWA) · invite-only sign-up.

## 1. Start it (one-time setup)
1. Install **Node.js 22.13 or newer** (the LTS version) from https://nodejs.org
2. Double-click **start.bat** (Windows) or run **./start.sh** (Mac / Linux).
3. The window prints an **invite code** (also saved in `data/invite.code`). Friends need it to sign up.
4. Open http://localhost:3000 on your laptop and create your account.

## 2. Let friends use it (from anywhere)
Phones need an **https** link for notifications and "Install app". The easiest free way is a Cloudflare tunnel:

1. Install `cloudflared` (Windows: `winget install Cloudflare.cloudflared`; Mac: `brew install cloudflared`).
2. With Komal running, open a second terminal and run:
   `cloudflared tunnel --url http://localhost:3000`
3. It prints a link like `https://random-words.trycloudflare.com`. Send friends that link **plus the invite code**
   (or `https://…trycloudflare.com/?invite=CODE`, which pre-fills it).

> The quick-tunnel link changes every time you restart it, and friends' installed apps point at the old one.
> For a permanent link use a free **ngrok** static domain (`ngrok http --domain=yourname.ngrok-free.app 3000`)
> or a named Cloudflare tunnel on your own domain. Your laptop must be on and awake for Komal to work.

## 3. Friends install the app
- **Android (Chrome):** open the link → sign up → menu ⋮ → *Install Komal app* (or Add to Home screen). Allow notifications.
- **iPhone (Safari, iOS 16.4+):** open the link → Share → **Add to Home Screen** → open Komal from the home screen → sign up → allow notifications.
- **Computer:** open the link; Chrome/Edge show an install icon in the address bar.

## Using it
- Tap the chat icon, type a friend's phone number (they must have joined) and start chatting.
- Numbers: with country code (`+254712345678`) or local style (`0712345678`, assumed Kenya +254; change with `DEFAULT_CC`).
- Profile photo: pick the same picture you use on WhatsApp when signing up (changeable later in Profile).

## Security — what's in place, and honest limits
In place: bcrypt-hashed passwords · httpOnly SameSite=Strict session cookie · HTTPS via the tunnel · invite code for sign-up ·
login rate limiting · message flood control · photos validated by file signature, size-limited and only downloadable by chat members ·
strict Content-Security-Policy and security headers · same-origin checks on API and WebSocket · no browsing the user list
(lookup by exact phone number only) · random unguessable file names.

Limits: messages are encrypted in transit but **not end-to-end encrypted** — they are stored in `data/komal.db` on your laptop, so
you (the host) could read them. Keep that folder private and invite only people you trust. Phone numbers are **not verified by SMS**
(that needs a paid SMS provider), so the invite code is what keeps strangers out — don't post it publicly.
Back up `data/` to keep chats; deleting it resets everything. WhatsApp's photo/number can't be imported automatically — WhatsApp has no
public API for that — so friends choose their photo once at sign-up.

## Login activity, Supabase backup, and email alerts (optional)
Komal keeps SQLite on the host as its primary database and mirrors account, chat, subscription, and media data to a private Supabase project. The mirror stores only bcrypt password hashes, never plain-text passwords. Supabase tables and the Storage bucket are server-role-only.

1. In Supabase, open **SQL Editor** and run [`supabase-backup.sql`](./supabase-backup.sql) before starting Komal with Supabase configured.
2. Copy `.env.example` to `.env` beside `server.js`. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from your Supabase project's API settings.
   The service-role key is secret and must stay in this server-side `.env` file; never add it to `public/` or share it.
3. On startup, Komal copies the existing local database and images to Supabase. New database changes are backed up after a short delay, with a full retry at least every five minutes. The app continues to use local SQLite if Supabase is unavailable; check the server console for sync errors.
4. For email alerts without a custom domain or App Password, configure Gmail API OAuth in Google Cloud:
   - Create a Google Cloud project, enable the **Gmail API**, and configure the OAuth consent screen. Add your Gmail account as a test user if the app is in testing.
   - Create a **Web application** OAuth client ID and secret, with `https://developers.google.com/oauthplayground` as an authorized redirect URI. In the OAuth Playground settings, enable **Use your own OAuth credentials** and enter that client ID and secret. In the Playground, authorize `https://www.googleapis.com/auth/gmail.send`, exchange the authorization code, and copy the refresh token.
   - Put the sending Gmail address in `GMAIL_USER`, and the OAuth client ID, client secret, and refresh token in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`. Keep all of these values in `.env`; do not commit or share them.
   - Alerts go to `moseticollins20@gmail.com` by default; change `LOGIN_NOTIFY_EMAIL` only if you want a different recipient. The OAuth token only grants permission to send Gmail messages.
   - If the OAuth consent screen remains in **Testing**, Google may expire its refresh token after 7 days. For ongoing alerts, publish the consent app; Google may require verification for the Gmail send permission.
5. Restart Komal. Successful logins and new account registrations appear in Supabase's `login_events` table with the Komal account name, phone number, local account ID, event type, and UTC time; each also sends an email alert.

The Supabase data is a backup, not the live source of truth: chat reads and writes still use the host's local SQLite database. Supabase is not readable by anonymous or signed-in app users. If either integration is not configured or a provider is temporarily unavailable, Komal still allows sign-in and reports the integration failure in the server console.

## Settings (optional environment variables)
`PORT=3000` · `DEFAULT_CC=254` · `INVITE=mycode` (your own code) · `INVITE=off` (open sign-up — not recommended)

## Files
`server.js` API + realtime · `db.js` database · `public/` the app (UI, service worker, icons) · `data/` created on first run (database, photos, secrets).
