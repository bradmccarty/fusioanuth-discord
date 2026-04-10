#!/usr/bin/env node

/**
 * FusionAuth Discord IdP Setup Script
 *
 * Fully automated: creates the reconcile lambda, then provisions Discord as
 * an OpenID Connect identity provider — lambda already wired in, login ready
 * the moment the script finishes.
 *
 * Usage:
 *   node setup.js
 *   -- or, with env vars to skip prompts --
 *   FA_URL=https://your-fusionauth.com FA_API_KEY=your-key \
 *   DISCORD_CLIENT_ID=123 DISCORD_CLIENT_SECRET=abc node setup.js
 */

import prompts from 'prompts';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Discord OIDC constants ────────────────────────────────────────────────

const DISCORD = {
  authorizationEndpoint: 'https://discord.com/api/oauth2/authorize',
  tokenEndpoint:         'https://discord.com/api/oauth2/token',
  userinfoEndpoint:      'https://discord.com/api/users/@me',
  uniqueIdClaim:         'id',       // Discord uses 'id', not OIDC-standard 'sub'
  emailVerifiedClaim:    'verified', // Discord uses 'verified', not 'email_verified'
  scopes:                'identify email',
  clientAuthMethod:      'client_secret_post', // Discord rejects HTTP Basic on token endpoint
  buttonColor:           '#5865F2',
  buttonText:            'Login with Discord',
  // Inline SVG data URI of the Discord Clyde logo (white, no external dependency)
  buttonLogoUrl:         'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjcuMTQgOTYuMzYiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik0xMDcuNyw4LjA3QTEwNS4xNSwxMDUuMTUsMCwwLDAsODEuNDcsMGE3Mi4wNiw3Mi4wNiwwLDAsMC0zLjM2LDYuODNBOTcuNjgsOTcuNjgsMCwwLDAsNDksNi44Myw3Mi4zNyw3Mi4zNywwLDAsMCw0NS42NCwwLDEwNS44OSwxMDUuODksMCwwLDAsMTkuMzksOC4wOUMyLjc5LDMyLjY1LTEuNzEsNTYuNi41NCw4MC4yMWgwQTEwNS43MywxMDUuNzMsMCwwLDAsMzIuNzEsOTYuMzYsNzcuNyw3Ny43LDAsMCwwLDM5LjYsODUuMjVhNjguNDIsNjguNDIsMCwwLDEtMTAuODUtNS4xOGMuOTEtLjY2LDEuOC0xLjM0LDIuNjYtMmE3NS41Nyw3NS41NywwLDAsMCw2NC4zMiwwYy44Ny43MSwxLjc2LDEuMzksMi42NiwyYTY4LjY4LDY4LjY4LDAsMCwxLTEwLjg3LDUuMTksNzcsNzcsMCwwLDAsNi44OSwxMS4xQTEwNS4yNSwxMDUuMjUsMCwwLDAsMTI2LjYsODAuMjJoMEMxMjkuMjQsNTIuODQsMTIyLjA5LDI5LjExLDEwNy43LDguMDdaTTQyLjQ1LDY1LjY5QzM2LjE4LDY1LjY5LDMxLDYwLDMxLDUzczUtMTIuNzQsMTEuNDMtMTIuNzRTNTQsNDYsNTMuODksNTMsNDguODQsNjUuNjksNDIuNDUsNjUuNjlabTQyLjI0LDBDNzguNDEsNjUuNjksNzMuMjUsNjAsNzMuMjUsNTNzNS0xMi43NCwxMS40NC0xMi43NFM5Ni4yMyw0Niw5Ni4xMiw1Myw5MS4wOCw2NS42OSw4NC42OSw2NS42OVoiLz48L3N2Zz4=',
};

const LAMBDA_NAME = 'Discord OIDC Reconcile';
const LAMBDA_TYPE = 'OpenIDReconcile';

// ─── Helpers ───────────────────────────────────────────────────────────────

function abort(msg) {
  console.error(`\n✖  ${msg}`);
  process.exit(1);
}

async function faRequest(baseUrl, apiKey, method, path, body) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': apiKey,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    abort(`FusionAuth API error ${res.status} at ${method} ${path}:\n${text}`);
  }

  return res.status === 204 ? null : res.json();
}

// ─── Lambda management ─────────────────────────────────────────────────────

/**
 * Finds an existing lambda by name and type, or returns null.
 * GET /api/lambda?type=OpenIDConnectReconcile returns all lambdas of that type.
 */
async function findExistingLambda(faUrl, apiKey) {
  const result = await faRequest(faUrl, apiKey, 'GET', '/api/lambda', null);
  const lambdas = result?.lambdas ?? [];
  return lambdas.find(l => l.name === LAMBDA_NAME) ?? null;
}

/**
 * Reads the reconcile lambda source from ../lambda/discord-reconcile.js,
 * then either creates it (POST) or updates it (PUT) in FusionAuth.
 * Returns the lambda ID.
 */
async function provisionLambda(faUrl, apiKey) {
  const lambdaPath = join(__dirname, '..', 'lambda', 'discord-reconcile.js');
  let lambdaBody;
  try {
    lambdaBody = readFileSync(lambdaPath, 'utf8');
  } catch {
    abort(
      `Could not read lambda source at ${lambdaPath}\n` +
      `Make sure discord-reconcile.js is in the lambda/ directory next to setup/.`
    );
  }

  const existing = await findExistingLambda(faUrl, apiKey);

  const payload = {
    lambda: {
      name:       LAMBDA_NAME,
      type:       LAMBDA_TYPE,
      body:       lambdaBody,
      engineType: 'GraalJS',
      enabled:    true,
      debug:      false,
    },
  };

  if (existing) {
    console.log(`⟳  Lambda "${LAMBDA_NAME}" already exists — updating…`);
    const result = await faRequest(faUrl, apiKey, 'PUT', `/api/lambda/${existing.id}`, payload);
    return result.lambda.id;
  } else {
    console.log(`⏳  Creating reconcile lambda…`);
    const result = await faRequest(faUrl, apiKey, 'POST', '/api/lambda', payload);
    return result.lambda.id;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔧  FusionAuth × Discord — IdP Setup\n');

  // Collect config from env or interactive prompts
  const env = {
    faUrl:               process.env.FA_URL,
    faApiKey:            process.env.FA_API_KEY,
    discordClientId:     process.env.DISCORD_CLIENT_ID,
    discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
    idpId:               process.env.FA_IDP_ID,  // optional pre-defined UUID
  };

  const questions = [];

  if (!env.faUrl) {
    questions.push({
      type: 'text',
      name: 'faUrl',
      message: 'FusionAuth base URL\n  (the root URL you use to access FusionAuth, e.g. https://auth.example.com):',
      validate: v => {
        if (!v.startsWith('http')) return 'Must be a valid URL';
        if (v.startsWith('http://') && !v.startsWith('http://localhost') && !v.startsWith('http://127.0.0.1')) {
          return 'Use HTTPS for non-localhost URLs — credentials are transmitted to this host';
        }
        return true;
      },
    });
  }

  if (!env.faApiKey) {
    questions.push({
      type: 'password',
      name: 'faApiKey',
      message: 'FusionAuth API key\n  (admin UI → Settings → API Keys → Add → enable Identity Providers + Lambdas):',
      validate: v => v.length > 0 || 'Required',
    });
  }

  if (!env.discordClientId) {
    questions.push({
      type: 'text',
      name: 'discordClientId',
      message: 'Discord Client ID\n  (Discord Developer Portal → your app → OAuth2 → Client ID):',
      validate: v => /^\d+$/.test(v) || 'Discord client IDs are numeric',
    });
  }

  if (!env.discordClientSecret) {
    questions.push({
      type: 'password',
      name: 'discordClientSecret',
      message: 'Discord Client Secret\n  (Discord Developer Portal → your app → OAuth2 → Client Secret → Reset Secret):',
      validate: v => v.length > 0 || 'Required',
    });
  }

  questions.push({
    type: 'text',
    name: 'applicationId',
    message: 'FusionAuth Application ID (optional)\n  (admin UI → Applications → your app → ID column — leave blank to enable tenant-wide):',
  });

  questions.push({
    type: 'confirm',
    name: 'enableGuilds',
    message: 'Enable guild membership scope? (see README for proxy requirement)',
    initial: false,
  });

  // Only prompt for IdP ID if not provided via env
  if (!env.idpId) {
    questions.push({
      type: 'text',
      name: 'idpId',
      message: '(Optional) Pre-defined UUID for the Discord IdP (blank = let FusionAuth generate one):',
      validate: v => !v || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
        || 'Must be a valid UUID (or leave blank)',
    });
  }

  const answers = await prompts(questions, {
    onCancel: () => abort('Setup cancelled.'),
  });

  const config = { ...env, ...answers };

  const faUrl               = config.faUrl               || env.faUrl;
  const faApiKey            = config.faApiKey            || env.faApiKey;
  const discordClientId     = config.discordClientId     || env.discordClientId;
  const discordClientSecret = config.discordClientSecret || env.discordClientSecret;
  const applicationId       = config.applicationId?.trim() || null;
  const enableGuilds        = config.enableGuilds ?? false;
  const predefinedIdpId     = (config.idpId || env.idpId || '').trim() || null;

  const scopes = enableGuilds ? `${DISCORD.scopes} guilds` : DISCORD.scopes;

  // ── If a UUID was provided, print the redirect URI NOW ────────────────────
  // This lets you confirm it's already set in Discord before the script runs
  // anything — so the moment the script finishes, login is live.

  if (predefinedIdpId) {
    const redirectUri = `${faUrl.replace(/\/$/, '')}/oauth2/callback/${predefinedIdpId}`;
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n  Using pre-defined IdP ID: ${predefinedIdpId}`);
    console.log(`\n  Redirect URI (confirm this is in Discord before continuing):\n`);
    console.log(`    ${redirectUri}\n`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  // ── Step 1: Provision the reconcile lambda ────────────────────────────────

  const lambdaId = await provisionLambda(faUrl, faApiKey);
  console.log(`✅  Lambda ready  (id: ${lambdaId})`);

  // ── Step 2: Create (or update) the Discord IdP ────────────────────────────
  // PUT /api/identity-provider/{id} creates with a known UUID if it doesn't
  // exist, or updates it if it does — making re-runs safe and idempotent.
  // POST /api/identity-provider lets FusionAuth generate the UUID.

  const idpPayload = {
    identityProvider: {
      ...(predefinedIdpId ? { id: predefinedIdpId } : {}),
      type:            'OpenIDConnect',
      name:            'Discord',
      enabled:         true,
      debug:           false,
      linkingStrategy: 'CreatePendingLink',

      oauth2: {
        authorization_endpoint:       DISCORD.authorizationEndpoint,
        token_endpoint:               DISCORD.tokenEndpoint,
        userinfo_endpoint:            DISCORD.userinfoEndpoint,
        client_id:                    discordClientId,
        client_secret:                discordClientSecret,
        scope:                        scopes,
        client_authentication_method: DISCORD.clientAuthMethod,
      },

      uniqueIdClaim:      DISCORD.uniqueIdClaim,
      emailClaim:         'email',
      emailVerifiedClaim: DISCORD.emailVerifiedClaim,

      buttonText:     DISCORD.buttonText,
      buttonColor:    DISCORD.buttonColor,
      buttonImageURL: DISCORD.buttonLogoUrl,

      // Lambda wired in automatically — no manual admin UI step needed
      lambdaConfiguration: {
        reconcileId: lambdaId,
      },

      ...(applicationId
        ? {
            applicationConfiguration: {
              [applicationId]: {
                enabled:            true,
                createRegistration: true,
              },
            },
          }
        : {}),
    },
  };

  const [idpMethod, idpPath] = ['POST', '/api/identity-provider'];

  console.log(`\n⏳  Creating Discord identity provider…`);

  const result = await faRequest(faUrl, faApiKey, idpMethod, idpPath, idpPayload);
  const idpId  = result?.identityProvider?.id;

  // ── Done ──────────────────────────────────────────────────────────────────

  console.log(`✅  Discord IdP ready    (id: ${idpId})`);

  if (predefinedIdpId) {
    // Redirect URI was already shown and pre-configured — nothing left to do
    console.log(`\n  Login with Discord is live.\n`);
  } else {
    // UUID was generated by FusionAuth — one manual step remains
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n  One step remaining:`);
    console.log(`\n  In Discord Developer Portal → OAuth2 → Redirects, add:\n`);
    console.log(`    ${faUrl.replace(/\/$/, '')}/oauth2/callback/${idpId}\n`);
    console.log(`  Then login with Discord is live.\n`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  if (enableGuilds) {
    console.log(`  Note: guilds scope requires a Discord Bot in your target server(s).`);
    console.log(`  See README.md for the proxy setup.\n`);
  }
}

main().catch(err => abort(err.message));
