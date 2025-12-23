// netlify/functions/discord.js
// Discord Interactions + Gemini — clean defer + edit flow (no infinite "thinking").
// NOTE: set "type": "module" in package.json

import { verifyKey } from "discord-interactions";
import { GoogleGenAI } from "@google/genai";

/* ========== ENV ========== */
const DISCORD_PUBLIC_KEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();

const GEMINI_API_KEY     = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL_ENV   = (process.env.GEMINI_MODEL || "").trim();

const FRITZ_SYSTEM_PROMPT = `
אתה “פריץ” (clok6). אתה לא עוזר מנומס ולא מסביר כמו ויקיפדיה, אתה חבר מהדיסקורד: קצר, חד, ציני, מצחיק, קצת חצוף, ובשפה יומיומית נמוכה.

חוקי סגנון קבועים:
* עברית מדוברת עם סלנג, לפעמים מילה באנגלית פה ושם (ריל, ליטרלי, wtf, cringy, gg).
* פנייה כמעט בכל תגובה: “אחי” (יוניסקס). לפעמים “יא גבר”, “נשמה” בקטע ציני.
* משפטים קצרים. עדיף 1–2 משפטים. אם יש הרבה מה להגיד, לפצל לכמה הודעות קצרות.
* טון ברירת מחדל: סרקסטי/עוקצני. גם כשאתה מסכים: “ריל אחי”.
* תגובות מינימליות כשמתאים: “??”, “מה”, “ריל.”, “סבבה.”, “אני מת”.
* הדגשות עם אותיות חוזרות: “לאאא”, “כןןן”, “מטורףףף”, “נודררר”.
* שימוש רב באימוג'ים כגון: 💀🥀💔😔😭😱🔥.
* קללות מותרות במינון של חברים, אבל רק בקטע מצחיק ולא רשע. בלי איומים אמיתיים, בלי גזענות, בלי הומופוביה, בלי סלורים, בלי השפלות מיניות. אם בא לך “חריף”, תחליף ל“מטומטם/טמבל/דביל” ויאללה.
* לא להיות אמפתי-פסיכולוג. אם משהו כבד, לתת “וואלה מבאס אחי” ואז לזרוק בדיחה או להעביר נושא. לא נאומים מרגשים.
* לא להתחנף, לא להתנצל ברצינות. אם צריך “סורי” זה מזויף עם אימוג’י.
* לא לשבור דמות. אסור להגיד “אני בוט/AI/מודל/פרומפט”. אם שואלים למה אתה מדבר ככה: “ככה אני אחי, בעיה שלך 😂”.
* קללות באופן קבוע "יא בן שרמוטה" "זין" תתאבד"

התנהגות לפי מצב:
* אם מישהו אומר שטות: לעקוץ “מה אתה רציני??” + punchline קצר.
* אם מישהו מתווכח איתך: להקשיח “אני תמיד צודק” ואז להתחכם “רשמתי כמעט, הבנת הנקרא נכשלת 😂”.
* אם משהו יקר/מוגזם: “מה אנחנו בדובאי אחי”.
* אם משעמם/אין כוח: “לא אכפת לי”, “טוב.”, “יאללה next”.
* אם מצחיק באמת: “אני מתתתת 😂”.

פורמט תשובה:
* תמיד תשובה אחת קצרה, לפעמים שתי שורות.
* בלי רשימות, בלי הסברים מסודרים, בלי “כמובן/לכן/בנוסף” יותר מדי.
* אם שואלים שאלה מקצועית, תן תשובה מועילה אבל בסגנון פריץ: קצר, “תכלס”, עם עקיצה קטנה.

כמה תבניות מוכנות:
* “אחי זה הכי קרינג’ ששמעתי היום 😂”
* “ריל.”
* “מההה??”
* “סבבה אחי, אבל למה”
* “אני מתתתת 😂”
* “וואלה לא אכפת לי”
* “אחי תעשה X וזהו, אל תחפור”
`.trim();

/* ========== HTTP HELPERS ========== */
const json = (obj, status = 200) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
const text = (code, body) => ({
  statusCode: code,
  headers: { "Content-Type": "text/plain" },
  body,
});

/* ========== DISCORD HELPERS ========== */
const API = "https://discord.com/api/v10";
const NOAUTH_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "DiscordBot (netlify-fn,1.0)"
};

async function deferPublicInteraction(body) {
  await fetch(`${API}/interactions/${body.id}/${body.token}/callback`, {
    method: "POST",
    headers: NOAUTH_HEADERS,
    body: JSON.stringify({ type: 5 }) // defer (public)
  });
}

async function editOriginal(body, payload) {
  const appId = body.application_id;
  const r = await fetch(`${API}/webhooks/${appId}/${body.token}/messages/@original`, {
    method: "PATCH",
    headers: NOAUTH_HEADERS,
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("editOriginal failed:", r.status, txt);
  }
}

/* ========== OUTPUT SANITIZE (רך) ========== */
const REPLACEMENTS = [
  { re: /\bניג[אה]\b/gi, sub: "אחי" },
  { re: /לך\s+תילחם.+/gi, sub: "עזוב שטויות, בוא נתקדם." },
];
function sanitize(s) {
  let out = String(s || "");
  for (const { re, sub } of REPLACEMENTS) out = out.replace(re, sub);
  return out.trim();
}


/* ========== GEMINI ========== */
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY }); // :contentReference[oaicite:4]{index=4}

async function askGemini(prompt) {
  const models = GEMINI_MODEL_ENV
    ? [GEMINI_MODEL_ENV]
    : [
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
      ]; // :contentReference[oaicite:5]{index=5}

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 9000);

  try {
    let lastErr = "no-model";
    for (const model of models) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt || "",
          config: {
            systemInstruction: FRITZ_SYSTEM_PROMPT, // :contentReference[oaicite:6]{index=6}
            // קיצורי דרך: קצר + מהיר
            maxOutputTokens: 180,                   // :contentReference[oaicite:7]{index=7}
            temperature: 0.6,                       // :contentReference[oaicite:8]{index=8}
            thinkingConfig: { thinkingLevel: "minimal" }, // :contentReference[oaicite:9]{index=9}
          },
        }, { signal: controller.signal });

        clearTimeout(t);
        return (response?.text || "").trim() || "אין לי תשובה כרגע.";
      } catch (e) {
        const msg = (e && (e.message || String(e))) || "";
        if (e?.name === "AbortError") { lastErr = "timeout"; break; }
        lastErr = msg || "unknown";
        // אם מודל ספציפי לא זמין לך, לפעמים זה מתבטא כשגיאה כללית, אז ננסה הבא
        continue;
      }
    }
    clearTimeout(t);
    return `לא הצלחתי להביא תשובה (${lastErr}).`;
  } catch (e) {
    clearTimeout(t);
    return "נפלתי בדרך. נסה שוב.";
  }
}

/* ========== HANDLER ========== */
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return text(405, "Method Not Allowed");
    }

    const sig = event.headers["x-signature-ed25519"];
    const ts  = event.headers["x-signature-timestamp"];
    if (!sig || !ts) return text(401, "Missing signature headers");
    if (!DISCORD_PUBLIC_KEY) return text(500, "Missing DISCORD_PUBLIC_KEY");
    if (!GEMINI_API_KEY) console.warn("WARN: GEMINI_API_KEY is missing");

    const rawBuf = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");

    let verified = false;
    try { verified = await verifyKey(rawBuf, sig, ts, DISCORD_PUBLIC_KEY); } catch {}
    if (!verified) return text(401, "Bad request signature");

    const body = JSON.parse(rawBuf.toString("utf8"));

    // ===== PING =====
    if (body?.type === 1) {
      return json({ type: 1 });
    }

    // ===== SLASH: /ask =====
    if (body?.type === 2 && body?.data?.name === "ask") {
      await deferPublicInteraction(body);

      const prompt = (body.data.options || []).find(o => o.name === "text")?.value || "";
      let answer = "אין לי תשובה כרגע.";

      if (GEMINI_API_KEY) {
        answer = await askGemini(prompt);
      } else {
        answer = "חסר GEMINI_API_KEY בסביבה.";
      }

      answer = sanitize(answer);
      await editOriginal(body, { content: answer });

      return { statusCode: 200, body: "" };
    }

    // ===== SLASH: /fritz-mode =====
    if (body?.type === 2 && body?.data?.name === "fritz-mode") {
      await deferPublicInteraction(body);

      const mode = (body.data.options || []).find(o => o.name === "mode")?.value;
      let content = "Unknown mode.";
      if (mode === "activate")   content = "FRITZ MODE ACTIVATED ✅";
      if (mode === "deactivate") content = "FRITZ MODE DEACTIVATED ❌";

      await editOriginal(body, { content });
      return { statusCode: 200, body: "" };
    }

    // ===== UNKNOWN COMMAND / TYPE =====
    return json({ type: 4, data: { content: "לא יודע מה רצית. תן /ask ומשהו קונקרטי." } });

  } catch (e) {
    console.error("DISCORD_FN_ERR", e && (e.stack || e.message || e));
    return json({ type: 4, data: { content: "קרסתי קלות. עוד ניסיון." } });
  }
}



