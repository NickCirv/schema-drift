/**
 * Schema differ — compares two parsed schemas and produces a change list
 */

/**
 * Compare two column objects for differences
 */
function diffColumn(oldCol, newCol) {
  const changes = [];

  if (oldCol.type !== newCol.type) {
    changes.push({ field: 'type', from: oldCol.type, to: newCol.type });
  }
  if (oldCol.nullable !== newCol.nullable) {
    changes.push({ field: 'nullable', from: oldCol.nullable, to: newCol.nullable });
  }
  if (oldCol.defaultValue !== newCol.defaultValue) {
    changes.push({ field: 'default', from: oldCol.defaultValue, to: newCol.defaultValue });
  }
  if (oldCol.isPrimary !== newCol.isPrimary) {
    changes.push({ field: 'primaryKey', from: oldCol.isPrimary, to: newCol.isPrimary });
  }

  return changes;
}

/**
 * Diff tables — find added, removed, modified tables
 */
function diffTables(oldTables, newTables) {
  const tableChanges = [];
  const oldNames = new Set(oldTables.keys());
  const newNames = new Set(newTables.keys());

  for (const name of newNames) {
    if (!oldNames.has(name)) {
      tableChanges.push({ type: 'table_added', table: name, schema: newTables.get(name) });
    }
  }

  for (const name of oldNames) {
    if (!newNames.has(name)) {
      tableChanges.push({ type: 'table_removed', table: name, schema: oldTables.get(name) });
    }
  }

  return tableChanges;
}

/**
 * Diff columns within a table
 */
function diffColumns(tableName, oldTable, newTable) {
  const changes = [];
  const oldCols = new Map(oldTable.columns.map((c) => [c.name.toLowerCase(), c]));
  const newCols = new Map(newTable.columns.map((c) => [c.name.toLowerCase(), c]));

  for (const [name, col] of newCols) {
    if (!oldCols.has(name)) {
      changes.push({ type: 'column_added', table: tableName, column: col });
    }
  }

  for (const [name, col] of oldCols) {
    if (!newCols.has(name)) {
      changes.push({ type: 'column_removed', table: tableName, column: col });
    }
  }

  for (const [name, newCol] of newCols) {
    const oldCol = oldCols.get(name);
    if (!oldCol) continue;
    const fieldChanges = diffColumn(oldCol, newCol);
    if (fieldChanges.length > 0) {
      changes.push({
        type: 'column_modified',
        table: tableName,
        column: name,
        oldColumn: oldCol,
        newColumn: newCol,
        changes: fieldChanges,
      });
    }
  }

  return changes;
}

/**
 * Diff indexes within a table
 */
function diffIndexes(tableName, oldTable, newTable) {
  const changes = [];
  const oldIdxMap = new Map(oldTable.indexes.map((i) => [i.name || i.columns.join(','), i]));
  const newIdxMap = new Map(newTable.indexes.map((i) => [i.name || i.columns.join(','), i]));

  for (const [key, idx] of newIdxMap) {
    if (!oldIdxMap.has(key)) {
      changes.push({ type: 'index_added', table: tableName, index: idx });
    }
  }

  for (const [key, idx] of oldIdxMap) {
    if (!newIdxMap.has(key)) {
      changes.push({ type: 'index_removed', table: tableName, index: idx });
    }
  }

  return changes;
}

/**
 * Diff foreign keys within a table
 */
function diffForeignKeys(tableName, oldTable, newTable) {
  const changes = [];
  const fkKey = (fk) => `${fk.column}->${fk.refTable}.${fk.refColumn}`;
  const oldFKMap = new Map(oldTable.foreignKeys.map((fk) => [fkKey(fk), fk]));
  const newFKMap = new Map(newTable.foreignKeys.map((fk) => [fkKey(fk), fk]));

  for (const [key, fk] of newFKMap) {
    if (!oldFKMap.has(key)) {
      changes.push({ type: 'fk_added', table: tableName, fk });
    }
  }

  for (const [key, fk] of oldFKMap) {
    if (!newFKMap.has(key)) {
      changes.push({ type: 'fk_removed', table: tableName, fk });
    }
  }

  return changes;
}

/**
 * Diff constraints within a table
 */
function diffConstraints(tableName, oldTable, newTable) {
  const changes = [];
  const cKey = (c) => c.name || c.expression;
  const oldCMap = new Map(oldTable.constraints.map((c) => [cKey(c), c]));
  const newCMap = new Map(newTable.constraints.map((c) => [cKey(c), c]));

  for (const [key, c] of newCMap) {
    if (!oldCMap.has(key)) {
      changes.push({ type: 'constraint_added', table: tableName, constraint: c });
    }
  }

  for (const [key, c] of oldCMap) {
    if (!newCMap.has(key)) {
      changes.push({ type: 'constraint_removed', table: tableName, constraint: c });
    }
  }

  return changes;
}

/**
 * Main differ entry point
 * Takes two parsed schemas (from parseSQL) and returns a flat array of changes
 */
export function diffSchemas(oldSchema, newSchema) {
  const changes = [];

  changes.push(...diffTables(oldSchema.tables, newSchema.tables));

  const oldTables = oldSchema.tables;
  const newTables = newSchema.tables;
  const sharedTables = [...newTables.keys()].filter((k) => oldTables.has(k));

  for (const tableName of sharedTables) {
    const oldTable = oldTables.get(tableName);
    const newTable = newTables.get(tableName);

    changes.push(...diffColumns(tableName, oldTable, newTable));
    changes.push(...diffIndexes(tableName, oldTable, newTable));
    changes.push(...diffForeignKeys(tableName, oldTable, newTable));
    changes.push(...diffConstraints(tableName, oldTable, newTable));
  }

  return changes;
}
