#!/usr/bin/env node
/**
 * schema-drift CLI entry point
 */

import { program } from 'commander';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

program
  .name('schema-drift')
  .description('Database schema change detector with risk scoring')
  .version(pkg.version)
  .argument('[old]', 'old schema file (or leave empty with --migrations)')
  .argument('[new]', 'new schema file (or leave empty with --migrations)')
  .option('--prisma', 'parse as Prisma .prisma schema files')
  .option('--migrations <dir>', 'analyze a migration directory')
  .option('--format <format>', 'output format: terminal, md, json', 'terminal')
  .option('--strict', 'exit with code 1 if any BREAKING changes found (CI mode)')
  .option('--json', 'shorthand for --format json')
  .option('--md', 'shorthand for --format md')
  .action(async (oldArg, newArg, opts) => {
    try {
      const { parseSQL } = await import('../src/parser.js');
      const { parsePrisma } = await import('../src/prisma.js');
      const { diffSchemas } = await import('../src/differ.js');
      const { scoreAll, summarizeRisks } = await import('../src/risk.js');
      const { renderReport, renderMarkdown, renderJSON } = await import('../src/reporter.js');
      const { analyzeMigrations } = await import('../src/migration.js');

      let format = opts.format;
      if (opts.json) format = 'json';
      if (opts.md) format = 'md';

      // Migration directory mode
      if (opts.migrations) {
        const dirPath = resolve(opts.migrations);
        const result = await analyzeMigrations(dirPath);

        let allChanges = [];
        for (const migration of result.migrations) {
          const changes = diffSchemas(migration.previousSchema, migration.cumulativeSchema);
          const scored = scoreAll(changes);
          allChanges = allChanges.concat(scored);
        }

        output(allChanges, format, opts.strict, { renderReport, renderMarkdown, renderJSON, summarizeRisks });
        return;
      }

      // Two-file comparison mode
      if (!oldArg || !newArg) {
        console.error('Error: Please provide two schema files to compare, or use --migrations <dir>');
        console.error('');
        console.error('Examples:');
        console.error('  schema-drift old.sql new.sql');
        console.error('  schema-drift --prisma schema.before.prisma schema.after.prisma');
        console.error('  schema-drift --migrations ./migrations');
        process.exit(1);
      }

      const oldPath = resolve(oldArg);
      const newPath = resolve(newArg);

      const [oldContent, newContent] = await Promise.all([
        readFile(oldPath, 'utf8').catch(() => { throw new Error(`Cannot read file: ${oldPath}`); }),
        readFile(newPath, 'utf8').catch(() => { throw new Error(`Cannot read file: ${newPath}`); }),
      ]);

      const parser = opts.prisma ? parsePrisma : parseSQL;
      const oldSchema = parser(oldContent);
      const newSchema = parser(newContent);

      const changes = diffSchemas(oldSchema, newSchema);
      const scored = scoreAll(changes);

      output(scored, format, opts.strict, { renderReport, renderMarkdown, renderJSON, summarizeRisks });
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

function output(scored, format, strict, { renderReport, renderMarkdown, renderJSON, summarizeRisks }) {
  switch (format) {
    case 'json':
      process.stdout.write(renderJSON(scored) + '\n');
      break;
    case 'md':
    case 'markdown':
      process.stdout.write(renderMarkdown(scored) + '\n');
      break;
    default:
      process.stdout.write(renderReport(scored) + '\n');
  }

  if (strict) {
    const counts = summarizeRisks(scored);
    if (counts.BREAKING > 0) {
      process.exit(1);
    }
  }
}

program.parse();
