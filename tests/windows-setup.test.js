'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

for (const [scenario, description] of [
  ['journals', 'Windows PowerShell updates configuration, restore and GitHub journals atomically'],
  ['acl', 'Windows PowerShell decodes icacls UTF-16LE and rejects truncated ACL backups']
]) {
  test(description, { skip: process.platform !== 'win32' }, () => {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'helpers', 'windows-setup-regression.ps1'), '-Scenario', scenario], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`PASS ${scenario} on Windows PowerShell 5\\.1`));
  });
}
