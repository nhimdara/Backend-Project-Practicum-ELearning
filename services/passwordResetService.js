const crypto = require("crypto");

const OTP_TTL_MS = 10 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const resetRequests = new Map();

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const hashOtp = (email, otp) => crypto
  .createHmac("sha256", process.env.OTP_SECRET || process.env.DB_PASSWORD || "local-reset-secret")
  .update(`${email}:${otp}`)
  .digest("hex");

async function issuePasswordResetOtp(email) {
  const normalizedEmail = normalizeEmail(email);
  const current = resetRequests.get(normalizedEmail);
  if (current && Date.now() - current.requestedAt < REQUEST_COOLDOWN_MS) {
    const error = new Error("Please wait one minute before requesting another code.");
    error.status = 429;
    throw error;
  }

  const otp = String(process.env.DEMO_RESET_OTP || "123456").padStart(6, "0").slice(0, 6);
  resetRequests.set(normalizedEmail, {
    otpHash: hashOtp(normalizedEmail, otp),
    expiresAt: Date.now() + OTP_TTL_MS,
    requestedAt: Date.now(),
    attempts: 0,
    verified: false,
  });

  return otp;
}

function verifyPasswordResetOtp(email, otp, consume = false) {
  const normalizedEmail = normalizeEmail(email);
  const entry = resetRequests.get(normalizedEmail);
  if (!entry || entry.expiresAt < Date.now()) {
    resetRequests.delete(normalizedEmail);
    return { valid: false, error: "This code is invalid or has expired." };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    resetRequests.delete(normalizedEmail);
    return { valid: false, error: "Too many incorrect attempts. Request a new code." };
  }
  const expected = Buffer.from(entry.otpHash, "hex");
  const received = Buffer.from(hashOtp(normalizedEmail, String(otp || "")), "hex");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    entry.attempts += 1;
    return { valid: false, error: "The verification code is incorrect." };
  }
  entry.verified = true;
  if (consume) resetRequests.delete(normalizedEmail);
  return { valid: true };
}

module.exports = { normalizeEmail, issuePasswordResetOtp, verifyPasswordResetOtp };
