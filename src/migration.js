/**
 * Migration directory analyzer
 * Reads all migration files in a directory and builds a cumulative schema
 */

import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { parseSQL } from './parser.js';

/**
 * Sort migration files by their numeric/timestamp prefix
 */
function sortMigrations(files) {
  return [...files].sort((a, b) => {
    const aNum = a.match(/^(\d+)/);
    const bNum = b.match(/^(\d+)/);
    if (aNum && bNum) return parseInt(aNum[1]) - parseInt(bNum[1]);
    return a.localeCompare(b);
  });
}

/**
 * Find all SQL migration files in a directory (recursive for Prisma-style dirs)
 */
async function findMigrationFiles(dirPath) {
  let files = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // Prisma migration dirs: migrations/20240101_init/migration.sql
        const subFiles = await findMigrationFiles(fullPath);
        files = files.concat(subFiles);
      } else if (entry.isFile() && (extname(entry.name) === '.sql' || entry.name.endsWith('.up.sql'))) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory not readable — skip
  }

  return files;
}

/**
 * Merge schemas: apply newSchema on top of baseSchema
 * (simplified: tables in new schema override/extend base)
 */
function mergeSchemas(base, overlay) {
  const merged = new Map(base.tables);

  for (const [name, table] of overlay.tables) {
    if (merged.has(name)) {
      // Merge columns
      const existingCols = new Map(merged.get(name).columns.map((c) => [c.name.toLowerCase(), c]));
      for (const col of table.columns) {
        existingCols.set(col.name.toLowerCase(), col);
      }
      merged.set(name, {
        ...merged.get(name),
        columns: [...existingCols.values()],
        indexes: [...merged.get(name).indexes, ...table.indexes],
        foreignKeys: [...merged.get(name).foreignKeys, ...table.foreignKeys],
      });
    } else {
      merged.set(name, table);
    }
  }

  return { tables: merged, standaloneIndexes: [] };
}

/**
 * Analyze a migration directory
 * Returns { files, schema, migrations: [{ file, schema, changes }] }
 */
export async function analyzeMigrations(dirPath) {
  const allFiles = await findMigrationFiles(dirPath);
  const sorted = sortMigrations(allFiles.map((f) => f.split('/').pop()).filter(Boolean)).map(
    (name) => allFiles.find((f) => f.endsWith(name))
  ).filter(Boolean);

  if (sorted.length === 0) {
    throw new Error(`No SQL migration files found in: ${dirPath}`);
  }

  const migrations = [];
  let cumulativeSchema = { tables: new Map(), standaloneIndexes: [] };

  for (const filePath of sorted) {
    const content = await readFile(filePath, 'utf8');
    const schema = parseSQL(content);
    const previousSchema = { ...cumulativeSchema, tables: new Map(cumulativeSchema.tables) };

    cumulativeSchema = mergeSchemas(cumulativeSchema, schema);

    migrations.push({
      file: filePath,
      fileName: filePath.split('/').pop(),
      schema,
      cumulativeSchema: { ...cumulativeSchema, tables: new Map(cumulativeSchema.tables) },
      previousSchema,
    });
  }

  return {
    files: sorted,
    schema: cumulativeSchema,
    migrations,
  };
}
