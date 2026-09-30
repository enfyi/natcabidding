# Self-hosting `natcazla.com/bidding`

This app can be built as a small standalone Next.js server and placed behind the
main `natcazla.com` web server at `/bidding`.

## Build the upload bundle

Create a production `.env.local` first:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
NEXT_PUBLIC_SITE_URL=https://natcazla.com
NEXT_PUBLIC_BASE_PATH=/bidding
NEXT_PUBLIC_APP_ENVIRONMENT=production
GMAIL_USER=your-account@gmail.com
GMAIL_APP_PASSWORD=your-16-character-google-app-password
BID_NOTIFICATION_FROM_NAME="ZLA Bidding"
BID_REMINDER_CRON_SECRET=use-a-random-secret-with-at-least-32-characters
```

Then run:

```bash
pnpm install --frozen-lockfile
pnpm package:self-host
```

Upload `outputs/zla-bidding-self-host.tgz` to the server and unpack it into the
folder you want to run the bidding app from, for example `/var/www/zla-bidding`.

## Start the app

Run the standalone server with the production environment loaded:

```bash
cd /var/www/zla-bidding
HOSTNAME=127.0.0.1 PORT=3001 node server.js
```

Use a process manager such as `systemd`, `pm2`, or your host's Node app manager
to keep that command running after reboot.

## Reverse proxy

Point `/bidding` and everything below it to the local Next.js server. Example
nginx location:

```nginx
location /bidding/ {
  proxy_pass http://127.0.0.1:3001/bidding/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_buffering off;
}

location = /bidding {
  return 308 /bidding/;
}
```

## Supabase settings

In Supabase Authentication URL Configuration, set or add:

- Site URL: `https://natcazla.com/bidding`
- Redirect URL: `https://natcazla.com/bidding/auth/callback`
- Password recovery redirect URL: `https://natcazla.com/bidding/auth/callback?next=/update-password`
- Development redirect URL: `http://localhost:3000/auth/callback`
- Development password recovery redirect URL: `http://localhost:3000/auth/callback?next=/update-password`

If Supabase Cron sends bid-window reminders, update the Vault value for
`bid_reminder_endpoint` to:

```text
https://natcazla.com/bidding/api/cron/bid-window-reminders
```
