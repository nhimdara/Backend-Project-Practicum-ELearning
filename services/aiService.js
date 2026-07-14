const Anthropic = require("@anthropic-ai/sdk");

const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
const groqApiKey =
  process.env.GROQ_API_KEY?.trim() ||
  (anthropicApiKey?.startsWith("gsk_") ? anthropicApiKey : "");
const aiProvider = groqApiKey
  ? "groq"
  : anthropicApiKey
    ? "anthropic"
    : null;

if (!aiProvider) {
  console.error("AI chat is missing an API key");
  console.error("Please add GROQ_API_KEY or ANTHROPIC_API_KEY to .env");
}

const anthropic =
  aiProvider === "anthropic"
    ? new Anthropic({
        apiKey: anthropicApiKey,
      })
    : null;

// ===================================================================
// AI CHAT ENDPOINT
// ===================================================================

module.exports = { anthropicApiKey, groqApiKey, aiProvider, anthropic };
