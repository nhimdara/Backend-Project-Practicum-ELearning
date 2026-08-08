const test = require("node:test");
const assert = require("node:assert/strict");
const { authorizeApiRequest, createAccessToken } = require("../middleware/auth");

function invoke({ method = "GET", path, user }) {
  const req = { method, originalUrl: path, headers: {}, body: {}, params: {} };
  if (user) req.headers.authorization = `Bearer ${createAccessToken(user)}`;
  const result = { status: null, body: null, next: false };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  authorizeApiRequest(req, res, () => { result.next = true; });
  return result;
}

test("public lesson catalog does not require a token", () => {
  assert.equal(invoke({ path: "/api/lessons" }).next, true);
});

test("protected endpoints reject anonymous requests", () => {
  assert.equal(invoke({ path: "/api/users/1/profile" }).status, 401);
});

test("students cannot list all users", () => {
  const result = invoke({ path: "/api/users", user: { id: 2, role: "student", email: "s@example.com" } });
  assert.equal(result.status, 403);
});

test("students cannot access another student's profile", () => {
  const result = invoke({ path: "/api/users/9/profile", user: { id: 2, role: "student", email: "s@example.com" } });
  assert.equal(result.status, 403);
});

test("verified admin may access user management", () => {
  const result = invoke({ path: "/api/users", user: { id: 1, role: "admin", email: "a@example.com" } });
  assert.equal(result.next, true);
});

test("students cannot mutate lessons or certificates", () => {
  const student = { id: 2, role: "student", email: "s@example.com" };
  assert.equal(invoke({ method: "POST", path: "/api/lessons", user: student }).status, 403);
  assert.equal(invoke({ method: "POST", path: "/api/certificates", user: student }).status, 403);
});

test("teachers can manage lessons but cannot manage users", () => {
  const teacher = { id: 3, role: "teacher", email: "t@example.com" };
  assert.equal(invoke({ method: "POST", path: "/api/lessons", user: teacher }).next, true);
  assert.equal(invoke({ method: "POST", path: "/api/users/students", user: teacher }).status, 403);
});
