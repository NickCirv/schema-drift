/**
 * Risk scorer — assigns SAFE / CAUTION / BREAKING to each change
 */

/**
 * Detect if a type change is potentially lossy (data truncation risk)
 */
function isLossyTypeChange(fromType, toType) {
  const from = fromType.toUpperCase();
  const to = toType.toUpperCase();
  if (from === to) return false;

  // VARCHAR shrinking
  const varcharRe = /VARCHAR\((\d+)\)/;
  const fromVarchar = from.match(varcharRe);
  const toVarchar = to.match(varcharRe);
  if (fromVarchar && toVarchar && parseInt(toVarchar[1]) < parseInt(fromVarchar[1])) {
    return true;
  }

  // Numeric precision shrinking
  const numericRe = /(?:NUMERIC|DECIMAL)\((\d+)(?:,(\d+))?\)/;
  const fromNum = from.match(numericRe);
  const toNum = to.match(numericRe);
  if (fromNum && toNum && parseInt(toNum[1]) < parseInt(fromNum[1])) {
    return true;
  }

  // TEXT -> VARCHAR (potentially lossy)
  if ((from.startsWith('TEXT') || from.startsWith('LONGTEXT')) &&
      to.startsWith('VARCHAR')) {
    return true;
  }

  // BIGINT -> INT (lossy)
  if (from === 'BIGINT' && (to === 'INT' || to === 'INTEGER' || to === 'SMALLINT')) {
    return true;
  }

  // Any type change is at minimum caution
  return false;
}

/**
 * Score a single change object, returning enriched change with `risk` and `reason`
 */
export function scoreChange(change) {
  const scored = { ...change };

  switch (change.type) {
    // Table-level
    case 'table_added':
      scored.risk = 'SAFE';
      scored.reason = 'new table added';
      break;

    case 'table_removed':
      scored.risk = 'BREAKING';
      scored.reason = 'table dropped — all data lost';
      break;

    // Column-level
    case 'column_added': {
      const col = change.column;
      if (col.nullable || col.defaultValue !== null) {
        scored.risk = 'SAFE';
        scored.reason = col.nullable ? 'new nullable column' : 'new column with default';
      } else {
        scored.risk = 'BREAKING';
        scored.reason = 'NOT NULL column without default — existing rows will fail';
      }
      break;
    }

    case 'column_removed':
      scored.risk = 'BREAKING';
      scored.reason = 'column removed — data loss + query breakage';
      break;

    case 'column_modified': {
      const risks = [];
      for (const fieldChange of change.changes) {
        if (fieldChange.field === 'type') {
          if (isLossyTypeChange(fieldChange.from, fieldChange.to)) {
            risks.push({ risk: 'BREAKING', reason: `type changed ${fieldChange.from} → ${fieldChange.to} (data truncation risk)` });
          } else {
            risks.push({ risk: 'CAUTION', reason: `type changed ${fieldChange.from} → ${fieldChange.to}` });
          }
        } else if (fieldChange.field === 'nullable') {
          if (fieldChange.from === true && fieldChange.to === false) {
            const hasDefault = change.newColumn.defaultValue !== null;
            if (hasDefault) {
              risks.push({ risk: 'CAUTION', reason: 'nullable → NOT NULL (with default, check existing NULLs)' });
            } else {
              risks.push({ risk: 'BREAKING', reason: 'NOT NULL added without default — existing NULL rows will fail' });
            }
          } else {
            risks.push({ risk: 'SAFE', reason: 'NOT NULL → nullable (relaxed constraint)' });
          }
        } else if (fieldChange.field === 'default') {
          risks.push({ risk: 'CAUTION', reason: `default changed: ${fieldChange.from ?? 'none'} → ${fieldChange.to ?? 'none'}` });
        } else if (fieldChange.field === 'primaryKey') {
          risks.push({ risk: 'BREAKING', reason: 'primary key changed' });
        }
      }

      // Escalate to highest risk level
      if (risks.some((r) => r.risk === 'BREAKING')) {
        scored.risk = 'BREAKING';
        scored.reason = risks.find((r) => r.risk === 'BREAKING').reason;
      } else if (risks.some((r) => r.risk === 'CAUTION')) {
        scored.risk = 'CAUTION';
        scored.reason = risks.find((r) => r.risk === 'CAUTION').reason;
      } else {
        scored.risk = 'SAFE';
        scored.reason = risks.map((r) => r.reason).join(', ');
      }
      scored.fieldRisks = risks;
      break;
    }

    // Index-level
    case 'index_added':
      scored.risk = 'SAFE';
      scored.reason = 'new index added';
      break;

    case 'index_removed':
      scored.risk = 'CAUTION';
      scored.reason = 'index removed (performance regression possible)';
      break;

    // Foreign keys
    case 'fk_added':
      scored.risk = 'CAUTION';
      scored.reason = 'new FK added — existing orphaned rows may fail';
      break;

    case 'fk_removed':
      scored.risk = 'BREAKING';
      scored.reason = 'FK removed — referential integrity no longer enforced';
      break;

    // Constraints
    case 'constraint_added':
      scored.risk = 'CAUTION';
      scored.reason = 'new CHECK constraint — existing rows may violate it';
      break;

    case 'constraint_removed':
      scored.risk = 'CAUTION';
      scored.reason = 'constraint removed — previously enforced rule no longer applies';
      break;

    default:
      scored.risk = 'CAUTION';
      scored.reason = 'unknown change type';
  }

  return scored;
}

/**
 * Score all changes from the differ
 */
export function scoreAll(changes) {
  return changes.map(scoreChange);
}

/**
 * Summarize risk counts
 */
export function summarizeRisks(scoredChanges) {
  const counts = { BREAKING: 0, CAUTION: 0, SAFE: 0 };
  for (const c of scoredChanges) {
    if (counts[c.risk] !== undefined) counts[c.risk]++;
  }
  return counts;
}
