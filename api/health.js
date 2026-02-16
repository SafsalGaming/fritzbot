export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
  }

  const hasDiscordPublicKey = Boolean((process.env.DISCORD_PUBLIC_KEY || "").trim());
  const hasOpenAIKey = Boolean(
    (process.env.OPENAI_API_KEY || process.env.openai_api_key || "").trim()
  );
  const hasOpenAIModel = Boolean(
    (process.env.OPENAI_MODEL || process.env.openai_model || "").trim()
  );

  const runtimeMissing = [];
  if (!hasDiscordPublicKey) runtimeMissing.push("DISCORD_PUBLIC_KEY");
  if (!hasOpenAIKey) runtimeMissing.push("OPENAI_API_KEY (or openai_api_key)");

  const hasAppId = Boolean(
    (process.env.DISCORD_APP_ID ||
      process.env.DISCORD_APPLICATION_ID ||
      process.env.APP_ID ||
      "").trim()
  );
  const hasBotToken = Boolean((process.env.DISCORD_BOT_TOKEN || "").trim());
  const hasClientCreds = Boolean(
    (process.env.DISCORD_CLIENT_ID || "").trim() &&
      (process.env.DISCORD_CLIENT_SECRET || "").trim()
  );
  const registrationReady = hasAppId && (hasBotToken || hasClientCreds);

  const registrationMissing = [];
  if (!hasAppId) {
    registrationMissing.push("DISCORD_APP_ID / DISCORD_APPLICATION_ID / APP_ID");
  }
  if (!hasBotToken && !hasClientCreds) {
    registrationMissing.push("DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID+DISCORD_CLIENT_SECRET");
  }

  res.statusCode = runtimeMissing.length === 0 ? 200 : 500;
  res.setHeader("Content-Type", "application/json");
  return res.end(
    JSON.stringify(
      {
        ok: runtimeMissing.length === 0,
        runtime: {
          missing: runtimeMissing,
          checks: {
            DISCORD_PUBLIC_KEY: hasDiscordPublicKey,
            OPENAI_API_KEY_OR_openai_api_key: hasOpenAIKey,
            OPENAI_MODEL_OR_openai_model: hasOpenAIModel,
          },
        },
        registration: {
          ready: registrationReady,
          missing: registrationMissing,
          note: "Needed only if you run command registration.",
        },
        model: "gpt-5-nano",
      },
      null,
      2
    )
  );
}
