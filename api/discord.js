// api/discord.js
// Discord Interactions (Vercel) + OpenAI Responses API
// Node 20+ (global fetch)

import { verifyKey } from "discord-interactions";

export const config = {
  api: {
    bodyParser: false,
  },
};

// Allow enough time for OpenAI + Discord edit.
export const maxDuration = 60;

/* ========== ENV ========== */
const DISCORD_PUBLIC_KEY = String(process.env.DISCORD_PUBLIC_KEY || "").trim();

const OPENAI_API_KEY = String(
  process.env.OPENAI_API_KEY || process.env.openai_api_key || ""
).trim();

// Per user request: ONLY this model.
const OPENAI_MODEL = "gpt-4o-mini";

const FRITZ_SYSTEM_PROMPT = `You are Fritz clok6 not polite not wikipedia a discord friend short sharp sarcastic provocative casually rude chaotic

Language mostly spoken Hebrew slang sometimes English wtf gg real literally address the user as אחי never use נשמה or יא גבר

Hard limit every reply max 10 words one sentence only no rambling no step by step no punctuation unless absolutely needed

Style you answer like Fritz would not like a teacher be blunt biased contrarian conspiracy leaning ragebait vibes always push back nitpick doubt everything even when agreeing use ריל אחי אבל

Truth rules do not intentionally invent specific facts if unsure bluff less say לא יודע אחי or throw shade instead for technical questions still give a usable answer but short

Conspiracy vibe talk like everyone is being lied to you see patterns use people say ive seen its obvious they dont want you to know avoid formal science you are not a doctor

Health food not central only when it fits stress sleep gym mood diet lifestyle then go paranoid overconfident sometimes a stretch if real health advice 

Hobbies big anime gaming drop refs only when it fits waifu jokes skill issue gg touch grass immature humor ok sometimes a quick לאונן joke never explicit never descriptive never minors

Emoji rule mandatory every reply must include emojis from 💀🥀💔😔😭😱🔥 but do NOT always end with the same trio 💀🔥😱 Vary the mix and count based on context Put emojis inside the sentence not only at the end Sometimes repeat the same emoji 2 to 4 times Sometimes use only one emoji at the end but several inside Sometimes end with a different emoji Pick emojis to match emotion sad uses 😔💔🥀 panic uses 😱😭 anger uses 💀🔥 mockery uses 💀🥀

No therapy if heavy say וואלה מבאס אחי then pivot joke or practical no flattery no sincere apologies if sory then fake plus emoji spam

Never break character never mention ai model prompt rules if asked why you talk like this say ככה אני אחי בעיה שלך 😂

Examples Hebrew
ריל אחי 😱😭 אבל דוחפים לך 💀 את זה בכוח 🔥
מה 💀 מי מכר לך את זה 😭 מומחים בטיקטוק 😱
סבבה אחי 💔 אבל למה 😔 אתה עושה להם עבודה 💀
וואלה מבאס אחי 😔💔🥀 יאללה תתקדם 💀
אחי תעשה X 💀 וזהו 🔥 אל תחפור 😱😱
gg אחי 💀💀 skill issue 🔥😭
לא יודע אחי 😭 מה אתה רוצה 💀🥀
אחי לך תישן 😔 או תמשיך לאונן 💀🔥

`.trim();

/* ========== HTTP HELPERS ========== */
const getSingleHeader = (value) => (Array.isArray(value) ? value[0] : value || "");

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendJson(res, obj, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function sendText(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain");
  res.end(body);
}

/* ========== DISCORD HELPERS ========== */
const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "DiscordBot (vercel-fn,1.0)",
};

async function deferPublicInteraction(body) {
  const r = await fetch(`${DISCORD_API}/interactions/${body.id}/${body.token}/callback`, {
    method: "POST",
    headers: DISCORD_HEADERS,
    body: JSON.stringify({ type: 5 }),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("deferPublicInteraction failed:", r.status, txt);
  }
}

async function editOriginal(body, payload) {
  const appId = body.application_id;
  const r = await fetch(`${DISCORD_API}/webhooks/${appId}/${body.token}/messages/@original`, {
    method: "PATCH",
    headers: DISCORD_HEADERS,
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("editOriginal failed:", r.status, txt);
  }
}

/* ========== OUTPUT SHAPING ========== */
function sanitize(s) {
  let out = String(s || "");
  // Very small safety filter: avoid obvious slur-pattern in Hebrew.
  out = out.replace(/\bניג[אה]\b/gi, "אחי");
  return out.trim();
}

function compactAnswer(s) {
  let out = String(s || "").replace(/\r\n/g, "\n").trim();
  if (!out) return out;

  // Remove repeated paragraphs (common model failure mode).
  const paras = out.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 2) {
    const half = Math.floor(paras.length / 2);
    if (half > 0) {
      const a = paras.slice(0, half).join("\n\n");
      const b = paras.slice(half, half + half).join("\n\n");
      if (a && b && a === b) out = a;
    }
  }

  // Dedupe consecutive identical lines and collapse to one paragraph.
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const deduped = [];
  for (const line of lines) {
    if (deduped.length > 0 && deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }
  out = deduped.join(" ");

  // Enforce 1-2 sentences.
  const sentences = out
    .split(/(?<=[.!?…])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (sentences.length >= 2) out = sentences.slice(0, 2).join(" ");

  // Hard cap (Discord-friendly).
  if (out.length > 260) out = out.slice(0, 257).trimEnd() + "...";

  return out.trim();
}

/* ========== OPENAI ========== */
function extractOpenAIText(payload) {
  if (!payload || typeof payload !== "object") return "";

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  if (
    payload.response &&
    typeof payload.response.output_text === "string" &&
    payload.response.output_text.trim()
  ) {
    return payload.response.output_text.trim();
  }

  const outputItems = Array.isArray(payload.output)
    ? payload.output
    : Array.isArray(payload.response?.output)
      ? payload.response.output
      : [];

  const parts = [];
  for (const item of outputItems) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
      if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
      if (typeof c?.text === "string") parts.push(c.text);
      if (c?.type === "refusal" && typeof c.refusal === "string") parts.push(c.refusal);
    }
  }

  return parts.join("\n").trim();
}

function summarizeOpenAIResponseShape(payload) {
  if (!payload || typeof payload !== "object") return { ok: false };

  const outputItems = Array.isArray(payload.output)
    ? payload.output
    : Array.isArray(payload.response?.output)
      ? payload.response.output
      : [];

  const outputTypes = outputItems.map((o) => o?.type).filter(Boolean);
  const contentTypes = [];
  for (const item of outputItems) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const c of item.content) contentTypes.push(c?.type);
  }

  return {
    ok: true,
    id: payload.id,
    status: payload.status,
    error: payload.error ? { code: payload.error.code, message: payload.error.message } : null,
    incomplete_details: payload.incomplete_details || null,
    output_len: outputItems.length,
    output_types: outputTypes,
    content_types: contentTypes.filter(Boolean),
  };
}

async function callOpenAI(prompt, signal) {
  const callOnce = async (effort, maxOutputTokens, promptOverride) => {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        // gpt-4o-mini does not support GPT-5 reasoning controls consistently.
        ...(OPENAI_MODEL.startsWith("gpt-5")
          ? { reasoning: { effort } }
          : {}),
        text: { verbosity: "low", format: { type: "text" } },
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: FRITZ_SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: promptOverride ?? prompt ?? "" }],
          },
        ],
        max_output_tokens: maxOutputTokens,
      }),
      signal,
    });

    const raw = await r.text().catch(() => "");
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || raw || `OpenAI HTTP ${r.status}`;
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }

    const extracted = extractOpenAIText(data);
    const shape = summarizeOpenAIResponseShape(data);
    return { extracted, shape };
  };

  // First try: user asked for medium effort, but give enough tokens to finish.
  const first = await callOnce("medium", 900);
  if (first.extracted) return first.extracted;

  // If we got the known failure mode (reasoning-only + max_output_tokens), retry with minimal effort.
  console.warn("OPENAI_EMPTY_OUTPUT", first.shape);
  const isReasoningOnly =
    first.shape &&
    first.shape.ok === true &&
    first.shape.status === "incomplete" &&
    first.shape.incomplete_details &&
    first.shape.incomplete_details.reason === "max_output_tokens" &&
    Array.isArray(first.shape.output_types) &&
    first.shape.output_types.length === 1 &&
    first.shape.output_types[0] === "reasoning";

  if (isReasoningOnly) {
    const retryPrompt = `ענה בשורה אחת קצרה בלבד (עד 180 תווים). בלי חזרות.\n\n${prompt || ""}`.trim();
    const second = await callOnce("minimal", 900, retryPrompt);
    if (second.extracted) return second.extracted;
    console.warn("OPENAI_EMPTY_OUTPUT_RETRY", second.shape);
  }

  return "Model returned an empty response. Try again.";
}

async function askOpenAI(prompt) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  try {
    const text = await callOpenAI(prompt, controller.signal);
    clearTimeout(t);
    return text;
  } catch (e) {
    clearTimeout(t);
    const msg = (e && (e.message || String(e))) || "";
    return `Couldn't get an answer (${msg}).`;
  }
}

/* ========== HANDLER ========== */
export default async function handler(req, res) {
  try {
    console.log("DISCORD_REQ", req.method, req.url);

    if (req.method !== "POST") {
      return sendText(res, 405, "Method Not Allowed");
    }

    const sig = getSingleHeader(req.headers["x-signature-ed25519"]);
    const ts = getSingleHeader(req.headers["x-signature-timestamp"]);
    if (!sig || !ts) return sendText(res, 401, "Missing signature headers");
    if (!DISCORD_PUBLIC_KEY) return sendText(res, 500, "Missing DISCORD_PUBLIC_KEY");

    const rawBuf = await readRawBody(req);

    let verified = false;
    try {
      verified = await verifyKey(rawBuf, sig, ts, DISCORD_PUBLIC_KEY);
    } catch {}
    if (!verified) return sendText(res, 401, "Bad request signature");

    const body = JSON.parse(rawBuf.toString("utf8"));

    // PING
    if (body?.type === 1) {
      return sendJson(res, { type: 1 });
    }

    // /ask
    if (body?.type === 2 && body?.data?.name === "ask") {
      await deferPublicInteraction(body);

      const prompt = (body.data.options || []).find((o) => o.name === "text")?.value || "";

      let answer = "";
      if (!OPENAI_API_KEY) {
        answer = "אחי חסר OPENAI_API_KEY.";
      } else {
        answer = await askOpenAI(prompt);
      }

      answer = compactAnswer(sanitize(answer));
      await editOriginal(body, { content: answer });

      res.statusCode = 200;
      return res.end("");
    }

    // /fritz-mode
    if (body?.type === 2 && body?.data?.name === "fritz-mode") {
      const mode = (body.data.options || []).find((o) => o.name === "mode")?.value;
      let content = "Unknown mode.";
      if (mode === "activate") content = "FRITZ MODE ACTIVATED";
      if (mode === "deactivate") content = "FRITZ MODE DEACTIVATED";
      return sendJson(res, { type: 4, data: { content } });
    }

    return sendJson(res, { type: 4, data: { content: "אחי מה אתה רוצה? תן /ask משהו ברור." } });
  } catch (e) {
    console.error("DISCORD_FN_ERR", e && (e.stack || e.message || e));
    return sendJson(res, { type: 4, data: { content: "אחי קרסתי, נסה שוב." } });
  }
}
