/**
 * Prisma Schema Parser (.prisma files)
 * Converts Prisma models to the same internal format as the SQL parser
 */

const TYPE_MAP = {
  String: 'VARCHAR(255)',
  Int: 'INTEGER',
  BigInt: 'BIGINT',
  Float: 'FLOAT',
  Decimal: 'DECIMAL',
  Boolean: 'BOOLEAN',
  DateTime: 'TIMESTAMP',
  Json: 'JSON',
  Bytes: 'BYTEA',
};

function mapType(prismaType) {
  return TYPE_MAP[prismaType] || prismaType.toUpperCase();
}

/**
 * Parse a single model block into our internal table schema
 */
function parseModel(modelName, body) {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const columns = [];
  const indexes = [];
  const foreignKeys = [];
  const constraints = [];

  for (const line of lines) {
    // Skip decorators that are pure model-level (@@map, @@schema, etc.)
    if (line.startsWith('@@map') || line.startsWith('@@schema') ||
        line.startsWith('//') || line.startsWith('/*')) {
      continue;
    }

    // @@id([...]) — composite primary key
    const compIdMatch = line.match(/^@@id\(\[([^\]]+)\]\)/);
    if (compIdMatch) {
      const cols = compIdMatch[1].split(',').map((c) => c.trim());
      for (const col of columns) {
        if (cols.includes(col.name)) col.isPrimary = true;
      }
      continue;
    }

    // @@unique([...]) — composite unique
    const compUqMatch = line.match(/^@@unique\(\[([^\]]+)\]\)/);
    if (compUqMatch) {
      const cols = compUqMatch[1].split(',').map((c) => c.trim());
      indexes.push({ name: null, columns: cols, unique: true });
      continue;
    }

    // @@index([...]) — composite index
    const compIdxMatch = line.match(/^@@index\(\[([^\]]+)\]\)/);
    if (compIdxMatch) {
      const cols = compIdxMatch[1].split(',').map((c) => c.trim());
      indexes.push({ name: null, columns: cols, unique: false });
      continue;
    }

    // Field line: fieldName Type? @attrs...
    const fieldMatch = line.match(/^(\w+)\s+(\w+)(\?)?\s*(.*)?$/);
    if (!fieldMatch) continue;

    const fieldName = fieldMatch[1];
    const prismaType = fieldMatch[2];
    const optional = Boolean(fieldMatch[3]);
    const attrs = fieldMatch[4] || '';

    // Skip relation fields (they don't map to columns)
    if (attrs.includes('@relation')) {
      // But we can extract FK info
      const relMatch = attrs.match(/@relation\(fields:\s*\[([^\]]+)\],\s*references:\s*\[([^\]]+)\]/);
      if (relMatch) {
        const cols = relMatch[1].split(',').map((c) => c.trim());
        const refs = relMatch[2].split(',').map((c) => c.trim());
        foreignKeys.push({
          name: null,
          column: cols[0],
          refTable: prismaType.toLowerCase(),
          refColumn: refs[0],
        });
      }
      continue;
    }

    // Skip non-scalar types (other models)
    if (!TYPE_MAP[prismaType] && prismaType[0] === prismaType[0].toUpperCase() &&
        !/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)$/.test(prismaType)) {
      continue;
    }

    const isPrimary = attrs.includes('@id');
    const isUnique = attrs.includes('@unique');
    const isAutoIncrement = attrs.includes('@default(autoincrement())') ||
                            attrs.includes('@default(uuid())') ||
                            attrs.includes('@default(cuid())');

    let defaultValue = null;
    const defaultMatch = attrs.match(/@default\(([^)]+)\)/);
    if (defaultMatch) {
      defaultValue = defaultMatch[1].replace(/"/g, '');
    }

    const type = mapType(prismaType);
    const nullable = optional || (!isPrimary && !attrs.includes('@default'));

    columns.push({
      name: fieldName,
      type,
      nullable,
      isPrimary,
      isUnique,
      autoIncrement: isAutoIncrement,
      defaultValue,
      references: null,
    });
  }

  return {
    tableName: modelName,
    columns,
    indexes,
    foreignKeys,
    constraints,
  };
}

/**
 * Parse a Prisma schema file
 * Returns { tables: Map<name, tableSchema> }
 */
export function parsePrisma(source) {
  const tables = new Map();

  // Extract model blocks
  const modelRe = /^model\s+(\w+)\s*\{([^}]+)\}/gm;
  let match;

  while ((match = modelRe.exec(source)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const schema = parseModel(modelName, body);
    tables.set(modelName.toLowerCase(), schema);
  }

  return { tables, standaloneIndexes: [] };
}
