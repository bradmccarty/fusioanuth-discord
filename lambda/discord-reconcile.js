/**
 * FusionAuth Discord Reconcile Lambda
 *
 * Runs after FusionAuth fetches the Discord userinfo endpoint and before
 * the user object is saved. Maps Discord-specific fields into FusionAuth's
 * user model, including fields that require construction (avatar URL) or
 * that use non-standard claim names (verified, discriminator, etc.).
 *
 * Deploy:
 *   FusionAuth Admin UI → Customizations → Lambdas → Add Lambda
 *   Type: OpenID Connect Reconcile
 *   Paste the contents of this file, then assign it to your Discord IdP.
 *
 * Discord userinfo response shape (from /users/@me):
 * {
 *   id: "80351110224678912",         // Snowflake — use as uniqueId
 *   username: "Nelly",
 *   discriminator: "1337",           // Legacy — may be "0" for new usernames
 *   global_name: "Nelly",            // New display name (may be null)
 *   avatar: "8342729096ea3675442027", // Hash — construct CDN URL from this
 *   email: "nelly@example.com",
 *   verified: true,                  // email verified — NOT email_verified
 *   locale: "en-US",
 *   mfa_enabled: false,
 *   premium_type: 0,                 // 0=None, 1=Nitro Classic, 2=Nitro, 3=Nitro Basic
 *   flags: 0,
 *   public_flags: 0,
 *   banner: null,                    // Profile banner hash (may be null)
 *   accent_color: null,
 * }
 */

// This is the function FusionAuth calls. The signature is fixed.
// NOTE: Discord does not issue a real JWT id_token, so FusionAuth puts the
// userinfo endpoint claims into `idToken`. The `userInfo` param ends up as
// just the OAuth access token wrapper — read everything from `idToken`.
function reconcile(user, registration, idToken, accessToken, userInfo) {

  // ── Avatar URL ────────────────────────────────────────────────────────────
  // Discord returns only the hash; we must construct the full CDN URL.
  // Format: https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.png
  // Use ?size=256 for a reasonable resolution. Supports .webp, .png, .jpg, .gif
  // (animated avatars start with "a_")
  if (idToken.avatar && typeof idToken.avatar === 'string') {
    var isAnimated = idToken.avatar.startsWith('a_');
    var extension  = isAnimated ? 'gif' : 'png';
    user.imageUrl  =
      'https://cdn.discordapp.com/avatars/' +
      idToken.id + '/' +
      idToken.avatar + '.' + extension + '?size=256';
  } else {
    // Default Discord avatar — index based on discriminator (or new-style default)
    // BigInt() throws if idToken.id is not a valid integer string, so guard it.
    var defaultIndex = 0;
    if (idToken.discriminator === '0') {
      try {
        defaultIndex = Number(BigInt(idToken.id) >> BigInt(22)) % 6;
      } catch (e) {
        defaultIndex = 0;
      }
    } else {
      defaultIndex = parseInt(idToken.discriminator, 10) % 5;
    }
    user.imageUrl =
      'https://cdn.discordapp.com/embed/avatars/' + defaultIndex + '.png';
  }

  // ── Display name ──────────────────────────────────────────────────────────
  // Prefer global_name (new system), fall back to username#discriminator (legacy)
  if (idToken.global_name) {
    user.fullName = idToken.global_name;
  } else if (idToken.username) {
    user.fullName = idToken.discriminator && idToken.discriminator !== '0'
      ? idToken.username + '#' + idToken.discriminator
      : idToken.username;
  }

  // ── Username ──────────────────────────────────────────────────────────────
  // Store the raw Discord username (without discriminator)
  if (idToken.username) {
    user.username = idToken.username;
  }

  // ── Email verified ────────────────────────────────────────────────────────
  // Discord uses 'verified' instead of the OIDC-standard 'email_verified'
  if (typeof idToken.verified !== 'undefined') {
    user.verified = idToken.verified;
  }

  // ── Locale ────────────────────────────────────────────────────────────────
  if (idToken.locale) {
    user.preferredLanguages = [idToken.locale];
  }

  // ── Discord-specific data in user.data ────────────────────────────────────
  // Store all Discord-specific fields in user.data.discord so they're
  // accessible via the Registration API and templates without polluting
  // the core user fields.
  user.data = user.data || {};
  user.data.discord = {
    id:            idToken.id,
    username:      idToken.username,
    discriminator: idToken.discriminator,
    globalName:    idToken.global_name  || null,
    locale:        idToken.locale       || null,
    mfaEnabled:    idToken.mfa_enabled  || false,
    premiumType:   idToken.premium_type || 0,
    flags:         idToken.public_flags || 0,
    // Banner hash (null if not set)
    banner: idToken.banner
      ? 'https://cdn.discordapp.com/banners/' + idToken.id + '/' + idToken.banner + '.png?size=600'
      : null,
    // Accent colour as CSS hex string (null if not set).
    // Guard against non-numeric values — Discord documents this as an integer
    // but has returned strings in some API versions.
    accentColor: (typeof idToken.accent_color === 'number')
      ? '#' + idToken.accent_color.toString(16).padStart(6, '0')
      : null,
  };

  // ── Guild membership (optional — requires guilds scope) ───────────────────
  // If the guilds scope was requested, Discord includes guild data in the
  // token. This won't be present in idToken directly (it requires a separate
  // /users/@me/guilds API call), but if you're using the proxy (see proxy/)
  // or have injected guild data into the token, this handles it.
  if (Array.isArray(idToken.guilds)) {
    user.data.discord.guilds = idToken.guilds.map(function(g) {
      return {
        id:   g.id,
        name: g.name,
        // Whether the user is the owner of this server
        owner: g.owner || false,
        // Bitfield of user's permissions in the server
        permissions: g.permissions || '0',
        icon: g.icon
          ? 'https://cdn.discordapp.com/icons/' + g.id + '/' + g.icon + '.png'
          : null,
      };
    });
  }

  // ── Registration data ─────────────────────────────────────────────────────
  // Mirror the Discord ID on the registration for quick lookup
  registration.data = registration.data || {};
  registration.data.discord = {
    id:       idToken.id,
    username: idToken.username,
  };
}
