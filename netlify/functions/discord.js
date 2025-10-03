// netlify/functions/discord.js
import { verifyKey } from "@discord-interactions/verify-node";
import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default async (event) => {
  try {
    // קבל את הגוף הגולמי כמו שהוא (Discord חותם על המחרוזת המקורית)
    const signature = event.headers["x-signature-ed25519"];
    const timestamp = event.headers["x-signature-timestamp"];
    const body = event.body || ""; // string

    const isValid = verifyKey(
      Buffer.from(body),
      signature,
      timestamp,
      process.env.DISCORD_PUBLIC_KEY
    );

    if (!isValid) {
      return { statusCode: 401, body: "bad request signature" };
    }

    const payload = JSON.parse(body);

    // Ping
    if (payload?.type === 1) {
      return json({ type: 1 });
    }

    // Slash: /ask
    if (payload?.type === 2 && payload?.data?.name === "ask") {
      // חייבים לענות תוך 3 שניות: שולחים defer
      queueFollowup(payload); // לא מחכים לזה
      return json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    }

    return json({ type: 4, data: { content: "פקודה לא מוכרת." } });
  } catch (err) {
    console.error(err);
    // אם כבר לא נוכל לענות בפורמט Discord, נחזיר 200 עם שגיאה
    return json({ type: 4, data: { content: "שגיאה בבקשה." } });
  }
};

// שליחת התשובה האמיתית ב-follow-up webhook (אחרי ה-defer)
async function queueFollowup(payload) {
  try {
    const prompt =
      payload.data.options?.find((o) => o.name === "prompt")?.value || "";

    const completion = await groqChat(prompt);

    const followupUrl = `https://discord.com/api/v10/webhooks/${payload.application_id}/${payload.token}`;
    await fetch(followupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: completion || "אין תשובה.",
        flags: 0 // פומבי; אם תרצה ephemeral שים 64
      })
    });
  } catch (e) {
    console.error("followup failed:", e);
  }
}

async function groqChat(userQuestion) {
  const completion = await new Groq({ apiKey: process.env.GROQ_API_KEY })
    .chat.completions.create({
      model: "llama-3.1-70b-versatile",
      messages: [
        { role: "system", content: "ענה בעברית, קצר וברור." },
        { role: "user", content: userQuestion }
      ],
      temperature: 0.4
    });

  return completion.choices?.[0]?.message?.content?.trim();
}

function json(obj) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}
