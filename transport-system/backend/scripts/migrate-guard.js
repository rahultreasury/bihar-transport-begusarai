#!/usr/bin/env node
/**
 * Critical migration guard with strict exit code preservation and authorization controls.
 * 
 * REQUIREMENTS:
 * 1. Default execution runs `npx migrate status` and reports actual result
 * 2. Failed status commands always block deployment
 * 3. Separate status checking from deployment
 * 4. Remove automatic production deployment from test workflows
 * 5. Require explicit deployment authorization and `PRODUCTION=true`
 * 6. Distinguish failed, pending, and successful migration status
 * 7. Preserve actual process exit codes
 * 8. Never auto-executes resolve, db push, or reset commands
 */
const { execSync } = require('child_process');
const process = require('process');

function runCommand(cmd) {
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return {
      stdout: result || '',
      stderr: '',
      exitCode: 0
    };
  } catch (e) {
    return {
      stdout: (e.stdout || '') + (e.stderr || ''),
      stderr: e.stderr || '',
      exitCode: e.status || 1
    };
  }
}

function analyzeMigrationStatus(status) {
  const lines = status.split('\n');
  let hasFailed = false;
  let hasPending = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Comprehensive detection of failed migrations
    const failureIndicators = [
      /✖/i, /failed/i, /error/i, /error:/i, /exception/i,
      /migration failed/i, /cannot apply/i, /rollback/i
    ];
    
    // Detection of pending migrations
    const pendingIndicators = [
      /not yet applied/i, /pending/i, /in progress/i,
      /to be applied/i, /next/i
    ];
    
    // Detection of successful migrations
    const successIndicators = [
      /applied/i, /reverted/i, /rolled back/i, /✓/i, /ok/i
    ];
    
    let isFailed = false;
    let isPending = false;
    let isSuccess = false;
    
    for (const indicator of failureIndicators) {
      if (indicator.test(trimmed)) {
        isFailed = true;
        break;
      }
    }
    
    for (const indicator of pendingIndicators) {
      if (indicator.test(trimmed)) {
        isPending = true;
        break;
      }
    }
    
    for (const indicator of successIndicators) {
      if (indicator.test(trimmed)) {
        isSuccess = true;
        break;
      }
    }
    
    // Categorize based on indicators
    if (isFailed && !isPending && !isSuccess) {
      hasFailed = true;
    } else if (isPending && !isFailed && !isSuccess) {
      hasPending = true;
    }
  }
  
  return { hasFailed, hasPending };
}

function main() {
  const args = process.argv.slice(2);
  const shouldDeploy = args.includes('--deploy');
  const requiresAuthorization = args.includes('--authorize');
  
  console.log('=== MIGRATION GUARD ===');
  
  // Default behavior: status check only (no deployment)
  if (!shouldDeploy && !requiresAuthorization) {
    console.log('Running migration status check...');
    
    const statusResult = runCommand('npx prisma migrate status');
    console.log(statusResult.stdout);
    
    // Preserve original exit code exactly
    if (statusResult.exitCode !== 0) {
      console.error('\n=== STATUS CHECK FAILED ===');
      console.error('Migration status command failed with exit code:', statusResult.exitCode);
      console.error('This blocks deployment as required.');
      process.exit(statusResult.exitCode);
    }
    
    const statusAnalysis = analyzeMigrationStatus(statusResult.stdout);
    if (statusAnalysis.hasFailed) {
      console.error('\n=== MIGRATION GUARD BLOCKED - FAILED MIGRATIONS ===');
      console.error('Failed migrations detected. Check output above for details.');
      console.error('\nRemediation:');
      console.error('  1. Review the migration status output above.');
      console.error('  2. If a migration failed, investigate the error and fix the migration SQL.');
      console.error('  3. Use `npx prisma migrate resolve --rolled-back <name>` if the migration was partially applied.');
      console.error('  4. Use `npx prisma migrate resolve --applied <name>` ONLY if all intended effects are verified present.');
      console.error('  5. NEVER use `prisma migrate reset` or `prisma db push` in production.');
      console.error('  6. Take a Neon backup before any state-changing operation.');
      process.exit(1);
    }
    
    console.log('\nMigration status check completed successfully.');
    console.log('To proceed with deployment, run with --deploy or --authorize flags.');
    console.log('Environment PRODUCTION=true required for deployment.');
    return;
  }
  
  // Status check analysis
  const statusResult = runCommand('npx prisma migrate status');
  console.log(statusResult.stdout);
  
  if (statusResult.exitCode !== 0) {
    console.error('\n=== STATUS CHECK FAILED ===');
    console.error('Migration status command failed with exit code:', statusResult.exitCode);
    process.exit(statusResult.exitCode);
  }
  
  const statusAnalysis = analyzeMigrationStatus(statusResult.stdout);
  
  // CRITICAL: If there are FAILED migrations, block deployment immediately
  if (statusAnalysis.hasFailed) {
    console.error('\n=== DEPLOYMENT BLOCKED - FAILED MIGRATIONS ===');
    console.error('Found failed migration(s). Check output above for details.');
    console.error('\nRemediation required before deployment.');
    process.exit(1);
  }
  
  // PENDING migrations are allowed but require authorization
  if (statusAnalysis.hasPending) {
    console.log('\n⚠️ WARNING: Pending migrations detected');
    console.log('Note: Pending migrations will be applied during deployment.');
  }
  
  // AUTHORIZATION MODE: Check status only, require manual deployment
  if (requiresAuthorization) {
    console.log('\n=== AUTHORIZATION MODE ===');
    console.log('✅ Migration status check completed.');
    console.log('Execute `npx prisma migrate deploy` manually for deployment.');
    console.log('Set PRODUCTION=true in environment for deployment authorization.');
    process.exit(0);
  }
  
  // DEPLOYMENT MODE: Check status and execute deployment
  if (process.env.PRODUCTION !== 'true') {
    console.error('\n=== AUTHORIZATION REQUIRED ===');
    console.error('PRODUCTION=true required for deployment.');
    console.error('Current PRODUCTION value:', process.env.PRODUCTION || '(not set)');
    process.exit(1);
  }
  
  if (shouldDeploy) {
    console.log('\n=== PRODUCTION DEPLOYMENT AUTHORIZED ===');
    console.log('Environment validation passed. Executing deployment...');
    
    try {
      const deployResult = runCommand('npx prisma migrate deploy');
      console.log(deployResult.stdout);
      
      if (deployResult.exitCode !== 0) {
        console.error('\n=== DEPLOYMENT FAILED ===');
        console.error('Deployment failed with exit code:', deployResult.exitCode);
        process.exit(deployResult.exitCode);
      }
      
    } catch (e) {
      console.error('\n=== DEPLOYMENT FAILED ===');
      console.error('Deployment failed with exit code:', e.status);
      process.exit(e.status || 1);
    }
  }
  
  console.log('\n=== MIGRATION GUARD COMPLETE ===');
}

main();