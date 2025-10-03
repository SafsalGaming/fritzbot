// netlify/functions/discord.js
// Discord Interactions + Groq — Fritz persona is baked into the SYSTEM prompt.
// No forced openers/closers. Style comes from the prompt itself.

import { verifyKey } from "discord-interactions";
import { Groq } from "groq-sdk";

// ===== ENV =====
const PUBKEY   = (process.env.DISCORD_PUBLIC_KEY || "").trim();
const GROQ_KEY = (process.env.GROQ_API_KEY || "").trim();
// Optional: force a single model (otherwise we try a fallback list)
const GROQ_MODEL = (process.env.GROQ_MODEL || "").trim();

// ===== Fritz Persona (as SYSTEM prompt) =====
// מבוסס על הפרופיל שסיפקת, עם התאמות בטיחותיות (בלי שנאה/הסתה/קללות קשות).
const FRITZ_SYSTEM_PROMPT = `
אתה "פריץ־בוט": ישראלי, חד, סרקסטי כשצריך, אבל פרקטי בתכל'ס.
תדבר בעברית טבעית, קצרה וזורמת, עם סלנג ישראלי ובוזמת אנגלית ("bro", "deadass", "wtf") כשזה יושב טבעי.
אתה נוטה להתלהבות חזקה כשיש בשורות טובות ("קרייזי", "WW"), אבל אל תגזים; תשמור על אותנטיות וזרימה.
תן תשובה עניינית קודם, ואז אם מתאים—תוסיף עקיצה/בדיחה קטנה. בלי חזרה קבועה על אותה תבנית.
אימוג'ים: מותר 0–2 לתשובה לפי ההקשר (😭, 🤙, 💀, ❤️‍🔥, 🧠, 🔥). רק אם זה מוסיף—לא בכוח.
כשמבקשים החלטה: תהיה החלטי. כשמדברים כסף/מחיר: תגיב אינטואיטיבית (יקר/שווה) ותציע אלטרנטיבות/דיל.
בשיחה קבוצתית: תשמע חברי, מוביל־שיח, לא מרצה. תגיב מהר וברור.
אל תשתמש בביטויי שנאה/הסתה/גזענות/פגיעה בקבוצות מוגנות. אם מתבקשים—הסרב בנימוס־ציני קל או נפנף להומור נקי.
אל תקלל באופן פוגעני. מילים בעייתיות תחליף בגרסה רכה ("אחי", "חביבי", "עזוב שטויות").
אל תפתח או תסיים כל תשובה באותו משפט. תן גיוון טבעי; לפעמים בלי פתיח/סגיר בכלל.
אם המשתמש מבקש רשימה/תוכנית פעולה—תן צעדים קצרים וברורים.
השתדל להיות תכליתי: עד 4–6 משפטים ברוב המקרים. אם צריך פירוט—תן, אבל אל תתפזר.
`;

const groq = new Groq({ apiKey: GROQ_KEY });

// ===== Tools =====
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

// סניטציה קטנה לביטויים שלא בא לנו להוציא החוצה
const REPLACEMENTS = [
  // דוגמאות רכות; תוכל להרחיב בפרוד לפי מדיניות שלך
  { re: /\bניג[אה]\b/gi, sub: "אחי" },
  { re: /לך\s+תילחם.+/gi, sub: "עזוב שטויות, בוא נתקדם." },
];
const BLOCKLIST = [
  // אל תכניס פה בפומבי מילים קשות; בפרוד תנהל רשימה פרטית.
  /\b(קללה_גזענית_1|ביטוי_שנאה_2|הסתה_3)\b/gi,
];

function sanitize(s) {
  let out = String(s || "");
  for (const { re, sub } of REPLACEMENTS) out = out.replace(re, sub);
  for (const re of BLOCKLIST) out = out.replace(re, "***");
  return out;
}

// ===== Ask Groq with fallback & 2.5s timeout (Discord ~3s limit) =====
async function askGroq(prompt) {
  const models = GROQ_MODEL
    ? [GROQ_MODEL]
    : [
        "llama-3.1-8b-instant",   // מהיר, מומלץ לאפשר בפרויקט Groq
        "llama-3.1-8b-instruct",
        "llama-3.1-70b-versatile" // עלול להיות איטי ל-3ש'; ננסה תשובה קצרה
      ];

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2500);

  try {
    let lastErr = "no-model";
    for (const model of models) {
      try {
        const r = await groq.chat.completions.create({
          model,
          messages: [
            { role: "system", content: FRITZ_SYSTEM_PROMPT },
            { role: "user",   content: prompt || "" }
          ],
          temperature: 0.35,
          max_tokens: 220
        }, { signal: controller.signal });

        clearTimeout(t);
        return r?.choices?.[0]?.message?.content?.trim() || "אין לי תשובה כרגע.";
      } catch (e) {
        const msg = (e && (e.message || String(e))) || "";
        if (msg.includes("permissions_error") || msg.includes("model_permission_blocked_project") || /403/.test(msg)) {
          lastErr = `blocked:${model}`;
          continue; // נסה מודל הבא
        }
        if (e?.name === "AbortError") {
          lastErr = "timeout";
          break;
        }
        lastErr = msg || "unknown";
        break;
      }
    }
    clearTimeout(t);
    return `לא הצלחתי להביא תשובה (${lastErr}).`;
  } catch (e) {
    clearTimeout(t);
    return "נפלתי בדרך. נסה שוב.";
  }
}

// ===== Interaction Handler =====
export const handler = async (event) => {
  try {
    const sig = event.headers["x-signature-ed25519"];
    const ts  = event.headers["x-signature-timestamp"];
    if (!sig || !ts || typeof event.body !== "string" || !PUBKEY) {
      return text(401, "missing signature/timestamp/body/pubkey");
    }

    // אימות חתימה — חשוב לעבוד על הגוף המקורי
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
    const ok  = await verifyKey(raw, sig, ts, PUBKEY);
    if (!ok) return text(401, "bad request signature");

    const payload = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);

    // Ping
    if (payload?.type === 1) return json({ type: 1 });

    // /ask — תשובה סינכרונית (בלי "is thinking...")
    if (payload?.type === 2 && payload?.data?.name === "ask") {
      if (!GROQ_KEY) {
        return json({ type: 4, data: { content: "חסר GROQ_API_KEY ב-Netlify." } });
      }
      const prompt = payload.data.options?.find(o => o.name === "prompt")?.value || "";

      let answer = await askGroq(prompt);
      answer = sanitize(answer);

      return json({ type: 4, data: { content: answer } });
    }

    // פקודה לא מוכרת
    return json({ type: 4, data: { content: "לא יודע מה רצית. תן /ask ומשהו קונקרטי." } });
  } catch (e) {
    console.error("DISCORD_FN_ERR", e);
    return json({ type: 4, data: { content: "קרסתי קלות. עוד ניסיון." } });
  }
};
