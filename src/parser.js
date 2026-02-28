/**
 * SQL Schema Parser
 * Supports PostgreSQL, MySQL, SQLite syntax variations
 */

function normalize(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .trim();
}

/**
 * Extract the SQL type from the rest of a column definition.
 * Handles: INTEGER, VARCHAR(100), NUMERIC(10,2), DOUBLE PRECISION, etc.
 */
function extractType(rest) {
  // Match word(s) optionally followed by (...)
  const m = rest.match(/^((?:\w+\s+)*\w+(?:\s*\([^)]*\))?)(?:\s+UNSIGNED)?(?:\s+ZEROFILL)?/i);
  if (!m) return rest.split(/\s/)[0];
  // Trim trailing spaces and SQL keywords that bleed into the type
  const raw = m[1].trim();
  // Stop at known keywords
  const keywords = ['NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'UNIQUE', 'AUTO_INCREMENT',
                    'AUTOINCREMENT', 'REFERENCES', 'CHECK', 'CONSTRAINT', 'ON'];
  const parts = raw.split(/\s+/);
  const clean = [];
  for (const p of parts) {
    if (keywords.includes(p.toUpperCase())) break;
    clean.push(p);
  }
  return clean.join(' ').toUpperCase();
}

function parseColumn(rawDef) {
  const def = rawDef.trim();
  if (!def) return null;

  const upper = def.toUpperCase().trimStart();
  const skipPrefixes = ['PRIMARY KEY', 'UNIQUE', 'INDEX', 'KEY ', 'CONSTRAINT', 'CHECK', 'FOREIGN KEY'];
  if (skipPrefixes.some((p) => upper.startsWith(p))) return null;

  // Column name — bare or quoted
  const nameMatch = def.match(/^[`"']?(\w+)[`"']?\s+/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  const rest = def.slice(nameMatch[0].length);
  const restUpper = rest.toUpperCase();

  const type = extractType(rest);

  const nullable = !restUpper.includes('NOT NULL');
  const isPrimary = restUpper.includes('PRIMARY KEY');
  const isUnique = restUpper.includes('UNIQUE');
  const autoIncrement =
    restUpper.includes('AUTO_INCREMENT') ||
    restUpper.includes('AUTOINCREMENT') ||
    restUpper.includes('SERIAL');

  let defaultValue = null;
  const defaultMatch = rest.match(/DEFAULT\s+('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\S+)/i);
  if (defaultMatch) {
    defaultValue = defaultMatch[1].replace(/^['"]|['"]$/g, '');
  }

  let references = null;
  const refMatch = rest.match(/REFERENCES\s+[`"']?(\w+)[`"']?\s*\([`"']?(\w+)[`"']?\)/i);
  if (refMatch) {
    references = { table: refMatch[1], column: refMatch[2] };
  }

  return { name, type, nullable, isPrimary, isUnique, autoIncrement, defaultValue, references };
}

function parseConstraints(lines) {
  const indexes = [];
  const foreignKeys = [];
  const constraints = [];
  let primaryKey = null;

  for (const line of lines) {
    const pkMatch = line.match(/^\s*(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i);
    if (pkMatch) {
      primaryKey = pkMatch[1].split(',').map((c) => c.trim().replace(/[`"']/g, ''));
      continue;
    }

    const uqMatch = line.match(/^\s*(?:CONSTRAINT\s+[`"']?(\w+)[`"']?\s+)?UNIQUE\s+(?:INDEX\s+|KEY\s+)?[`"']?(\w*)[`"']?\s*\(([^)]+)\)/i);
    if (uqMatch) {
      const idxName = uqMatch[1] || uqMatch[2] || null;
      const cols = uqMatch[3].split(',').map((c) => c.trim().replace(/[`"']/g, ''));
      indexes.push({ name: idxName, columns: cols, unique: true });
      continue;
    }

    const idxMatch = line.match(/^\s*(?:INDEX|KEY)\s+[`"']?(\w+)[`"']?\s*\(([^)]+)\)/i);
    if (idxMatch) {
      const cols = idxMatch[2].split(',').map((c) => c.trim().replace(/[`"']/g, ''));
      indexes.push({ name: idxMatch[1], columns: cols, unique: false });
      continue;
    }

    const fkMatch = line.match(/^\s*(?:CONSTRAINT\s+[`"']?(\w+)[`"']?\s+)?FOREIGN\s+KEY\s*\([`"']?(\w+)[`"']?\)\s*REFERENCES\s+[`"']?(\w+)[`"']?\s*\([`"']?(\w+)[`"']?\)/i);
    if (fkMatch) {
      foreignKeys.push({
        name: fkMatch[1] || null,
        column: fkMatch[2],
        refTable: fkMatch[3],
        refColumn: fkMatch[4],
      });
      continue;
    }

    const checkMatch = line.match(/^\s*(?:CONSTRAINT\s+[`"']?(\w+)[`"']?\s+)?CHECK\s*\((.+)\)/i);
    if (checkMatch) {
      constraints.push({ name: checkMatch[1] || null, expression: checkMatch[2].trim() });
    }
  }

  return { indexes, foreignKeys, constraints, primaryKey };
}

function extractTableBody(sql, start) {
  const nameMatch = sql.slice(start).match(/CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s*\(/i);
  if (!nameMatch) return null;

  const tableName = nameMatch[1];
  const openParen = start + sql.slice(start).indexOf('(');

  let depth = 0;
  let end = openParen;
  for (let i = openParen; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    if (sql[i] === ')') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  const body = sql.slice(openParen + 1, end);
  return { tableName, body, end };
}

function splitTableBody(body) {
  const lines = [];
  let current = '';
  let depth = 0;

  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      if (current.trim()) lines.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function parseCreateTable(sql, start) {
  const extracted = extractTableBody(sql, start);
  if (!extracted) return null;

  const { tableName, body } = extracted;
  const lines = splitTableBody(body);

  const columns = [];
  const constraintLines = [];

  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (
      upper.startsWith('PRIMARY KEY') ||
      upper.startsWith('UNIQUE') ||
      upper.startsWith('INDEX') ||
      upper.startsWith('KEY ') ||
      upper.startsWith('CONSTRAINT') ||
      upper.startsWith('CHECK') ||
      upper.startsWith('FOREIGN KEY')
    ) {
      constraintLines.push(line);
    } else {
      const col = parseColumn(line);
      if (col) columns.push(col);
    }
  }

  const { indexes, foreignKeys, constraints, primaryKey } = parseConstraints(constraintLines);

  if (primaryKey) {
    for (const col of columns) {
      if (primaryKey.includes(col.name)) col.isPrimary = true;
    }
  }

  return { tableName, columns, indexes, foreignKeys, constraints };
}

function parseCreateIndexes(sql) {
  const indexes = [];
  const re = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s+ON\s+[`"']?(\w+)[`"']?\s*\(([^)]+)\)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    indexes.push({
      name: m[2],
      table: m[3],
      columns: m[4].split(',').map((c) => c.trim().replace(/[`"']/g, '')),
      unique: Boolean(m[1]),
    });
  }
  return indexes;
}

export function parseSQL(sql) {
  const normalized = normalize(sql);
  const tables = new Map();

  const tableRe = /CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?\w+[`"']?\s*\(/gi;
  let match;

  while ((match = tableRe.exec(normalized)) !== null) {
    const result = parseCreateTable(normalized, match.index);
    if (result) {
      tables.set(result.tableName.toLowerCase(), result);
    }
  }

  const standaloneIndexes = parseCreateIndexes(normalized);

  for (const idx of standaloneIndexes) {
    const table = tables.get(idx.table.toLowerCase());
    if (table) {
      table.indexes.push({ name: idx.name, columns: idx.columns, unique: idx.unique });
    }
  }

  return { tables, standaloneIndexes };
}
