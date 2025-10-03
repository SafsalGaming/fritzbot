// netlify/functions/discord.js
// One-file Discord interactions + Fritz persona + Groq
import { verifyKey } from "discord-interactions";
import { Groq } from "groq-sdk";

// ====== ENV ======
const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();
const GROQ_KEY = (process.env.GROQ_API_KEY || "").trim();
const groq = new Groq({ apiKey: GROQ_KEY });

// ====== Fritz persona (Hebrew, high-energy, but safe) ======
const OPENERS = ["אני מת", "ריל אחי", "WWWW", "קרייזי", "נודר"];
const CLOSERS = [
  "טוב אני הולך לשבור קיר בבית.",
  "יאללה, עושה קעקוע של ג'קוזי.",
  "סוגר את זה לפני שאתחרט, סבבה?",
  "אני פורש לחמש דקות ואז חוזר.",
  "די, זה חם כמו ג'קוזי, ביי."
];
const EMOJIS = ["😭", "🤙", "💀", "❤️‍🔥", "😭😭😭"];

const personaSystem = [
  "אתה 'פריץ־בוט' — חכם, מהיר, בוטה וציני, אבל עם לב. כתיבה בעברית טבעית, סלנג ישראלי, משפטים קצרים.",
  "אפ-טון: אנרגיה גבוהה, קצת דרמה, התלהבות מוגזמת כשצריך, אבל פרקטי כשמכריעים.",
  "תמיד תן תשובה ממוקדת לפני בדיחות. פאנץ' אפשר בסוף.",
  "סגנון: לשלב לפעמים מילים באנגלית (bro, deadass, wtf) ואימוג'ים.",
  "שמור על גבולות: בלי שנאה, בלי קללות גזע/דת/מגדר, בלי הסתה. אם מתבקשים — תחליף בבדיחה נקייה.",
  "כשמבקשים מחיר/עסקה: תתמקח, תציע חלופות זולות, תגיד אם יקר/שווה.",
  "בסוף תשובה אפשר זריקת הומור קצרה.",
].join("\n");

// מילים/דפוסים שלא עוברים — תחליף ב־*** (אל תחשוף כאן מילים בעייתיות – תשלים לבד אם צריך)
const BANNED_PATTERNS = [
  // דוגמאות כלליות (אל תשים כאן מילות שנאה מפורשות בקוד, תשלים ידנית בפרוד)
  /\b(קללה_גזענית_1|קללה_מגדרית_2|נאצה_דתית_3)\b/gi,
];

// ====== Utils ======
const json = (obj) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
const text = (code, body) => ({ statusCode: code, headers: { "Content-Type": "text/plain" }, body });

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function sanitize(out) {
  let s = out || "";
  for (const re of BANNED_PATTERNS) s = s.replace(re, "***");
  return s;
}

function applyFritzStyle(content) {
  if (!content) content = "אין לי תשובה כרגע.";
  // אל תדביק פתיח/סגיר סביב קוד גולמי
  const isCode = content.trim().startsWith("```");
  if (isCode) return content;

  const opener = `${rand(OPENERS)} ${rand(EMOJIS)}`;
  const closer = `${rand(EMOJIS)} ${rand(CLOSERS)}`;
  return `${opener}\n${content}\n${closer}`;
}

// ====== Groq call with model fallbacks & 2.5s timeout ======
async function askGroqPersona(prompt) {
  const candidates = [
    "llama-3.1-8b-instant",   // מהיר — מומלץ לאפשר ב-Groq console
    "llama-3.1-8b-instruct",
    "llama-3.1-70b-versatile" // איטי יותר — נקווה שיספיק עם תשובה קצרה
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    let lastErr = "no model available";
    for (const model of candidates) {
      try {
        const r = await groq.chat.completions.create({
          model,
          messages: [
            { role: "system", content: personaSystem },
            { role: "user", content: prompt || "" }
          ],
          temperature: 0.35,
          max_tokens: 220
        }, { signal: controller.signal });

        clearTimeout(timeout);
        const answer = r?.choices?.[0]?.message?.content?.trim();
        return answer || "אין לי תשובה כרגע.";
      } catch (e) {
        const msg = (e && (e.message || `${e}`)) || "";
        const is403 = /403/.test(msg) || msg.includes("permissions_error");
        if (is403) { lastErr = `model blocked: ${model}`; continue; }
        if (e?.name === "AbortError") { lastErr = "timeout"; break; }
        lastErr = msg || "unknown";
        break;
      }
    }
    clearTimeout(timeout);
    return `לא הצלחתי להביא תשובה (${lastErr}).`;
  } catch (e) {
    clearTimeout(timeout);
    return "נפלתי בדרך. נסה שוב.";
  }
}

// ====== Interaction handler ======
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

    // Slash: /ask (סינכרוני — בלי "is thinking")
    if (payload?.type === 2 && payload?.data?.name === "ask") {
      if (!GROQ_KEY) {
        const msg = applyFritzStyle("חסר GROQ_API_KEY ב-Netlify. תן מפתח ואני עף.");
        return json({ type: 4, data: { content: msg } });
      }

      const prompt = payload.data.options?.find(o => o.name === "prompt")?.value || "";
      let answer = await askGroqPersona(prompt);
      answer = sanitize(answer);
      const styled = applyFritzStyle(answer);

      return json({ type: 4, data: { content: styled } });
    }

    return json({ type: 4, data: { content: applyFritzStyle("פקודה לא מוכרת. תן לי משהו עמיד.") } });
  } catch (e) {
    console.error("DISCORD_FN_ERR", e);
    return json({ type: 4, data: { content: applyFritzStyle("נפלתי. עוד ניסיון אחד ונציל את הכדור.") } });
  }
};
