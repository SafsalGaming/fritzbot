// netlify/functions/discord.js
import { verifyKey } from "@discord-interactions/verify-node";
import { Groq } from "groq-sdk"; // אם לא בא לך SDK, אפשר fetch רגיל

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default async (req, res) => {
  try {
    // Discord signature verification
    const signature = req.headers["x-signature-ed25519"];
    const timestamp = req.headers["x-signature-timestamp"];
    const body = req.body ? req.body : (await readBody(req));
    const isValid = verifyKey(
      Buffer.from(body),
      signature,
      timestamp,
      process.env.DISCORD_PUBLIC_KEY
    );
    if (!isValid) return res.status(401).send("bad request signature");

    const payload = JSON.parse(body);

    // Ping check
    if (payload?.type === 1) {
      return res.json({ type: 1 }); // PONG
    }

    // Slash command: /ask
    if (payload?.type === 2 && payload?.data?.name === "ask") {
      // 1) reply deferred immediately (ack)
      res.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE

      const userQuestion =
        payload.data.options?.find(o => o.name === "prompt")?.value || "";

      // 2) call Groq chat completions (דוגמה עם Llama 3.1)
      const completion = await groq.chat.completions.create({
        model: "llama-3.1-70b-versatile",
        messages: [
          { role: "system", content: "Answer briefly and clearly in Hebrew." },
          { role: "user", content: userQuestion }
        ],
        temperature: 0.4
      });

      const answer = completion.choices?.[0]?.message?.content?.trim() || "אין תשובה.";

      // 3) follow-up webhook (לא דורש Bot Token)
      const followupUrl = `https://discord.com/api/v10/webhooks/${payload.application_id}/${payload.token}`;
      await fetch(followupUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: answer, flags: 0 }) // בלי ephemeral
      });

      return; // כבר ענינו בדפדוף
    }

    // default
    return res.json({ type: 4, data: { content: "פקודה לא מוכרת." } });
  } catch (e) {
    console.error(e);
    try {
      return res.json({ type: 4, data: { content: "שגיאה בבקשה." } });
    } catch {
      return res.status(500).end();
    }
  }
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
