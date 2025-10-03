// netlify/functions/discord.js
import { verifyKey } from "discord-interactions";
import { Groq } from "groq-sdk";

const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();
const groqKey = process.env.GROQ_API_KEY || "";
const groq = new Groq({ apiKey: groqKey });

// עוזרי החזרה
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

// תשובה סינכרונית מהירה ל-/ask (נמנע מפולואפ)
async function answerWithGroq(prompt) {
  // נחתוך ל-2.5 שניות כדי לא לחרוג מה-3 שניות של דיסקורד
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2500);

  try {
    const r = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "ענה בעברית, קצר, חד וברור." },
        { role: "user", content: prompt || "" },
      ],
      temperature: 0.4,
      max_tokens: 250,
      // אין streaming פה כי אנחנו חייבים להשיב מהר בחבילה אחת
    }, { signal: controller.signal });

    clearTimeout(t);
    const answer = r?.choices?.[0]?.message?.content?.trim();
    return answer || "אין לי תשובה כרגע.";
  } catch (e) {
    clearTimeout(t);
    // אם זה Abort (timeout) או כל תקלה – נחזיר הודעה קצרה
    console.error("GROQ_ERR", e?.name || "", e?.message || "");
    return "מתעכב לי מדי… נסה ניסוח קצר יותר.";
  }
}

export const handler = async (event) => {
  try {
    const sig = event.headers["x-signature-ed25519"];
    const ts  = event.headers["x-signature-timestamp"];

    if (!sig || !ts || typeof event.body !== "string" || !PUBKEY) {
      return text(401, "missing signature/timestamp/body/pubkey");
    }

    // אימות חתימה – להשתמש בגוף המקורי בדיוק
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
    const ok = await verifyKey(raw, sig, ts, PUBKEY);
    if (!ok) return text(401, "bad request signature");

    const payload = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);

    // Ping
    if (payload?.type === 1) return json({ type: 1 });

    // Slash command
    if (payload?.type === 2 && payload?.data?.name === "ask") {
      const prompt = payload.data.options?.find(o => o.name === "prompt")?.value || "";

      if (!groqKey) {
        return json({
          type: 4,
          data: { content: "חסר GROQ_API_KEY ב-Netlify." },
        });
      }

      // מנסים להביא תשובה מהר ולעמוד ב-3 שניות
      const answer = await answerWithGroq(prompt);

      // מחזירים הודעה רגילה (type 4) עם התשובה
      return json({
        type: 4,
        data: {
          content: answer,
        },
      });
    }

    // ברירת מחדל – לא זיהינו פקודה
    return json({ type: 4, data: { content: "פקודה לא מוכרת." } });
  } catch (e) {
    console.error("DISCORD_FN_ERR", e);
    return json({ type: 4, data: { content: "נפלתי. נסה שוב." } });
  }
};
