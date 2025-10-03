// netlify/functions/ask-followup-background.js
import { Groq } from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export const handler = async (event) => {
  try {
    const { application_id, token, prompt } = JSON.parse(event.body || "{}");
    console.log("BG_START", { hasApp: !!application_id, hasToken: !!token, promptLen: (prompt || "").length });

    if (!application_id || !token) {
      console.error("BG_BAD_INPUT", event.body);
      return res(400, "missing app id or token");
    }
    if (!process.env.GROQ_API_KEY) {
      console.error("BG_NO_GROQ_KEY");
      // נחזיר משהו כדי שלא תישאר “חושב”
      await editOriginal(application_id, token, "חסר GROQ_API_KEY ב-Netlify.");
      return res(200, "ok");
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
    const ok = await editOriginal(application_id, token, answer);
    console.log("BG_DONE", { edited: ok });

    return res(200, "ok");
  } catch (e) {
    console.error("BG_ERR", e);
    // לא מפילים את נטליפיי, וגם לא משאירים “חושב”
    try {
      const { application_id, token } = JSON.parse(event.body || "{}");
      if (application_id && token) {
        await editOriginal(application_id, token, "נפלתי בדרך. נסה שוב.");
      }
    } catch {}
    return res(200, "done");
  }
};

async function editOriginal(appId, token, content) {
  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error("PATCH_FAIL", resp.status, body);
    return false;
  }
  return true;
}

const res = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "text/plain" }, body });
