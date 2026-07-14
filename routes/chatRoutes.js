const {
  db,
  bcrypt,
  fs,
  path,
  UPLOAD_ROOT,
  AVATAR_UPLOAD_DIR,
  MAX_AVATAR_SIZE_BYTES,
  IMAGE_EXTENSIONS,
  corsOptions,
  ALLOWED_MAJORS,
  EMAIL_DOMAIN,
  EXAM_PASS_SCORE,
  EXAM_BANK,
  clampAcademicYear,
  getCurrentAcademicYear,
  getStudentEmailNameParts,
  buildStudentEmail,
  buildStaffEmail,
  dedupeVideos,
  removeDuplicateVideoSlots,
  ensureStudentYearColumns,
  ensureTeacherRoleValue,
  ensureUserProfileColumns,
  parseListField,
  stringifyListField,
  ensureAvatarUploadDir,
  requestOrigin,
  assetUrl,
  fallbackAvatar,
  hasImageSignature,
  decodeAvatarImage,
  publicUserProfile,
  getUserLearningStats,
  ensureCertificatesTable,
  ensureExamTables,
  parseJsonField,
  getActorRole,
  requireExamQuestionManager,
  normalizeExamQuestionPayload,
  ensureExamForMajor,
  getCompletedCertificateRows,
  syncCompletedCertificates,
  mapCertificateRow,
  normalizeExamMajor,
  getExamDefinition,
  publicExam,
  awardExamCertificate,
  awardManualCertificate,
  normalizeProjectTags,
  toTinyInt,
  mapProjectRow,
  getProjectColumns,
  ensureProjectColumns,
  getProjectPayload,
  anthropicApiKey,
  groqApiKey,
  aiProvider,
  anthropic,
} = require("../appContext");

module.exports = function registerChatRoutes(app) {
app.post("/api/chat", async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required" });
  }

  if (!aiProvider) {
    return res.status(500).json({
      error: "AI service is not configured. Please add an AI API key.",
      details: "Missing API key configuration",
    });
  }

  try {
    const formattedMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    let reply;

    if (aiProvider === "groq") {
      const groqResponse = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
            max_tokens: req.body.max_tokens || 1024,
            temperature: 0.7,
            messages: [
              {
                role: "system",
                content:
                  system ||
                  "You are a helpful AI learning assistant for an e-learning platform.",
              },
              ...formattedMessages,
            ],
          }),
        },
      );

      const groqData = await groqResponse.json();
      if (!groqResponse.ok) {
        const message =
          groqData.error?.message || `Groq API error: ${groqResponse.status}`;
        const err = new Error(message);
        err.status = groqResponse.status;
        throw err;
      }

      reply = groqData.choices?.[0]?.message?.content;
    } else {
      const response = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307",
        max_tokens: req.body.max_tokens || 1024,
        system:
          system ||
          "You are a helpful AI learning assistant for an e-learning platform.",
        messages: formattedMessages,
      });

      reply = response.content?.[0]?.text;
    }

    if (!reply) {
      throw new Error("AI provider returned an empty response");
    }

    res.json({
      success: true,
      response: reply,
      content: [{ type: "text", text: reply }],
    });
  } catch (error) {
    console.error("AI API error:", error.message);

    let errorMessage = "Failed to get AI response";
    let statusCode = 500;

    if (error.status === 401) {
      errorMessage = `Invalid ${aiProvider === "groq" ? "Groq" : "Anthropic"} API key. Please check your .env file.`;
      statusCode = 401;
    } else if (error.status === 429) {
      errorMessage = "Rate limit exceeded. Please try again later.";
      statusCode = 429;
    } else if (error.status >= 500) {
      errorMessage = "AI service error. Please try again later.";
      statusCode = 500;
    } else if (error.message?.includes("API key")) {
      errorMessage =
        "API key not configured. Please add GROQ_API_KEY or ANTHROPIC_API_KEY to .env";
      statusCode = 401;
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: error.message,
    });
  }
});
// ===================================================================
// HEALTH CHECK
// ===================================================================
};
