// scripts/register-commands.js
// Node 20+ (fetch מובנה)

const APP_ID =
  process.env.DISCORD_APP_ID ||
  process.env.DISCORD_APPLICATION_ID ||
  process.env.APP_ID;

const GUILD_ID = process.env.DISCORD_GUILD_ID; // אופציונלי: לרישום מהיר לשרת ספציפי

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN; // חלופה 1
const CID = process.env.DISCORD_CLIENT_ID;       // חלופה 2 (בלי בוט)
const CSEC = process.env.DISCORD_CLIENT_SECRET;  // חלופה 2

const commands = [
  {
    name: "ask",
    type: 1,
    integration_types: [1, 0], // User + Guild installs
    description: "שאל את פריץ את שעל ליבך",
    contexts: [2, 0], // DM + Guild
    options: [{ name: "text", description: "שאלה", type: 3, required: true }],
  },
  {
    name: "fritz-mode",
    type: 1,
    description: "הפעל/כבה מצב פריץ",
    integration_types: [1, 0],
    contexts: [2, 0],
    options: [
      {
        type: 3,
        name: "mode",
        description: "בחר מצב",
        required: true,
        choices: [
          { name: "activate", value: "activate" },
          { name: "deactivate", value: "deactivate" },
        ],
      },
    ],
  },
];

async function oauthClientCredentialsToken() {
  // לפי הדוקס אפשר Client Credentials עם scope applications.commands.update :contentReference[oaicite:0]{index=0}
  // ובמקרים מסוימים Discord רוצה client_id/client_secret בגוף ולא ב-Basic Auth :contentReference[oaicite:1]{index=1}

  const url = "https://discord.com/api/v10/oauth2/token";
  const baseBody = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "applications.commands.update",
  });

  // ניסיון 1: Basic Auth
  {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(`${CID}:${CSEC}`).toString("base64"),
      },
      body: baseBody.toString(),
    });

    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.access_token) return j.access_token;

    // אם זה לא 400/invalid_client, לא נמרח
    const txt = JSON.stringify(j);
    if (r.status !== 400 && !txt.includes("invalid_client")) {
      throw new Error(`oauth token error (basic) -> ${r.status}: ${txt}`);
    }
  }

  // ניסיון 2: client_id/client_secret בגוף
  {
    const body = new URLSearchParams(baseBody);
    body.set("client_id", CID);
    body.set("client_secret", CSEC);

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.access_token) {
      throw new Error(`oauth token error (body) -> ${r.status}: ${JSON.stringify(j)}`);
    }
    return j.access_token;
  }
}

async function getAuthHeader() {
  // Bot token (הכי פשוט)
  if (BOT_TOKEN) return `Bot ${BOT_TOKEN}`; // Discord Auth header :contentReference[oaicite:2]{index=2}

  // בלי בוט: OAuth2 client_credentials עם applications.commands.update :contentReference[oaicite:3]{index=3}
  if (CID && CSEC) {
    const token = await oauthClientCredentialsToken();
    return `Bearer ${token}`;
  }

  throw new Error("Set DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET");
}

async function put(url, auth) {
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json",
      "User-Agent": "fritzbot(register-commands,1.0)",
    },
    body: JSON.stringify(commands),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PUT ${url} -> ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

async function get(url, auth) {
  const r = await fetch(url, {
    headers: {
      "Authorization": auth,
      "User-Agent": "fritzbot(register-commands,1.0)",
    },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

(async () => {
  const hasAppId = Boolean(APP_ID);
  const hasAuth = Boolean(BOT_TOKEN || (CID && CSEC));
  if (!hasAppId || !hasAuth) {
    const missing = [];
    if (!hasAppId) missing.push("DISCORD_APP_ID/DISCORD_APPLICATION_ID/APP_ID");
    if (!hasAuth) missing.push("DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID+DISCORD_CLIENT_SECRET");
    console.warn(`register-commands: skipped (missing ${missing.join(" and ")})`);
    process.exit(0);
  }

  const auth = await getAuthHeader();

  if (GUILD_ID) {
    const gUrl = `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;
    const gPut = await put(gUrl, auth);
    const gGet = await get(gUrl, auth);
    console.log("GUILD OK:", gPut.map(c => c.name), "NOW:", gGet.map(c => c.name));
  }

  const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`; // register global :contentReference[oaicite:4]{index=4}
  const putRes = await put(url, auth);
  const getRes = await get(url, auth);
  console.log("GLOBAL OK:", putRes.map(c => c.name), "NOW:", getRes.map(c => c.name));
})().catch(err => {
  console.error("register-commands error:", err?.stack || err?.message || err);
  process.exit(1);
});
