import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loginEmail } from '../src/worker/email.ts';

test('sign-in email carries the link in the text and HTML parts', () => {
  const link = 'https://anyredact.app/account#signin=a%2Bb&x=<y>';
  const m = loginEmail('https://anyredact.app', link, 15);
  assert.match(m.text, /signin=a%2Bb&x=<y>/);
  assert.match(m.text, /15 minutes/);
  assert.ok(m.html.includes('href="https://anyredact.app/account#signin=a%2Bb&#38;x=&#60;y&#62;"'));
  assert.ok(!m.html.includes('<y>'));
  assert.ok(m.html.includes('https://anyredact.app/email-logo.png'));
});
