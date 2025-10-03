import { verifyKey } from "discord-interactions";

const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();

export const handler = async (event) => {
  // לוג מינימלי לעקוב שהבקשה מגיעה ומה מצב הבודי
  console.log("HIT", event.httpMethod, "isBase64:", event.isBase64Encoded);

  try {
    const sig = event.headers["x-signature-ed25519"];
    const ts  = event.headers["x-signature-timestamp"];

    if (!sig || !ts || typeof event.body !== "string" || !PUBKEY) {
      return text(401, "missing signature/timestamp/body/pubkey");
    }

    // קריטי: אם Base64 -> Buffer; אחרת -> מחרוזת RAW בדיוק כמו שהגיעה
    const rawForVerify = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : event.body;

    const ok = verifyKey(rawForVerify, sig, ts, PUBKEY);
    if (!ok) {
      console.log("VERIFY_FAIL");
      return text(401, "bad request signature");
    }

    // עכשיו מותר לפרסר
    const payload = JSON.parse(
      event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8")
                            : event.body
    );

    if (payload?.type === 1) {
      return json({ type: 1 }); // PONG
    }

    if (payload?.type === 2 && payload?.data?.name === "ask") {
      return json({ type: 5 }); // defer
    }

    return json({ type: 4, data: { content: "פקודה לא מוכרת." } });
  } catch (e) {
    console.error(e);
    return json({ type: 4, data: { content: "שגיאה." } });
  }
};

const json = (obj) => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
const text = (code, body) => ({
  statusCode: code,
  headers: { "Content-Type": "text/plain" },
  body,
});
