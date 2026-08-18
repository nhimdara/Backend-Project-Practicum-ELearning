const { EMAIL_DOMAIN } = require("../config/constants");

function clampAcademicYear(value) {
  const year = Number.parseInt(value, 10);
  if (Number.isNaN(year)) return 1;
  return Math.min(4, Math.max(1, year));
}

function getCurrentAcademicYear(startYear) {
  const start = Number.parseInt(startYear, 10);
  if (Number.isNaN(start)) return 1;
  return clampAcademicYear(new Date().getFullYear() - start + 1);
}

function getStudentEmailNameParts(name) {
  const parts = String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const firstName = (parts[0] || "student").slice(0, 24);
  const lastName = (parts.length > 1 ? parts[parts.length - 1] : firstName).slice(
    0,
    24,
  );
  return { firstName, lastName };
}

function buildStudentEmail(name, startYear, endYear, major = "") {
  const { firstName, lastName } = getStudentEmailNameParts(name);
  const start = String(startYear).slice(-2);
  const end = String(endYear).slice(-2);
  const cleanMajor = major
    ? String(major).toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
  const majorPart = cleanMajor ? `.${cleanMajor}` : "";
  return `${firstName}.${lastName}${majorPart}.${start}${end}@${EMAIL_DOMAIN}`;
}

function buildStaffEmail(name, role) {
  const { firstName, lastName } = getStudentEmailNameParts(name);
  return `${firstName}.${lastName}.${role}@${EMAIL_DOMAIN}`;
}

module.exports = { clampAcademicYear, getCurrentAcademicYear, getStudentEmailNameParts, buildStudentEmail, buildStaffEmail };
