// netlify/functions/discord.js
// Discord Interactions + Groq + Fritz Persona (דינמי, לא חזרתי)
import { verifyKey } from "discord-interactions";
import { Groq } from "groq-sdk";

// ====== ENV ======
const PUBKEY = (process.env.DISCORD_PUBLIC_KEY || "").trim();
const GROQ_KEY = (process.env.GROQ_API_KEY || "").trim();
const groq = new Groq({ apiKey: GROQ_KEY });

// ====== Fritz persona (דינמי לפי הקשר, בלי לחייב פתיח/סגיר כל הודעה) ======
const DICT = {
  hypeOpeners: ["אני מת", "ריל אחי", "WWWW", "קרייזי", "וואלה שוק"],
  neutralOpeners: ["שמע", "אחשלי", "אדוני"],
  closers: [
    "יאללה זזתי לפני שאני מתחרט.",
    "טוב, סגרנו, לא נסתבך.",
    "סגור עניין, ממשיכים.",
    "קיבלתי. זהו, נעלתי.",
    "יאללה, זה חם כמו ג'קוזי."
  ],
  midFlairs: ["deadass", "bro", "wtf", "ריל", "נו בחייאת"],
  emojis: ["😭", "🤙", "💀", "❤️‍🔥", "😮‍💨", "🧠", "🔥", "🫡", "🥲"],
};

const personaSystem = [
  // טון/סגנון מתוך הפרופיל – מתון כדי שלא יחזור על עצמו
  "אתה 'פריץ-בוט': חד, סרקסטי, מתלהב כשצריך, אבל פרקטי בתכל'ס.",
  "תן מענה ענייני ואז פלפל קצר. כתיבה בעברית טבעית עם סלנג ישראלי.",
  "אל תגזים בחזרות. אל תפתח או תסיים כל תשובה באותה תבנית.",
  "שלב מדי פעם מילה באנגלית/אימוג'י, אבל לא בכוח.",
  "אל תכלול קללות/הסתה/גזענות. אם מתבקשות — תחליף בהומור נקי.",
  "כשמבקשים החלטה: תגיד חד. כשמבקשים מחיר/דיל: תתמקח/תציע חלופות.",
  "שמור על זרימה קבוצתית — נשמע חברי, לא הרצאה."
].join("\n");

// ====== בטיחות/סניטציה ======
const BLOCKLIST = [
  // אל תשאיר פה מילים פוגעניות אמיתיות בקוד פומבי. בפרוד תמיר/תטען מרשימה פרטית.
  // כאן רק דוגמאות כלליות:
  /\b(ביטוי_שנאה_1|ביטוי_פוגעני_2|קללה_גזענית_3)\b/gi
];
const REPLACEMENTS = [
  // החלפות “חמות” במקום ביטויים בעייתיים/קיצוניים
  { re: /\bניג[אה]\b/gi, sub: "חביבי" },
  { re: /לך\s+תילחם.+/gi, sub: "די עזוב שטויות, בוא נתרכז." },
];

function sanitize(text) {
  let s = String(text || "");
  for (const { re, sub } of REPLACEMENTS) s = s.replace(re, sub);
  for (const re of BLOCKLIST) s = s.replace(re, "***");
  return s;
}

// ====== סיווג הקשר (ממש בקטנה) ======
function classifyMode(prompt = "") {
  const p = prompt.toLowerCase();
  if (/(מחיר|יקר|שווה|דיל|קנייה|מכרז|הנחה|זול)/.test(p)) return "deal";
  if (/(איך|מה לעשות|לסדר|צעד|שלבים|תוכנית|תוכנית פעולה|תוכנית עבודה)/.test(p)) return "pragmatic";
  if (/(מטורף|לא מאמין|וואו|קרייזי|תותח|W+)/i.test(p)) return "hype";
  if (/(וויכוח|מחלוקת|לא בטוח|לדעתי|דעה)/.test(p)) return "snark";
  return "neutral";
}

// ====== עיצוב דינמי של התשובה ======
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function maybe(prob) { return Math.random() < prob; }

function styleFritz(base, mode) {
  let out = (base || "").trim();
  if (!out) return "אין לי תשובה כרגע.";

  // אל תיגע בתשובת קוד
  if (out.startsWith("```")) return out;

  // לפעמים משפט פתיחה קצר — לא תמיד
  const openerProb = { hype: 0.6, deal: 0.25, pragmatic: 0.2, snark: 0.35, neutral: 0.25 }[mode] || 0.25;
  const closerProb = { hype: 0.45, deal: 0.35, pragmatic: 0.3, snark: 0.4, neutral: 0.3 }[mode] || 0.3;
  const midProb    = { hype: 0.5,  deal: 0.35, pragmatic: 0.25, snark: 0.35, neutral: 0.3 }[mode] || 0.3;

  const openerPool = mode === "hype" ? DICT.hypeOpeners : DICT.neutralOpeners;

  let parts = [];
  if (maybe(openerProb)) {
    const em = maybe(0.6) ? ` ${rand(DICT.emojis)}` : "";
    parts.push(`${rand(openerPool)}${em}`);
  }

  // הזרקת פלייר באמצע טקסט (בלי להרוס תוכן)
  let text = out;
  if (maybe(midProb)) {
    const flair = `${maybe(0.7) ? rand(DICT.emojis) + " " : ""}${rand(DICT.midFlairs)}`;
    // הכנס אחרי המשפט הראשון אם יש נקודה
    const idx = text.indexOf(".");
    if (idx > 0 && idx < 200) {
      text = `${text.slice(0, idx + 1)} ${flair}. ${text.slice(idx + 1).trim()}`;
    } else {
      text = `${flair}. ${text}`;
    }
  }
  parts.push(text);

  if (maybe(closerProb)) {
    parts.push(`${maybe(0.6) ? rand(DICT.emojis) + " " : ""}${rand(DICT.closers)}`);
  }

  // לא לחפור: חותכים אם ארוך מדי
  const final = parts.join("\n").trim();
  return final.length > 1200 ? final.slice(0, 1190) + "…" : final;
}

// ====== Groq (ניסיון בכמה מודלים + timeout 2.5s) ======
async function askGroqPersona(prompt) {
  const models = [
    "llama-3.1-8b-instant",
    "llama-3.1-8b-instruct",
    "llama-3.1-70b-versatile" // שים לב: עלול להיות איטי
  ];

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 2500);

  try {
    let lastErr = "no model";
    for (const model of models) {
      try {
        const r = await groq.chat.completions.create({
          model,
          messages: [
            { role: "system", content: personaSystem },
            { role: "user", content: prompt || "" },
          ],
          temperature: 0.35,
          max_tokens: 220
        }, { signal: controller.signal });

        clearTimeout(to);
        const content = r?.choices?.[0]?.message?.content?.trim() || "אין לי תשובה כרגע.";
        return content;
      } catch (e) {
        const msg = (e && (e.message || `${e}`)) || "";
        if (/403/.test(msg) || msg.includes("permissions_error") || msg.includes("model_permission_blocked_project")) {
          lastErr = `המודל חסום (${model})`; 
          continue; // ננסה הבא
        }
        if (e?.name === "AbortError") { lastErr = "timeout"; break; }
        lastErr = msg || "unknown";
        break;
      }
    }
    clearTimeout(to);
    return `לא הצלחתי להביא תשובה (${lastErr}).`;
  } catch (e) {
    clearTimeout(to);
    return "נפלתי בדרך. נסה שוב.";
  }
}

// ====== HTTP helpers ======
const json = (obj) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
const text = (code, body) => ({ statusCode: code, headers: { "Content-Type": "text/plain" }, body });

// ====== Discord Interaction Handler ======
export const handler = async (event) => {
  try {
    const sig = event.headers["x-signature-ed25519"];
    const ts  = event.headers["x-signature-timestamp"];
    if (!sig || !ts || typeof event.body !== "string" || !PUBKEY) {
      return text(401, "missing signature/timestamp/body/pubkey");
    }

    // אימות חתימה (חייבים להשתמש בגוף המקורי)
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
    const ok = await verifyKey(raw, sig, ts, PUBKEY);
    if (!ok) return text(401, "bad request signature");

    const payload = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);

    // Ping
    if (payload?.type === 1) return json({ type: 1 });

    // /ask — תשובה סינכרונית (בלי "is thinking")
    if (payload?.type === 2 && payload?.data?.name === "ask") {
      if (!GROQ_KEY) {
        return json({ type: 4, data: { content: "חסר GROQ_API_KEY ב-Netlify." } });
      }
      const prompt = payload.data.options?.find(o => o.name === "prompt")?.value || "";
      const mode = classifyMode(prompt);

      let base = await askGroqPersona(prompt);
      base = sanitize(base);
      const styled = styleFritz(base, mode);

      return json({ type: 4, data: { content: styled } });
    }

    // פקודה לא מוכרת
    return json({ type: 4, data: { content: "לא יודע מה רצית. זרוק /ask ועוד מילה." } });
  } catch (e) {
    console.error("DISCORD_FN_ERR", e);
    return json({ type: 4, data: { content: "קרסתי קלות. עוד ניסיון." } });
  }
};
