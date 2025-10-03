// scripts/register-commands.js
// רושם את כל הפקודות (overwrite). אם יש GUILD_ID ירשום גם לגילד (מיידי) וגם גלובלי (איטי יותר).

const APP_ID   = process.env.DISCORD_APP_ID || process.env.APP_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // אופציונלי
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN; // אם בא לך בוט רק לרישום
const CID = process.env.DISCORD_CLIENT_ID;       // לחלופה בלי בוט
const CSEC = process.env.DISCORD_CLIENT_SECRET;  // לחלופה בלי בוט

if (!APP_ID) {
  console.error("Missing DISCORD_APP_ID");
  process.exit(0);
}

const commands = [
  {
    name: "ask",
    description: "שאל את ה-AI",
    type: 1,
    // User-install
    integration_types: [1],
    contexts: [2], // DM/פרייבט; אם תרצה גם בשרתים: הוסף 0 בשניהם
    options: [
      { name: "prompt", description: "מה לשאול?", type: 3, required: true }
    ]
  }
];

async function getAuthHeader() {
  // A) הכי פשוט: Bot Token (לא צריך שהבוט יהיה מחובר לגייטווי)
  if (BOT_TOKEN) return `Bot ${BOT_TOKEN}`;

  // B) בלי בוט: OAuth2 Client Credentials עם scope applications.commands.update
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
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json",
      "X-RateLimit-Precision": "millisecond"
    },
    body: JSON.stringify(commands)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Failed ${r.status}: ${JSON.stringify(j)}`);
  console.log("OK", url, j.map(c => c.name));
}

(async () => {
  const auth = await getAuthHeader();

  // לרענון מיידי בזמן פיתוח — גילד (אם סיפקת GUILD_ID)
  if (GUILD_ID) {
    await put(`https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`, auth);
  }
  // גלובלי — מוחק הכל ומעלה רק את מה שב-commands
  await put(`https://discord.com/api/v10/applications/${APP_ID}/commands`, auth);
})().catch(err => {
  console.error("register-commands error:", err.message);
  // לא מפיל את הדיפלוי — רק מדפיס שגיאה
  process.exit(0);
});
