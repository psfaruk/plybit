// Debug — show what paths findSessionJson() is checking
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

const candidates = [
  process.env.QX_SESSION_FILE,
  join(process.cwd(), 'session.json'),
  join(dirname(process.argv[1] || __dirname), 'session.json'),
  join(__dirname, '..', '..', 'session.json'),
  join(__dirname, '..', 'session.json'),
  '/home/z/my-project/session.json',
].filter(Boolean) as string[];

console.log('cwd:', process.cwd());
console.log('process.argv[1]:', process.argv[1]);
console.log('__dirname:', __dirname);
console.log();
for (const path of candidates) {
  const exists = existsSync(path);
  console.log(`${exists ? '✓' : '✗'} ${path}`);
  if (exists) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      console.log(`  keys: ${Object.keys(data).join(', ')}`);
      console.log(`  has ssid: ${!!data.ssid}, has token: ${!!data.token}, has cookies: ${!!data.cookies}`);
    } catch (e) {
      console.log(`  parse error: ${e}`);
    }
  }
}
