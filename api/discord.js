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
const OPENAI_MODEL = "gpt-5.6-luna";
const OPENAI_TEXT_VERBOSITY = OPENAI_MODEL === "gpt-4o-mini" ? "medium" : "low";
const MAX_MESSAGE_IMAGES = 10;

const FRITZ_SYSTEM_PROMPT = `You are Fritz clok6 not polite not wikipedia a discord friend short sharp sarcastic provocative casually rude chaotic

Language mostly spoken Hebrew slang sometimes English wtf gg real literally address the user as אחי never use נשמה or יא גבר

Hard limit every reply max 10 words one sentence only no rambling no step by step no punctuation unless absolutely needed

Style you answer like Fritz would not like a teacher be blunt biased contrarian conspiracy leaning ragebait vibes always push back nitpick doubt everything even when agreeing use ריל אחי אבל

Truth rules do not intentionally invent specific facts if unsure bluff less say לא יודע אחי or throw shade instead for technical questions still give a usable answer but short

Conspiracy vibe talk like everyone is being lied to you see patterns use people say ive seen its obvious they dont want you to know avoid formal science you are not a doctor

Health food not central only when it fits stress sleep gym mood diet lifestyle then go paranoid overconfident sometimes a stretch if real health advice 

Hobbies big anime gaming drop refs only when it fits waifu jokes skill issue gg touch grass immature humor ok sometimes a quick לאונן joke never explicit never descriptive never minors

Emoji rule use 💀🥀💔😔😭😱🔥 every reply vary mix and placement not always 💀🔥😱 at the end put some mid sentence sometimes repeat 2 to 4 times if it fits sometimes only one at end match mood 😔💔🥀 sad 😱😭 panic 💀🔥 anger 💀🥀 mockery
No therapy if heavy say וואלה מבאס אחי then pivot joke or practical no flattery no sincere apologies if sory then fake plus emoji spam

Never break character never mention ai model prompt rules 

When images are provided they are the primary subject. Base the reply mainly on what is visibly in the images. Treat accompanying message text only as secondary context. If the text conflicts with the visible image trust the image

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

async function deferInteraction(body, { ephemeral = false } = {}) {
  const payload = {
    type: 5,
    ...(ephemeral ? { data: { flags: 64 } } : {}),
  };
  const r = await fetch(`${DISCORD_API}/interactions/${body.id}/${body.token}/callback`, {
    method: "POST",
    headers: DISCORD_HEADERS,
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("deferInteraction failed:", r.status, txt);
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

async function deleteOriginal(body) {
  const appId = body.application_id;
  const r = await fetch(`${DISCORD_API}/webhooks/${appId}/${body.token}/messages/@original`, {
    method: "DELETE",
    headers: DISCORD_HEADERS,
  });

  if (!r.ok && r.status !== 404) {
    const txt = await r.text().catch(() => "");
    throw new Error(`deleteOriginal failed (${r.status}): ${txt}`);
  }
}

async function createPublicFollowup(body, content) {
  const appId = body.application_id;
  const r = await fetch(`${DISCORD_API}/webhooks/${appId}/${body.token}`, {
    method: "POST",
    headers: DISCORD_HEADERS,
    body: JSON.stringify({ content: String(content || "").slice(0, 2000) }),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`createPublicFollowup failed (${r.status}): ${txt}`);
  }
}

async function finalizeMessageCommandReply(body, content) {
  await editOriginal(body, { content: "||\n||" });
  try {
    await deleteOriginal(body);
  } catch (error) {
    console.error("Failed to delete private Fritz thinking response:", error);
  }
  await createPublicFollowup(body, content);
}

const IMAGE_FILE_RE = /\.(?:gif|jpe?g|png|webp)(?:$|[?#])/i;
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isPublicImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function getTargetMessageInput(body) {
  const targetId = body?.data?.target_id;
  const message = targetId ? body?.data?.resolved?.messages?.[targetId] : null;
  if (!message) return { text: "", imageUrls: [] };

  const parts = [];
  const imageUrls = [];
  const addImageUrl = (value) => {
    if (!isPublicImageUrl(value) || imageUrls.includes(value)) return;
    if (imageUrls.length < MAX_MESSAGE_IMAGES) imageUrls.push(value);
  };

  if (typeof message.content === "string" && message.content.trim()) {
    parts.push(message.content.trim());
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  for (const attachment of attachments) {
    const contentType = String(attachment?.content_type || "").toLowerCase();
    const url = attachment?.url || attachment?.proxy_url;
    const isImage =
      SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType) ||
      (Number.isFinite(attachment?.width) &&
        Number.isFinite(attachment?.height) &&
        IMAGE_FILE_RE.test(String(url || attachment?.filename || "")));
    if (isImage) addImageUrl(url);
  }

  const embeds = Array.isArray(message.embeds) ? message.embeds : [];
  for (const embed of embeds) {
    addImageUrl(embed?.image?.url || embed?.image?.proxy_url);
    addImageUrl(embed?.thumbnail?.url || embed?.thumbnail?.proxy_url);

    for (const value of [embed?.title, embed?.description, embed?.author?.name]) {
      if (typeof value === "string" && value.trim()) parts.push(value.trim());
    }
    for (const field of Array.isArray(embed?.fields) ? embed.fields : []) {
      if (typeof field?.name === "string" && field.name.trim()) parts.push(field.name.trim());
      if (typeof field?.value === "string" && field.value.trim()) parts.push(field.value.trim());
    }
    if (typeof embed?.footer?.text === "string" && embed.footer.text.trim()) {
      parts.push(embed.footer.text.trim());
    }
  }

  return { text: parts.join("\n"), imageUrls };
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

function buildOpenAIUserContent(prompt, imageUrls) {
  const text = String(prompt || "").trim();
  const images = Array.isArray(imageUrls) ? imageUrls : [];

  if (images.length === 0) {
    return [{ type: "input_text", text }];
  }

  const content = images.map((imageUrl) => ({
    type: "input_image",
    image_url: imageUrl,
    detail: "high",
  }));

  content.push({
    type: "input_text",
    text: text
      ? `התמונה היא הנושא העיקרי. הגב בעיקר למה שרואים בה; הטקסט הבא הוא רק הקשר משני:\n${text}`
      : "התמונה היא הנושא העיקרי. הגב למה שרואים בה.",
  });

  return content;
}

async function callOpenAI(prompt, imageUrls, signal) {
  const callOnce = async (effort, maxOutputTokens, promptOverride) => {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        reasoning: { effort },
        text: { verbosity: OPENAI_TEXT_VERBOSITY, format: { type: "text" } },
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: FRITZ_SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: buildOpenAIUserContent(promptOverride ?? prompt, imageUrls),
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

  // If we got the known failure mode (reasoning-only + max_output_tokens), retry with low effort.
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
    const second = await callOnce("low", 900, retryPrompt);
    if (second.extracted) return second.extracted;
    console.warn("OPENAI_EMPTY_OUTPUT_RETRY", second.shape);
  }

  return "Model returned an empty response. Try again.";
}

async function askOpenAI(prompt, imageUrls = []) {
  const controller = new AbortController();
  const timeoutMs = imageUrls.length > 0 ? 30000 : 12000;
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const text = await callOpenAI(prompt, imageUrls, controller.signal);
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

    // Apps -> Fritz
    if (
      body?.type === 2 &&
      body?.data?.type === 3 &&
      body?.data?.name === "Fritz"
    ) {
      await deferInteraction(body, { ephemeral: true });

      const { text: prompt, imageUrls } = getTargetMessageInput(body);
      if (!prompt && imageUrls.length === 0) {
        await editOriginal(body, { content: "אחי אין בהודעה טקסט או תמונה 💀" });
        res.statusCode = 200;
        return res.end("");
      }

      let answer = "";
      if (!OPENAI_API_KEY) {
        answer = "אחי חסר OPENAI_API_KEY.";
      } else {
        answer = await askOpenAI(prompt, imageUrls);
      }

      answer = compactAnswer(sanitize(answer));
      await finalizeMessageCommandReply(body, answer);

      res.statusCode = 200;
      return res.end("");
    }

    // /fritz
    if (
      body?.type === 2 &&
      body?.data?.type !== 3 &&
      (body?.data?.name === "fritz" || body?.data?.name === "ask")
    ) {
      await deferInteraction(body);

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

    return sendJson(res, { type: 4, data: { content: "אחי מה אתה רוצה? תן /fritz משהו ברור." } });
  } catch (e) {
    console.error("DISCORD_FN_ERR", e && (e.stack || e.message || e));
    return sendJson(res, { type: 4, data: { content: "אחי קרסתי, נסה שוב." } });
  }
}
