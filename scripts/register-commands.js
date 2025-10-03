// scripts/register-commands.js
const APP_ID   = process.env.DISCORD_APP_ID || process.env.APP_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // אופציונלי לבדיקות מיידיות בשרת
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN; // חלופה 1
const CID = process.env.DISCORD_CLIENT_ID;       // חלופה 2 (בלי בוט)
const CSEC = process.env.DISCORD_CLIENT_SECRET;  // חלופה 2

if (!APP_ID) {
  console.error("register-commands: Missing DISCORD_APP_ID");
  process.exit(1);
}

// אם אתה רוצה פקודות ב-DM בלבד (User install):
// const commands = [{ name:"ask", description:"שאל את ה-AI", type:1, integration_types:[1], contexts:[2],
//   options: [{ name:"prompt", description:"מה לשאול?", type:3, required:true }] }];

// אם אתה רוצה גם ב-DM וגם בשרתים (מומלץ לפיתוח):
const commands = [
  {
    name: "ask",
    description: "שאל את פריץ את שעל ליבך",
    type: 1,
    integration_types: [1, 0], // User + Guild installs
    contexts: [2, 0], // DM + Guild
    options: [
      { name: "prompt", description: "", type: 3, required: true }
    ]
  }
];

async function getAuthHeader() {
  if (BOT_TOKEN) return `Bot ${BOT_TOKEN}`;

  if (CID && CSEC) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "applications.commands.update"
    });
    const r = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(`${CID}:${CSEC}`).toString("base64")
      },
      body: body.toString()
    });
    const j = await r.json();
    if (!r.ok) throw new Error("oauth token error: " + JSON.stringify(j));
    return `Bearer ${j.access_token}`;
  }

  throw new Error("Set DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET");
}

async function put(url, auth) {
  const r = await fetch(url, {
    method: "PUT",
    headers: { "Authorization": auth, "Content-Type": "application/json" },
    body: JSON.stringify(commands)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PUT ${url} -> ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

async function get(url, auth) {
  const r = await fetch(url, { headers: { "Authorization": auth } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

(async () => {
  const auth = await getAuthHeader();

  if (GUILD_ID) {
    const gUrl = `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;
    const gPut = await put(gUrl, auth);
    const gGet = await get(gUrl, auth);
    console.log("GUILD OK:", gPut.map(c => c.name), "NOW:", gGet.map(c => c.name));
  }

  const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;
  const putRes = await put(url, auth);
  const getRes = await get(url, auth);
  console.log("GLOBAL OK:", putRes.map(c => c.name), "NOW:", getRes.map(c => c.name));
})().catch(err => {
  console.error("register-commands error:", err);
  process.exit(1);
});


