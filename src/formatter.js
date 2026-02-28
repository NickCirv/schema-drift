import chalk from 'chalk';

export const fmt = {
  breaking: (text) => chalk.red.bold(text),
  caution: (text) => chalk.yellow.bold(text),
  safe: (text) => chalk.green.bold(text),
  added: (text) => chalk.green(text),
  removed: (text) => chalk.red(text),
  modified: (text) => chalk.yellow(text),
  header: (text) => chalk.white.bold(text),
  dim: (text) => chalk.dim(text),
  section: (text) => chalk.white.bold(text),
  muted: (text) => chalk.gray(text),
  badge: (text, color = 'white') => chalk[color].bold(` ${text} `),
  tag: (text) => chalk.bgGray.white(` ${text} `),
  indent: (n = 2) => ' '.repeat(n),
  separator: (width = 48) => chalk.dim('─'.repeat(width)),
};

export function riskColor(level) {
  switch (level) {
    case 'BREAKING': return fmt.breaking;
    case 'CAUTION': return fmt.caution;
    case 'SAFE': return fmt.safe;
    default: return (t) => t;
  }
}

export function riskBadge(level) {
  switch (level) {
    case 'BREAKING': return chalk.bgRed.white.bold(' BREAKING ');
    case 'CAUTION': return chalk.bgYellow.black.bold(' CAUTION  ');
    case 'SAFE': return chalk.bgGreen.black.bold('   SAFE   ');
    default: return chalk.bgGray.white(` ${level} `);
  }
}

export function changeIcon(type) {
  switch (type) {
    case 'added': return chalk.green('+');
    case 'removed': return chalk.red('-');
    case 'modified': return chalk.yellow('~');
    default: return ' ';
  }
}
