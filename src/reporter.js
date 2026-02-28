/**
 * Terminal reporter — beautiful colored diff output
 */

import chalk from 'chalk';
import { fmt, riskBadge, changeIcon, riskColor } from './formatter.js';
import { summarizeRisks } from './risk.js';

const VERSION = '1.0.0';

function pad(str, width) {
  const visible = str.replace(/\x1B\[[0-9;]*m/g, '');
  return str + ' '.repeat(Math.max(0, width - visible.length));
}

function sectionHeader(title) {
  return '\n  ' + fmt.section(title) + '\n  ' + fmt.separator(52) + '\n';
}

function formatChangeType(changeType) {
  switch (changeType) {
    case 'table_added': return 'NEW TABLE';
    case 'table_removed': return 'DROPPED';
    case 'column_added': return 'new column added';
    case 'column_removed': return 'column removed';
    case 'column_modified': return 'column modified';
    case 'index_added': return 'new index';
    case 'index_removed': return 'index removed';
    case 'fk_added': return 'FK added';
    case 'fk_removed': return 'FK removed';
    case 'constraint_added': return 'constraint added';
    case 'constraint_removed': return 'constraint removed';
    default: return changeType;
  }
}

function changeTypeIcon(changeType) {
  if (changeType.includes('added') || changeType === 'table_added') return changeIcon('added');
  if (changeType.includes('removed') || changeType === 'table_removed') return changeIcon('removed');
  return changeIcon('modified');
}

/**
 * Group scored changes by table
 */
function groupByTable(changes) {
  const map = new Map();
  for (const change of changes) {
    const table = change.table || '_global';
    if (!map.has(table)) map.set(table, []);
    map.get(table).push(change);
  }
  return map;
}

/**
 * Render the full terminal report
 */
export function renderReport(scoredChanges, options = {}) {
  const lines = [];
  const counts = summarizeRisks(scoredChanges);

  // Header
  lines.push('');
  lines.push(
    '  ' + chalk.bgWhite.black.bold('  SCHEMA-DRIFT  ') +
    '  ' + chalk.dim(`v${VERSION}`)
  );
  lines.push('');
  lines.push('  ' + chalk.dim('Comparing schemas...'));
  lines.push('');

  if (scoredChanges.length === 0) {
    lines.push('  ' + chalk.green.bold('No changes detected. Schemas are identical.'));
    lines.push('');
    return lines.join('\n');
  }

  // Separate table-level changes from column/index changes
  const tableChanges = scoredChanges.filter(
    (c) => c.type === 'table_added' || c.type === 'table_removed'
  );
  const detailChanges = scoredChanges.filter(
    (c) => c.type !== 'table_added' && c.type !== 'table_removed'
  );

  // Tables section
  if (tableChanges.length > 0) {
    lines.push(sectionHeader('Tables'));
    for (const change of tableChanges) {
      const icon = changeTypeIcon(change.type);
      const label = change.type === 'table_added'
        ? fmt.added(change.table)
        : fmt.removed(change.table);
      const badge = change.type === 'table_added'
        ? chalk.green('NEW TABLE')
        : chalk.red('DROPPED');
      lines.push(
        '  ' + icon + ' ' + pad(label, 38) + ' ' + badge
      );
    }
  }

  // Detail changes grouped by table
  const byTable = groupByTable(detailChanges);

  for (const [tableName, changes] of byTable) {
    const tableLabel = tableName === '_global' ? 'Global' : tableName;

    // Group by change category for cleaner output
    const columnChanges = changes.filter((c) => c.type.startsWith('column'));
    const indexChanges = changes.filter((c) => c.type.startsWith('index'));
    const fkChanges = changes.filter((c) => c.type.startsWith('fk'));
    const constraintChanges = changes.filter((c) => c.type.startsWith('constraint'));

    if (columnChanges.length > 0) {
      lines.push(sectionHeader(`Column Changes (${tableLabel})`));
      for (const change of columnChanges) {
        const badge = riskBadge(change.risk);
        let desc = '';

        if (change.type === 'column_added') {
          const col = change.column;
          desc = `${fmt.added(col.name)}: ${chalk.dim(col.type)}`;
        } else if (change.type === 'column_removed') {
          desc = fmt.removed(change.column.name);
        } else if (change.type === 'column_modified') {
          for (const fc of change.changes) {
            const fromVal = fc.from === null ? 'none' : String(fc.from);
            const toVal = fc.to === null ? 'none' : String(fc.to);
            desc += `${change.column}: ${chalk.dim(fromVal)} ${chalk.dim('→')} ${chalk.dim(toVal)}  `;
          }
          desc = desc.trim();
        }

        const reason = riskColor(change.risk)(change.reason || '');
        lines.push(
          '  ' + pad(badge, 14) +
          ' ' + pad(desc, 42) +
          ' ' + chalk.dim(change.reason || '')
        );
      }
    }

    if (indexChanges.length > 0) {
      lines.push(sectionHeader(`Index Changes (${tableLabel})`));
      for (const change of indexChanges) {
        const badge = riskBadge(change.risk);
        const icon = changeTypeIcon(change.type);
        const idx = change.index;
        const idxDesc = `${icon} ${idx.name || idx.columns.join(', ')} (${change.table}.${idx.columns.join(', ')})`;
        lines.push(
          '  ' + pad(badge, 14) +
          ' ' + pad(idxDesc, 42) +
          ' ' + chalk.dim(change.reason || '')
        );
      }
    }

    if (fkChanges.length > 0) {
      lines.push(sectionHeader(`Foreign Key Changes (${tableLabel})`));
      for (const change of fkChanges) {
        const badge = riskBadge(change.risk);
        const icon = changeTypeIcon(change.type);
        const fk = change.fk;
        const fkDesc = `${icon} ${fk.column} → ${fk.refTable}.${fk.refColumn}`;
        lines.push(
          '  ' + pad(badge, 14) +
          ' ' + pad(fkDesc, 42) +
          ' ' + chalk.dim(change.reason || '')
        );
      }
    }

    if (constraintChanges.length > 0) {
      lines.push(sectionHeader(`Constraint Changes (${tableLabel})`));
      for (const change of constraintChanges) {
        const badge = riskBadge(change.risk);
        const icon = changeTypeIcon(change.type);
        const c = change.constraint;
        const desc = `${icon} ${c.name || c.expression}`;
        lines.push(
          '  ' + pad(badge, 14) +
          ' ' + pad(desc, 42) +
          ' ' + chalk.dim(change.reason || '')
        );
      }
    }
  }

  // Summary
  lines.push('');
  lines.push('  ' + fmt.separator(52));
  lines.push('');

  const breakingStr = counts.BREAKING > 0
    ? chalk.red.bold(`${counts.BREAKING} BREAKING`)
    : chalk.dim(`${counts.BREAKING} BREAKING`);
  const cautionStr = counts.CAUTION > 0
    ? chalk.yellow.bold(`${counts.CAUTION} CAUTION`)
    : chalk.dim(`${counts.CAUTION} CAUTION`);
  const safeStr = counts.SAFE > 0
    ? chalk.green.bold(`${counts.SAFE} SAFE`)
    : chalk.dim(`${counts.SAFE} SAFE`);

  lines.push('  ' + breakingStr + '  ' + chalk.dim('|') + '  ' + cautionStr + '  ' + chalk.dim('|') + '  ' + safeStr);
  lines.push('');

  if (counts.BREAKING > 0) {
    lines.push('  ' + chalk.red.bold('This migration has BREAKING changes. Review carefully before running.'));
  } else if (counts.CAUTION > 0) {
    lines.push('  ' + chalk.yellow.bold('This migration has changes that require review.'));
  } else {
    lines.push('  ' + chalk.green.bold('All changes are safe to apply.'));
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Render as Markdown
 */
export function renderMarkdown(scoredChanges) {
  const counts = summarizeRisks(scoredChanges);
  const lines = [];

  lines.push('# Schema Drift Report');
  lines.push('');
  lines.push(`**${counts.BREAKING} BREAKING** | **${counts.CAUTION} CAUTION** | **${counts.SAFE} SAFE**`);
  lines.push('');

  if (scoredChanges.length === 0) {
    lines.push('No changes detected. Schemas are identical.');
    return lines.join('\n');
  }

  lines.push('## Changes');
  lines.push('');
  lines.push('| Risk | Type | Table | Details |');
  lines.push('|------|------|-------|---------|');

  for (const change of scoredChanges) {
    const riskEmoji = change.risk === 'BREAKING' ? '🔴' : change.risk === 'CAUTION' ? '🟡' : '🟢';
    const table = change.table || '-';
    const detail = change.reason || '';
    const type = change.type.replace(/_/g, ' ');
    lines.push(`| ${riskEmoji} ${change.risk} | ${type} | \`${table}\` | ${detail} |`);
  }

  lines.push('');
  if (counts.BREAKING > 0) {
    lines.push('> **Warning:** This migration has BREAKING changes. Review carefully before running.');
  } else if (counts.CAUTION > 0) {
    lines.push('> **Note:** This migration has changes that require review.');
  } else {
    lines.push('> **OK:** All changes are safe to apply.');
  }

  return lines.join('\n');
}

/**
 * Render as JSON
 */
export function renderJSON(scoredChanges) {
  const counts = summarizeRisks(scoredChanges);
  return JSON.stringify({
    summary: counts,
    hasBreaking: counts.BREAKING > 0,
    changes: scoredChanges,
  }, null, 2);
}
