import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export const handler = async (event) => {
  try {
    const { application_id, token, prompt } = JSON.parse(event.body || "{}");
    if (!application_id || !token) {
      return res(400, "missing app id or token");
    }

    const r = await groq.chat.completions.create({
      model: "llama-3.1-70b-versatile",
      messages: [
        { role: "system", content: "ענה בעברית, קצר וברור." },
        { role: "user", content: prompt || "" }
      ],
      temperature: 0.4
    });

    const answer = r.choices?.[0]?.message?.content?.trim() || "אין תשובה.";
    const editUrl = `https://discord.com/api/v10/webhooks/${application_id}/${token}/messages/@original`;

    await fetch(editUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: answer })
    });

    return res(200, "ok");
  } catch (e) {
    console.error("background error", e);
    // מחזירים 200 כדי לא להפיל את נטליפיי גם אם נכשל
    return res(200, "done");
  }
};

const res = (statusCode, body) => ({
  statusCode, headers: { "Content-Type": "text/plain" }, body
});
