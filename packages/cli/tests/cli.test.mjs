import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,existsSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../bin/horus.mjs',import.meta.url));
test('help and version do not initialize a runtime',()=>{
 const directory=mkdtempSync(join(tmpdir(),'horus-cli-test-'));
 const home=join(directory,'data');
 try {
  const options={encoding:'utf8',env:{...process.env,HORUS_HOME:home}};
  assert.match(execFileSync(process.execPath,[cli,'--help'],options),/horus setup/);
  assert.equal(execFileSync(process.execPath,[cli,'--version'],options).trim(),'0.4.0-beta.1');
  assert.equal(existsSync(home),false);
  const error=spawnSync(process.execPath,[cli,'unknown'],options);
  assert.equal(error.status,1);assert.match(error.stderr,/Unknown command/);
 } finally {if(existsSync(home))rmdirSync(home);rmdirSync(directory);}
});
