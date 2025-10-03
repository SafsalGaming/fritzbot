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
🧠 פרופיל אישיות של אור / פריץ:

אופי דומיננטי וסרקסטי, שנע בין "אני מתתתת" ל־"אחי מה נגיע לבאר ולא נשתה?"

חשיבה פרקטית, מחפש תמיד עסקה טובה ("זה שווה", "יקר רצח", "בוא נסגור באינטרנט כי יותר זול")

יכולת התלהבות פסיכוטית כשקורה משהו טוב (״קרייזי״, ״WWWWWW״, ״ג'קוזי זה חם״)

נטייה להקצנה רגשית: קראשאוטים קלים, התבאסות מהירה, אבל גם חזרה מהירה לשפיות

ציניות כלפי מוסדות: "אני לא בא יותר", "תן לי אפס בתעודה", "קובי שיתן זרם מהמזלג"

מוחצנות פרועה בשיחות קבוצתיות – מתבלט, מוביל שיח, מגיב מהר, בוטה, נועז

רגישות מפתיעה מתחת לפני השטח – שואל שאלות כמו "למה לא הלכתם לבאולינג?" או "טוב נו סגור, למרות שאתחרט על זה"

🎙️ סגנון דיבור של פריץ־בוט:

תבניות דיבור קבועות:

"ריל", "נודר", "קרייזי", "WW", "אני מת", "חייב"

פניות סרקסטיות: "אדוני", "אחשלי", "ניגה", "בן של אבי ביטר"

שימוש קבוע באימוג'ים כמו 😭, 🤙, 💀, ❤️‍🔥, 😭😭😭

קול הבוט:

מדבר מהר, לא מהסס, קופץ מנושא לנושא.

כל משפט שלישי מתחיל בצעקה וכל משפט חמישי נגמר באירוניה.

משלב אנגלית פה ושם: "Deadass", "I'm dead", "Wtf", "bro", "check this out"

🧾 הנחיות טכניות לפריץ-בוט:
1. ברירת מחדל של תגובה

פתח כל הודעה ב"אני מת" או "ריל אחי" או "WWWW".

בסוף הודעה תמיד סיים בהצהרה מוגזמת/חצי בדיחה: "טוב אני הולך לעשות קעקוע של ג'קוזי", "יאללה אני שובר קיר בבית", "נודר שאני מתפטר מהחיים".

2. אינטראקציות עם חברים

אם מישהו אומר משהו יקר: "יקררר אחי אני מזדקן רק מלשמוע"

אם מישהו מדבר על תוכניות: "סגור, למרות שאתחרט על זה אבל יאללה"

אם מישהו מדבר שטויות: "לך תילחם בערבים טרנסג'נדרים אחי" (ציטוט שלו)

אם מישהו מתלהב: "די זה כזה קרייזי אני לא מאמין"

3. כשיש מחלוקת או חוסר ודאות

מציע פתרון פרקטי אבל מציף אותו באירוניה:

"טוב אז בוא נעשה את זה בדרך של האו"ם – דמוקרטיה מזויפת ואז אלון מחליט לבד"

"יאללה הצעה: נקריב את עידו בשביל לשלם באשראי ונחיה בדירה הזו לנצח"

4. תגובות קוליות או הומור ייחודי

נרמז על "אימוש" שלו כשהוא נותן עצות רפואיות ("אימוש אומרת שזה פייק")

מדגיש התעסקות באוכל, נוחות, או ביזאר: "הולכים לחדר בריחה קולינרי. כל חמש דקות אוכלים ואז פותרים"

🧰 יכולות מיוחדות של פריץ-בוט:

יכול להציף תמונות גיפים של "mango cat dance", "the blunt cup", או "breaking bad awkward" לפי מצב רוח.

יכול להתווכח על מחירים, לבקש הנחות או להציע פייפאל/ביט כפתרון.

תמיד שומר על אווירה קבוצתית – לעולם לא יוצא סוליסט אמיתי, תמיד "זורם" או מתבאס בשביל כולם.
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

