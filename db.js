const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 5432),
});

function postgresPlaceholders(sql) {
  let index = 0;
  let quote = null;
  let output = "";

  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const character = sql[cursor];
    if ((character === "'" || character === '"') && sql[cursor - 1] !== "\\") {
      quote = quote === character ? null : quote || character;
    }

    if (character === "?" && !quote) {
      index += 1;
      output += `$${index}`;
    } else {
      output += character;
    }
  }

  return output;
}

async function query(sql, values = []) {
  let statement = postgresPlaceholders(sql)
    .replace(/`([^`]+)`/g, '"$1"')
    .replace(/\bDATABASE\(\)/gi, "current_schema()");
  const isInsert = /^\s*INSERT\s+INTO\b/i.test(statement);
  const hasReturning = /\bRETURNING\b/i.test(statement);

  if (isInsert && !hasReturning) {
    statement = `${statement.replace(/;\s*$/, "")} RETURNING id`;
  }

  const result = await pool.query(statement, values);
  if (/^\s*(SELECT|WITH)\b/i.test(statement)) {
    const rows = result.rows.map((row) => {
      const normalized = { ...row };
      for (const [key, value] of Object.entries(row)) {
        normalized[key.toUpperCase()] ??= value;
      }
      return normalized;
    });
    return [rows, result.fields];
  }

  return [
    {
      insertId: result.rows[0]?.id ?? null,
      affectedRows: result.rowCount,
      rows: result.rows,
    },
    result.fields,
  ];
}

pool
  .query("SELECT 1")
  .then(() => console.log("✅ PostgreSQL connected successfully!"))
  .catch((err) => console.error("❌ PostgreSQL connection failed:", err.message));

module.exports = {
  query,
  end: () => pool.end(),
};
