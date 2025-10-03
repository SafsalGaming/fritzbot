import { verifyKey } from "discord-interactions";

const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();

export const handler = async (event) => {
  try {
    const sig = event.headers["x-signature-ed25519"];
    const ts  = event.headers["x-signature-timestamp"];
    if (!sig || !ts || typeof event.body !== "string" || !PUBKEY) {
      return text(401, "missing signature/timestamp/body/pubkey");
    }

    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
    const ok = await verifyKey(raw, sig, ts, PUBKEY);
    if (!ok) return text(401, "bad request signature");

    const payload = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);

    // Ping
    if (payload?.type === 1) return json({ type: 1 });

    // /ask
    if (payload?.type === 2 && payload?.data?.name === "ask") {
      const prompt = payload.data.options?.find(o => o.name === "prompt")?.value || "";

      // בונה כתובת מוחלטת מהבקשה (לא תלוי ב-URL env)
      const proto = (event.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
      const host  = (event.headers["x-forwarded-host"]  || event.headers["host"] || "").split(",")[0].trim();
      const fuUrl = `${proto}://${host}/.netlify/functions/ask-followup`;

      console.log("CALL_FOLLOWUP", { fuUrl, hasToken: !!payload.token, hasAppId: !!payload.application_id, promptLen: prompt.length });

      // שליחה לא-חוסמת + לוג על התשובה מהפונקציה
      fetch(fuUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: payload.application_id, token: payload.token, prompt })
      })
      .then(async (r) => {
        const t = await r.text().catch(() => "");
        console.log("FOLLOWUP_RESP", { status: r.status, body: t.slice(0, 200) });
      })
      .catch(e => console.error("FOLLOWUP_CALL_ERR", e?.message));

      // דחייה מובנית של דיסקורד
      return json({ type: 5 });
    }

    return json({ type: 4, data: { content: "פקודה לא מוכרת." } });
  } catch (e) {
    console.error("DISCORD_FN_ERR", e);
    return json({ type: 4, data: { content: "שגיאה." } });
  }
};

const json = (obj) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
const text = (code, body) => ({ statusCode: code, headers: { "Content-Type": "text/plain" }, body });
