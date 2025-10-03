import { verifyKey } from "discord-interactions";

const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();

export const handler = async (event) => {
  try {
    const sig = event.headers["x-signature-ed25519"];
    const ts  = event.headers["x-signature-timestamp"];
    if (!sig || !ts || typeof event.body !== "string" || !PUBKEY) {
      return text(401, "missing signature/timestamp/body/pubkey");
    }

    // בדיוק מה שדיסקורד שלח: אם base64 → Buffer, אחרת → המחרוזת עצמה
    const rawForVerify = event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : event.body;

    const ok = await verifyKey(rawForVerify, sig, ts, PUBKEY);
    if (!ok) return text(401, "bad request signature");

    // עכשיו מותר לפרסר
    const jsonBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    const payload = JSON.parse(jsonBody);

    // Ping
    if (payload?.type === 1) return json({ type: 1 });

    // /ask → defer + קריאה לפונקציה ברקע שתביא תשובה מ-Groq ותערוך את ההודעה
    if (payload?.type === 2 && payload?.data?.name === "ask") {
      const prompt =
        payload.data.options?.find(o => o.name === "prompt")?.value || "";

      const bgUrl = `${process.env.URL}/.netlify/functions/ask-followup-background`;
      // לא חוסם את התגובה המיידית
      fetch(bgUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application_id: payload.application_id,
          token: payload.token,
          prompt
        })
      }).catch(() => {});

      return json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
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
