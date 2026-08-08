const test = require("node:test");
const assert = require("node:assert/strict");
const { issuePasswordResetOtp, verifyPasswordResetOtp } = require("../services/passwordResetService");

test("demo reset OTP is one-time and rejects incorrect codes", async () => {
  const email = `student-${Date.now()}@example.com`;
  const otp = await issuePasswordResetOtp(email);
  assert.equal(verifyPasswordResetOtp(email, "000000").valid, false);
  assert.equal(verifyPasswordResetOtp(email, otp).valid, true);
  assert.equal(verifyPasswordResetOtp(email, otp, true).valid, true);
  assert.equal(verifyPasswordResetOtp(email, otp).valid, false);
});
