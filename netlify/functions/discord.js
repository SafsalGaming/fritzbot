import { verifyKey } from "discord-interactions";

const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();

export const handler = async (event) => {
  try {
    const sig = event.headers["x-signature-ed25519"];
    const ts  = event.headers["x-signature-timestamp"];
    if (!sig || !ts || typeof event.body !== "string" || !PUBKEY) {
      return text(401, "missing signature/timestamp/body/pubkey");
    }

    const rawForVerify = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
    const ok = await verifyKey(rawForVerify, sig, ts, PUBKEY);
    if (!ok) return text(401, "bad request signature");

    const body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    const payload = JSON.parse(body);

    if (payload?.type === 1) return json({ type: 1 });

    if (payload?.type === 2 && payload?.data?.name === "ask") {
      const prompt = payload.data.options?.find(o => o.name === "prompt")?.value || "";

      const proto = (event.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
      const host  = (event.headers["x-forwarded-host"]  || event.headers["host"] || "").split(",")[0].trim();
      const bgUrl = `${proto}://${host}/.netlify/functions/ask-followup`;


      console.log("CALL_BG", { bgUrl, hasToken: !!payload.token, hasAppId: !!payload.application_id, promptLen: prompt.length });

      fetch(bgUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: payload.application_id, token: payload.token, prompt })
      }).catch(e => console.error("BG_CALL_ERR", e?.message));

      return json({ type: 5 }); // defer
    }

    return json({ type: 4, data: { content: "פקודה לא מוכרת." } });
  } catch (e) {
    console.error("DISCORD_FN_ERR", e);
    return json({ type: 4, data: { content: "שגיאה." } });
  }
};

const json = (obj) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
const text = (code, body) => ({ statusCode: code, headers: { "Content-Type": "text/plain" }, body });

