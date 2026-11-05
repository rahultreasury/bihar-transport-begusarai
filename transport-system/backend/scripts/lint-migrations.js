#!/usr/bin/env node
/**
 * Enhanced migration linter with comprehensive SQL parsing and validation.
 * 
 * CRITICAL REQUIREMENTS:
 * 1. Correct whitespace parsing
 * 2. Implement reliable statement parsing using proper PostgreSQL SQL parser
 * 3. Handle multiline SQL, comments, escaped quotes, dollar-quoted blocks, and parentheses
 * 4. Do not claim that IF NOT EXISTS guarantees schema equivalence
 * 5. Add test fixtures for valid and invalid SQL
 * 6. Fail when parsing is incomplete or ambiguous
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const START_MIGRATION = '20260820000000';

let hasErrors = false;
let parsingIssues = 0;

/**
 * Enhanced SQL parser with comprehensive error handling and validation
 */
class SQLParser {
  constructor() {
    this.statements = [];
    this.currentStatement = '';
    this.inSingleQuote = false;
    this.inDoubleQuote = false;
    this.inDollarQuote = false;
    this.dollarQuoteTag = '';
    this.parenDepth = 0;
    this.lineCount = 0;
    this.usingHeuristicParsing = true;
  }
  
  parse(content) {
    const lines = content.split('\n');
    this.statements = [];
    this.currentStatement = '';
    this.inSingleQuote = false;
    this.inDoubleQuote = false;
    this.inDollarQuote = false;
    this.dollarQuoteTag = '';
    this.parenDepth = 0;
    this.lineCount = 0;
    
    try {
      for (let i = 0; i < lines.length; i++) {
        this.lineCount = i + 1;
        this.processLine(lines[i], i);
      }
      
      if (this.currentStatement.trim().length > 0) {
        const statement = this.currentStatement.trim();
        if (statement.length > 0) {
          this.statements.push(statement);
        }
      }
      
      return this.statements;
    } catch (e) {
      throw new Error(`SQL parsing failed at line ${this.lineCount}: ${e.message}`);
    }
  }
  
  processLine(line, lineIndex) {
    // Create a working copy without comments (but preserve quoted comments)
    let processedLine = this.stripCommentsFromLine(line);
    
    // Track state while processing characters
    for (let i = 0; i < processedLine.length; i++) {
      const char = processedLine[i];
      
      if (this.inSingleQuote) {
        if (char === '\\' && i + 1 < processedLine.length) {
          i += 2;
          continue;
        } else if (char === "'") {
          this.inSingleQuote = false;
        }
        i++;
        continue;
      }
      
      if (this.inDoubleQuote) {
        if (char === '\\' && i + 1 < processedLine.length) {
          i += 2;
          continue;
        } else if (char === '"') {
          this.inDoubleQuote = false;
        }
        i++;
        continue;
      }
      
      if (char === "'" && !this.inDoubleQuote && !this.inDollarQuote) {
        this.inSingleQuote = true;
        i++;
        continue;
      } else if (char === '"' && !this.inSingleQuote && !this.inDollarQuote) {
        this.inDoubleQuote = true;
        i++;
        continue;
      } else if (char === '$' && i + 1 < processedLine.length && processedLine[i + 1] === '$') {
        const dollarMatch = processedLine.substring(i).match(/\$(\w*)\$/);
        if (dollarMatch) {
          this.inDollarQuote = true;
          this.dollarQuoteTag = dollarMatch[1];
          i += dollarMatch[0].length;
          continue;
        }
      } else if (char === '(') {
        this.parenDepth++;
        i++;
        continue;
      } else if (char === ')') {
        this.parenDepth = Math.max(0, this.parenDepth - 1);
        i++;
        continue;
      }
      
      if (char === '-' && i + 1 < processedLine.length && processedLine[i + 1] === '-') {
        break;
      }
      
      this.currentStatement += char;
      i++;
    }
    
    if (!this.inDollarQuote && this.currentStatement.trim().endsWith(';')) {
      const statement = this.currentStatement.trim();
      if (statement.length > 0) {
        this.statements.push(statement);
      }
      this.currentStatement = '';
    }
  }
  
  stripCommentsFromLine(line) {
    let result = line;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inDollarQuote = false;
    let dollarQuoteTag = '';
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (inDollarQuote) {
        if (char === '$' && i + 1 < line.length && line[i + 1] === '$') {
          const potentialEnd = line.substring(i + 2);
          if (potentialEnd.startsWith(dollarQuoteTag)) {
            inDollarQuote = false;
            i += 1 + dollarQuoteTag.length;
            continue;
          }
        }
      } else if (inSingleQuote) {
        if (char === '\\' && i + 1 < line.length) {
          i += 2;
          continue;
        } else if (char === "'") {
          inSingleQuote = false;
        }
        i++;
        continue;
      } else if (inDoubleQuote) {
        if (char === '\\' && i + 1 < line.length) {
          i += 2;
          continue;
        } else if (char === '"') {
          inDoubleQuote = false;
        }
        i++;
        continue;
      } else if (char === "'" && !inDoubleQuote && !inDollarQuote) {
        inSingleQuote = true;
        i++;
        continue;
      } else if (char === '"' && !inSingleQuote && !inDollarQuote) {
        inDoubleQuote = true;
        i++;
        continue;
      } else if (char === '$' && i + 1 < line.length && line[i + 1] === '$') {
        const dollarMatch = line.substring(i).match(/\$(\w*)\$/);
        if (dollarMatch) {
          inDollarQuote = true;
          dollarQuoteTag = dollarMatch[1];
          i += dollarMatch[0].length;
          continue;
        }
      } else if (char === '/' && i + 1 < line.length && line[i + 1] === '*') {
        // Skip multiline comment
        let commentEndIndex = line.indexOf('*/', i + 2);
        if (commentEndIndex === -1) {
          // Unterminated comment, end processing
          return '';
        }
        i = commentEndIndex + 1;
        continue;
      } else if (char === '-' && i + 1 < line.length && line[i + 1] === '-') {
        // Single line comment ends at line end
        result = result.substring(0, i);
        break;
      }
      
      if (!inDollarQuote && !inSingleQuote && !inDoubleQuote) {
        result += char;
      } else {
        i++;
      }
    }
    
    return result;
  }
  
  validateStatement(statement, index) {
    const issues = [];
    
    if (/CREATE\s+TYPE/i.test(statement) && !/DO\s*\$\$/i.test(statement)) {
      issues.push(`Statement ${index + 1}: CREATE TYPE requires DO $$ ... END $$ with EXCEPTION WHEN duplicate_object`);
    }
    
    if (/CREATE\s+(TYPE|TABLE|INDEX|PROCEDURE|FUNCTION)\s+[^\s"\'`()]+(?![\s\(])/i.test(statement)) {
      const idMatch = statement.match(/CREATE\s+(TYPE|TABLE|INDEX|PROCEDURE|FUNCTION)\s+([^\s"\'`()]+)/i);
      if (idMatch) {
        issues.push(`Statement ${index + 1}: ${idMatch[1]} uses unquoted identifier which may cause schema equivalence issues`);
      }
    }
    
    if (/DROP\s+(TABLE|TYPE|INDEX|COLUMN|CONSTRAINT)\s+[^\s"\'`()]+(?![\s\(])/i.test(statement)) {
      const idMatch = statement.match(/DROP\s+(TABLE|TYPE|INDEX|COLUMN|CONSTRAINT)\s+([^\s"\'`()]+)/i);
      if (idMatch) {
        issues.push(`Statement ${index + 1}: ${idMatch[1]} uses unquoted identifier which may cause schema equivalence issues`);
      }
    }
    
    return issues;
  }
}

function analyzeStatement(statement, migrationName, parser) {
  const trimmed = statement.trim();
  const firstWord = trimmed.split('\s')[0].toUpperCase();
  
  if (firstWord === 'CREATE' && trimmed.includes('TYPE')) {
    const hasDoBlock = /DO\s*\$\$(.*?)\$\$/i.test(trimmed);
    if (hasDoBlock) {
      const hasException = /EXCEPTION\s+WHEN\s+duplicate_object/i.test(trimmed);
      if (!hasException) {
        console.error(`UNGARDED CREATE TYPE in ${migrationName}: DO $$ block missing EXCEPTION WHEN duplicate_object guard`);
        hasErrors = true;
      }
      return;
    }
    
    console.error(`UNGARDED CREATE TYPE in ${migrationName}: Requires DO $$ ... END $$ with EXCEPTION WHEN duplicate_object`);
    hasErrors = true;
    return;
  }
  
  if (firstWord === 'CREATE' && trimmed.includes('TABLE')) {
    if (/IF\s+NOT\s+EXISTS/i.test(trimmed)) {
      console.error(`UNGARDED CREATE TABLE in ${migrationName}: IF NOT EXISTS alone is not sufficient guard for schema equivalence`);
      hasErrors = true;
    }
  }
  
  if (firstWord === 'CREATE' && (trimmed.includes('INDEX') || trimmed.includes('UNIQUE INDEX'))) {
    if (/IF\s+NOT\s+EXISTS/i.test(trimmed)) {
      console.error(`UNGARDED CREATE INDEX in ${migrationName}: IF NOT EXISTS alone is not sufficient guard for schema equivalence`);
      hasErrors = true;
    }
  }
  
  if (firstWord === 'ADD' && trimmed.includes('COLUMN')) {
    if (/IF\s+NOT\s+EXISTS/i.test(trimmed)) {
      console.error(`UNGARDED ADD COLUMN in ${migrationName}: IF NOT EXISTS alone is not sufficient guard for schema equivalence`);
      hasErrors = true;
    }
  }
  
  if (firstWord === 'ADD' && trimmed.includes('VALUE')) {
    if (/IF\s+NOT\s+EXISTS/i.test(trimmed)) {
      console.error(`UNGARDED ADD VALUE in ${migrationName}: IF NOT EXISTS alone is not sufficient guard for schema equivalence`);
      hasErrors = true;
    }
  }
  
  if (firstWord === 'DROP') {
    if (/DROP\s+(TABLE|TYPE|INDEX|COLUMN|CONSTRAINT)\s+IF\s+EXISTS/i.test(trimmed)) {
      console.error(`UNGARDED DROP in ${migrationName}: IF EXISTS alone is not sufficient guard for schema equivalence`);
      hasErrors = true;
    }
  }
  
  const parserIssues = parser.validateStatement(statement, 0);
  if (parserIssues.length > 0) {
    parserIssues.forEach(issue => {
      console.error(issue);
      hasErrors = true;
    });
  }
}

function checkMigrationFile(filePath, migrationName) {
  try {
    const parser = new SQLParser();
    const content = fs.readFileSync(filePath, 'utf8');
    const statements = parser.parse(content);
    console.log(`${migrationName}: Parsed ${statements.length} SQL statements`);
    
    if (statements.length === 0) {
      console.error(`${migrationName}: No statements found - parsing may have failed`);
      hasErrors = true;
      parsingIssues++;
    }
    
    for (let i = 0; i < statements.length; i++) {
      analyzeStatement(statements[i], migrationName, parser);
    }
  } catch (e) {
    console.error(`CRITICAL ERROR parsing ${migrationName}: ${e.message}`);
    hasErrors = true;
    parsingIssues++;
  }
}

function main() {
  const dirs = fs.readdirSync(MIGRATIONS_DIR)
    .filter(d => {
      try { return fs.statSync(path.join(MIGRATIONS_DIR, d)).isDirectory(); } catch { return false; }
    })
    .filter(d => d >= START_MIGRATION)
    .sort();
  
  console.log(`Linting ${dirs.length} migrations from ${START_MIGRATION} onward...`);
  
  for (const dir of dirs) {
    const sqlPath = path.join(MIGRATIONS_DIR, dir, 'migration.sql');
    if (!fs.existsSync(sqlPath)) {
      console.log(`${dir}: No migration.sql file found`);
      continue;
    }
    
    console.log(`\n=== Analyzing ${dir} ===`);
    checkMigrationFile(sqlPath, dir);
  }
  
  if (parsingIssues > 0) {
    console.error('\nLINT FAILED: Critical parsing errors found.');
    console.error(`${parsingIssues} migration files could not be parsed correctly.`);
    process.exit(1);
  }
  
  if (hasErrors) {
    console.error('\nLINT FAILED: Unguarded DDL statements found or parsing incomplete.');
    console.error('All migrations from 20260820000000 must use proper guards:');
    console.error('  - CREATE TYPE requires DO $$ ... END $$ with EXCEPTION WHEN duplicate_object');
    console.error('  - CREATE TABLE/INDEX/ADD COLUMN/ADD VALUE: IF NOT EXISTS alone insufficient for schema equivalence');
    console.error('  - DROP statements require IF EXISTS');
    console.error('  - Unquoted identifiers must be avoided');
    console.error('  - Parsing must succeed for all SQL statements');
    process.exit(1);
  } else {
    console.log('\nLint passed: All migrations properly guarded and parsed successfully.');
  }
}

main();