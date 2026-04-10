# Discord Developer Portal Setup

Do this BEFORE the demo. Takes about 3 minutes.

## Step 0 — Generate your IdP UUID

Pick a UUID now and put it in `demo/.env` as `FA_IDP_ID`. This lets you configure the Discord redirect URI before running the setup script, so the script finishes with zero remaining steps.

```bash
node -e "import('crypto').then(c => console.log(c.randomUUID()))"
```

Copy that value into `demo/.env`:
```
FA_IDP_ID=<paste-uuid-here>
```

## Step 1 — Create the application

1. Go to https://discord.com/developers/applications
2. Click **New Application**
3. Name it `FusionAuth Demo` (or anything — it's what users see on the OAuth consent screen)
4. Click **Create**

## Step 2 — Get your credentials

1. In the left sidebar, click **OAuth2**
2. Under **Client Information**, copy:
   - **Client ID** → paste into `demo/.env` as `DISCORD_CLIENT_ID`
   - **Client Secret** (click "Reset Secret" if needed) → paste into `demo/.env` as `DISCORD_CLIENT_SECRET`

## Step 3 — Add the redirect URI

If you completed Step 0, you already know the exact URI — construct it now and add it:

```
http://localhost:9011/oauth2/callback/<your-FA_IDP_ID>
```

1. Still in **OAuth2 → General**, scroll to **Redirects**
2. Click **Add Redirect**
3. Paste the full URI above (with your UUID)
4. Click **Save Changes**

> If you skipped Step 0 and don't have a UUID yet, add `http://localhost:9011/oauth2/callback` as a placeholder now and update it with the real URI after the setup script runs.

## Step 4 — Check OAuth2 settings

Still in **OAuth2 → General**:
- **Default Authorization Link** — leave as-is
- **Scopes** — no changes needed here (the setup script handles scope config in FusionAuth)

## That's it

Once `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are in your `.env`, you're ready to start the stack.

---

## After running the setup script

**If you set `FA_IDP_ID`:** nothing to do. The redirect URI was already configured in Discord, and the script used `PUT /api/identity-provider/{id}` to create the IdP with that exact UUID. Login is live the moment the script finishes.

**If you skipped Step 0:** the script prints the generated URI at the end. Go back to Discord Developer Portal → OAuth2 → Redirects, replace the placeholder with that URI, and save.
