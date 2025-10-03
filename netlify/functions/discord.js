// netlify/functions/discord.js
import { verifyKey } from "discord-interactions";

const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();

export const handler = async (event) => {
  try {
    // קבל את הגוף הגולמי בדיוק כפי שהגיע לדיסקורד
    const signature = event.headers["x-signature-ed25519"];
    const timestamp = event.headers["x-signature-timestamp"];
    if (!signature || !timestamp || !event.body || !PUBKEY) {
      return resp(401, "missing signature/timestamp/body/pubkey");
    }

    // Netlify לפעמים שולח Base64
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body);

    // חשוב: אימות על הגוף הגולמי, לפני JSON.parse
    const ok = verifyKey(rawBody, signature, timestamp, PUBKEY);
    if (!ok) return resp(401, "bad request signature");

    const payload = JSON.parse(rawBody.toString("utf8"));

    // PING = 1  -> להחזיר PONG מיד
    if (payload?.type === 1) {
      return json({ type: 1 });
    }

    // Slash command בסיסי לדוגמה (תוכל להשאיר ככה ואז לשלב Groq אחרי שיאומת):
    if (payload?.type === 2 && payload?.data?.name === "ask") {
      // defer כדי לא לחכות
      return json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    }

    return json({ type: 4, data: { content: "פקודה לא מוכרת." } });
  } catch (e) {
    console.error(e);
    return json({ type: 4, data: { content: "שגיאה." } });
  }
};

function json(obj) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
function resp(code, text) {
  return { statusCode: code, headers: { "Content-Type": "text/plain" }, body: text };
}

