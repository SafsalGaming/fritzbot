import { verifyKey } from "discord-interactions";

const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();

export const handler = async (event) => {
  // לוגים דיאגנוסטיים חדים
  const sig = event.headers["x-signature-ed25519"];
  const ts  = event.headers["x-signature-timestamp"];
  console.log("HIT",
    "method:", event.httpMethod,
    "base64:", !!event.isBase64Encoded,
    "hasSig:", !!sig,
    "hasTs:", !!ts,
    "pkLen:", PUBKEY.length
  );

  try {
    if (!sig || !ts || typeof event.body !== "string" || !PUBKEY) {
      console.log("MISS_FIELDS");
      return text(401, "missing signature/timestamp/body/pubkey");
    }

    // חשוב: אם Base64 -> Buffer; אחרת -> המחרוזת RAW
    const rawForVerify = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : event.body;

    const ok = verifyKey(rawForVerify, sig, ts, PUBKEY);
    console.log("VERIFY_OK:", ok);
    if (!ok) return text(401, "bad request signature");

    // מפה מותר לפרסר
    const jsonBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;

    const payload = JSON.parse(jsonBody);

    if (payload?.type === 1) {
      console.log("PONG");
      return json({ type: 1 });
    }

    if (payload?.type === 2 && payload?.data?.name === "ask") {
      console.log("/ask defer");
      return json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    }

    return json({ type: 4, data: { content: "פקודה לא מוכרת." } });
  } catch (e) {
    console.error("ERR", e);
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
