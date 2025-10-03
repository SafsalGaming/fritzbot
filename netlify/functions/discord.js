import { verifyKey } from "discord-interactions";

const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();

export const handler = async (event) => {
  try {
    const sig = event.headers["x-signature-ed25519"];
    const ts  = event.headers["x-signature-timestamp"];
    if (!sig || !ts || !event.body || !PUBKEY) {
      return txt(401, "missing signature/timestamp/body/pubkey");
    }

    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : Buffer.from(event.body);

    if (!verifyKey(raw, sig, ts, PUBKEY)) {
      return txt(401, "bad request signature");
    }

    const payload = JSON.parse(raw.toString("utf8"));

    if (payload?.type === 1) {
      return json({ type: 1 }); // PONG
    }

    if (payload?.type === 2 && payload?.data?.name === "ask") {
      // defer - נענה אחר כך ב-follow-up
      return json({ type: 5 });
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
function txt(code, body) {
  return { statusCode: code, headers: { "Content-Type": "text/plain" }, body };
}
