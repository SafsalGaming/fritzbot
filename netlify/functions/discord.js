import { verifyKey } from "discord-interactions";

const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();

export const handler = async (event) => {
  try {
    const sig = event.headers["x-signature-ed25519"];
    const ts  = event.headers["x-signature-timestamp"];
    if (!sig || !ts || !event.body || !PUBKEY) {
      return text(401, "missing signature/timestamp/body/pubkey");
    }

    // חשוב: לעבוד על הגוף הגולמי. ב-Netlify לפעמים הוא Base64.
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body);

    if (!verifyKey(raw, sig, ts, PUBKEY)) {
      return text(401, "bad request signature");
    }

    const payload = JSON.parse(raw.toString("utf8"));

    // Ping
    if (payload?.type === 1) {
      return json({ type: 1 });
    }

    // Slash: /ask -> defer (נחזיר תשובה אמתית ב-follow-up מהפונקציה השנייה שתוסיף אחרי שהאימות עובר)
    if (payload?.type === 2 && payload?.data?.name === "ask") {
      return json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    }

    return json({ type: 4, data: { content: "פקודה לא מוכרת." } });
  } catch (e) {
    console.error(e);
    return json({ type: 4, data: { content: "שגיאה." } });
  }
};

function json(obj) {
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function text(code, body) {
  return { statusCode: code, headers: { "Content-Type": "text/plain" }, body };
}
