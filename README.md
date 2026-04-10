# FusionAuth × Discord — Turnkey IdP Connector

A hack-day project that makes Discord login a first-class citizen in FusionAuth. While FusionAuth's docs show how to wire up Discord manually through the admin UI, this repo automates everything and adds the enriched user experience the generic OIDC approach lacks.

## What's in the box

| File | What it does |
|---|---|
| `setup/setup.js` | CLI tool — provisions the lambda and Discord IdP in FusionAuth via API in ~30 seconds |
| `lambda/discord-reconcile.js` | Reconcile lambda — maps Discord's non-standard fields into FusionAuth user objects |
| `kickstart/kickstart-discord-idp.json` | Drop-in Kickstart block for Docker-based FusionAuth deployments |
| `demo/` | Docker Compose environment for local testing |

---

## Why this exists

FusionAuth's generic OIDC provider works with Discord, but there are several Discord-specific quirks that the bare-bones config doesn't handle:

- Discord uses `id` instead of the OIDC-standard `sub` as the unique identifier
- Discord uses `verified` instead of `email_verified`
- Discord requires `client_secret_post` authentication on the token endpoint (not Basic auth)
- Discord returns an avatar **hash**, not a URL — you have to construct `https://cdn.discordapp.com/avatars/{id}/{hash}.png`
- Animated avatars start with `a_` and should use `.gif`
- Default avatars are indexed by discriminator (legacy) or snowflake ID (new username system)
- Discord's display name system has two layers: `username` (unique handle) and `global_name` (display name)
- Discriminators (`#1337`) are being phased out — new accounts use `discriminator: "0"`

This repo handles all of it.

---

## Quick start

### Prerequisites

- Node.js 18+
- A FusionAuth instance with an API key that has Identity Provider and Lambda write permissions
- A Discord application from the [Discord Developer Portal](https://discord.com/developers/applications)

### 1. Create a Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. In **OAuth2 → General**, note your **Client ID** and **Client Secret**.
3. Add a redirect URI — you'll get the exact URL after running the setup script. The format is:
   ```
   https://your-fusionauth.com/oauth2/callback/{idp-id}
   ```
   **Tip:** Pass `FA_IDP_ID` as a pre-chosen UUID when running setup. The script will print the redirect URI *before* making any API calls so you can add it to Discord in advance — then login works the moment the script finishes.

### 2. Run the setup script

```bash
cd setup
npm install
node setup.js
```

The script will prompt you for:
- Your FusionAuth base URL (e.g. `https://auth.example.com`)
- A FusionAuth API key
- Your Discord Client ID
- Your Discord Client Secret
- (Optional) A specific FusionAuth Application ID to enable Discord for
- (Optional) Whether to enable the `guilds` scope

You can also pass everything via environment variables to skip the prompts:

```bash
FA_URL=https://auth.example.com \
FA_API_KEY=your-api-key \
DISCORD_CLIENT_ID=123456789 \
DISCORD_CLIENT_SECRET=your-secret \
FA_IDP_ID=your-pre-chosen-uuid \
node setup.js
```

The script provisions both the reconcile lambda and the Discord IdP in one shot. Re-running it is safe — it updates the lambda in place and prints the redirect URI again.

### 3. Update your Discord redirect URI

After the setup script completes, it will print the exact redirect URI to add in your Discord Developer Portal:

```
https://your-fusionauth.com/oauth2/callback/{idp-id}
```

That's it. Login with Discord is live.

---

## What the reconcile lambda maps

After the lambda runs, the FusionAuth user object will contain:

| FusionAuth field | Source | Notes |
|---|---|---|
| `user.imageUrl` | Constructed from `id` + `avatar` hash | Handles animated avatars (`.gif`) and default avatars |
| `user.fullName` | `global_name` or `username` | Prefers new display name system |
| `user.username` | `username` | Raw Discord username (no discriminator) |
| `user.verified` | `verified` | Email verification status |
| `user.preferredLanguages` | `locale` | Discord locale string |

Everything else goes into `user.data.discord`:

```json
{
  "discord": {
    "id": "80351110224678912",
    "username": "nelly",
    "discriminator": "0",
    "globalName": "Nelly",
    "locale": "en-US",
    "mfaEnabled": false,
    "premiumType": 0,
    "flags": 0,
    "banner": "https://cdn.discordapp.com/banners/80351110224678912/abc123.png?size=600",
    "accentColor": "#ff6b35"
  }
}
```

---

## Local demo

The `demo/` directory has a Docker Compose setup for testing end-to-end locally.

```bash
cd demo
cp .env.example .env
# Fill in DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and FA_API_KEY in .env
docker compose up -d
```

FusionAuth will be available at `http://localhost:9011`. Once it's up, run the setup script from the repo root:

```bash
cd ../setup
FA_URL=http://localhost:9011 node setup.js
```

A minimal callback catcher is included at `demo/catch.js` — run it on port 3000 to handle the OAuth redirect during testing:

```bash
node demo/catch.js
```

Set your Discord redirect URI to `http://localhost:3000` and your FusionAuth application's redirect URL to `http://localhost:3000` as well.

---

## Kickstart usage (Docker)

If you're running FusionAuth in Docker and already use Kickstart to manage your config, `kickstart/kickstart-discord-idp.json` is a drop-in snippet. Merge its `apiRequests` array into your existing Kickstart file — it creates the reconcile lambda and Discord IdP in two API calls.

This is an **add-on**, not a standalone bootstrap. It assumes FusionAuth is already initialized with an admin user. Set these environment variables before running:

| Variable | Description |
|---|---|
| `DISCORD_CLIENT_ID` | Your Discord application's Client ID |
| `DISCORD_CLIENT_SECRET` | Your Discord application's Client Secret |

The lambda and IdP are created in order. If you need a deterministic lambda UUID (so you can reference it before it's created), pre-define it in your Kickstart `variables` block and substitute it into the `lambdaConfiguration.reconcileId` field.

---

## Optional: guild membership scope

If you need to check which Discord servers a user belongs to (e.g. to gate access based on server membership), enable the `guilds` scope during setup. The reconcile lambda will store guild data in `user.data.discord.guilds` if the data is present.

> **Note:** Guild membership requires a separate call to `/users/@me/guilds` and is not returned as part of the standard userinfo response. A proxy layer that injects guild data into the token is a planned stretch goal.

---

## Linking strategy

The setup script configures `CreatePendingLink` as the default linking strategy. This means:

- New users get a FusionAuth account created automatically
- If a FusionAuth account already exists with the same email, the user is prompted to link the accounts rather than silently merging or creating a duplicate

You can change this in the admin UI after setup if your use case requires it.

---

## Discord's OIDC non-compliance

Discord's OAuth2 implementation deviates from the OIDC specification in several ways. Here's what this project works around:

1. **`sub` claim is missing** — Discord uses `id` (a snowflake) as the unique user identifier. Handled via the `uniqueIdClaim` override.
2. **`email_verified` → `verified`** — Handled via the `emailVerifiedClaim` override.
3. **No real `id_token`** — Discord's token endpoint returns a bearer token, not a signed JWT. FusionAuth calls the userinfo endpoint (`/users/@me`) to get claims, then passes that response to the reconcile lambda as the `idToken` parameter (not `userInfo`). The lambda reads all Discord fields from `idToken` for this reason.
4. **`client_secret_post` required** — Discord rejects HTTP Basic auth on the token endpoint; credentials must be in the POST body.
5. **No `.well-known/openid-configuration`** — Discord doesn't publish a discovery document, so all endpoints are configured manually.

---

## License

Apache 2.0 — use it, fork it, ship it.

## Contributing

PRs welcome, especially for:
- The guild membership proxy (stretch goal)
- Support for the `connections` scope (linked accounts: Spotify, Steam, etc.)
