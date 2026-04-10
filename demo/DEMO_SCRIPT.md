# Demo Run-of-Show — FusionAuth × Discord Connector
# ~5 minutes | Internal Hack Day

---

## Before you present

The demo assumes FusionAuth is already running with an admin account set up — just like a real user adding Discord to an existing installation.

```bash
# 1. Start the stack (no -v — preserves the database)
cd demo
docker compose up -d

# 2. Wait ~30 seconds for FusionAuth to be healthy, then start the demo server
node catch.js
```

Confirm these are ready:
- [ ] `http://localhost:3000` loads with the Login with Discord button
- [ ] `http://localhost:9011/admin` loads and you can log in
- [ ] Settings → Identity Providers shows the Discord IdP
- [ ] Customizations → Lambdas shows "Discord OIDC Reconcile"
- [ ] A clean incognito window is ready for the live login — do NOT use a regular window, FusionAuth will see your existing admin session and skip the login flow entirely

> **Do not run `docker compose down -v`** — that wipes the database. Just `down` and `up` preserve everything.

---

## The script

### 0:00 — Hook (60 seconds)

> "This started with a completely non-work problem. I have a file server at home — just a NAS with movies, backups, stuff I share with my gaming friends. I wanted to put a login in front of it so I wasn't leaving it wide open."

> "My friends are on Discord. I'm on Discord. We have a server. It seemed completely obvious — just let them log in with Discord. How hard could it be?"

> "I'd heard good things about FusionAuth for this kind of thing, so I spun it up. And we actually have a documentation page for exactly this."

**[Pull up https://fusionauth.io/docs/lifecycle/authenticate-users/identity-providers/social/discord]**

> "So I follow the guide. I copy endpoint URLs by hand, figure out that Discord uses `id` instead of `sub` — because Discord doesn't fully implement the OIDC spec — that it uses `verified` instead of `email_verified`, that the token endpoint needs credentials in the POST body instead of Basic auth. None of that is obvious."

> "And after all that, I get it working. My friends can log in. But when I look at their user profiles in FusionAuth — no avatar. Generic display name. No hint that these are real people I've been gaming with for years. Because the generic OIDC setup only pulls email. Everything else Discord knows about your users stays on Discord's side."

> "So I spent hack day fixing that properly."

---

### 1:00 — The solution (60 seconds)

> "Here's the project. Three pieces."

**[Show the repo in your editor or terminal — `ls` the root]**

```
setup/setup.js               ← CLI that provisions the Discord IdP via API
lambda/discord-reconcile.js  ← maps Discord's non-standard fields into FusionAuth
demo/                        ← Docker Compose environment, this is what's running now
```

> "I already ran this before the demo so we have a live environment. But let me show you what the setup step actually does — because this is what makes it a project instead of a docs page."

**[Open `setup/setup.js` in your editor — scroll to the DISCORD constants at the top]**

> "This is what the script auto-configures: the three Discord endpoints, the claim overrides, `client_secret_post` auth, the scope. And it does one more thing — it reads the reconcile lambda from the lambda file and uploads it to FusionAuth automatically. No copy-pasting code into the admin UI."

> "To run it fresh, you'd do this:"

```bash
FA_URL=http://localhost:9011 \
FA_API_KEY=your-key \
DISCORD_CLIENT_ID=your-client-id \
DISCORD_CLIENT_SECRET=your-secret \
node setup.js
```

> "That's it. And if you don't want to pass everything as env vars, just run `node setup.js` on its own — it walks you through each prompt interactively. FusionAuth URL, API key, Discord credentials, one question at a time. Under two seconds once you answer. Lambda uploaded, IdP configured, Discord button live."

---

### 1:30 — Show the result in the admin UI (45 seconds)

**[Open FusionAuth admin → Settings → Identity Providers]**

> "There it is. Discord IdP, configured, with the Blurple button. Didn't touch the admin UI to get here."

**[Click the IdP → show the config briefly — endpoints, claim overrides, reconcile lambda assigned]**

> "You can see the reconcile lambda is already wired in. That's the interesting piece."

---

### 2:15 — Walk the reconcile lambda (45 seconds)

**[Open `lambda/discord-reconcile.js` in your editor]**

> "Discord returns an avatar as a hash — `ea76ad0a7b3753508dc63f614d336844` is meaningless on its own. You have to construct `https://cdn.discordapp.com/avatars/{user_id}/{hash}.png`. Animated avatars start with `a_` so they get `.gif` instead."

> "Discord's display name system has two layers — a unique username handle and a separate global display name. The lambda prefers the display name and falls back to the username."

> "One thing that took some debugging: FusionAuth passes Discord's userinfo claims through the `idToken` parameter in the lambda, not `userInfo` — because Discord doesn't issue a real JWT id_token. That's the kind of thing that isn't documented anywhere. Found it by dumping the lambda args at runtime."

> "Everything Discord-specific goes into `user.data.discord` — ID, username, locale, accent color, all of it — without polluting the core user object."

> "One thing that's not included yet: guild membership. That's the list of Discord servers a user belongs to. It's the most powerful thing you could do with this — gate access based on whether someone is actually in your server. The problem is Discord doesn't return that in the same call. It's a separate endpoint that requires its own request, which means you'd need a small proxy sitting between FusionAuth and Discord to fetch it and inject it before the lambda runs. The setup script has the scope toggle ready to go. The proxy is the missing piece — and that's what's next."

---

### 3:00 — Live login (75 seconds)

> "Okay, let's actually log in."

**[Open the incognito window. Navigate to:]**

```
http://localhost:3000
```

> "This is a minimal demo page that links straight to the FusionAuth OAuth flow with an `idp_hint` — so it skips FusionAuth's own login screen and goes straight to Discord."

**[Click "Login with Discord"]**

> "Discord's OAuth consent screen."

**[Authorize the app]**

> "Back. Now let me show you what FusionAuth has."

**[Switch to FusionAuth admin → Users → find the user that just logged in]**

> "There's the user. Avatar is set, full name pulled from the Discord display name, preferred language set from locale. These aren't anonymous email addresses."

**[Click the user → User data tab]**

> "And here's `user.data.discord`. Snowflake ID, username, globalName, locale, accent color — all of it sitting in FusionAuth, accessible from the Registration API or a JWT claim. My file server can greet people by their Discord name, show their avatar, even check server membership before granting access — without any of that logic living in my app code."

---

### 4:15 — Wrap (45 seconds)

> "So here's where I landed. I wanted my gaming friends to log into my file server with Discord. That's it. And it took way more work than it should have."

> "What I built today is what should have existed when I started. A setup script that handles all five of Discord's OIDC quirks automatically. A reconcile lambda that brings your users' actual identities into FusionAuth. And a Kickstart block so the next person running FusionAuth in Docker can have Discord login working before their first deploy."

> "The README documents every place Discord deviates from the OIDC spec — because I had to discover all of them the hard way, and nobody else should have to."

> "It's all in the repo. Questions?"

---

## Fallback if the live login breaks

1. Stay calm — pivot to the admin UI showing the configured IdP
2. Walk through the reconcile lambda code in the editor
3. Show the User Data tab of a previously-logged-in user (should be there from earlier test runs)
4. "The live flow is working — I'll drop the repo link in Slack so you can try it"

---

## Timings

| Segment | Time |
|---|---|
| Hook + docs problem | 0:00 – 1:00 |
| Repo tour + setup script | 1:00 – 1:30 |
| IdP in admin UI | 1:30 – 2:15 |
| Reconcile lambda walkthrough | 2:15 – 3:00 |
| Live Discord login + user data | 3:00 – 4:15 |
| Wrap + questions | 4:15 – 5:00 |
