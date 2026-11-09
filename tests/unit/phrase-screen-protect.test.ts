// Windows twin of Android Q0309: the recovery phrase window is kept out of screenshots and recording.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(p, 'utf8');

describe('recovery phrase screen protection', () => {
  it('main sets content protection on the app windows from PROTECT_SCREEN', () => {
    expect(read('src/main/ipc.ts')).toMatch(/\[IPC\.PROTECT_SCREEN\]: \(on: boolean\) => \{ for \(const w of BrowserWindow\.getAllWindows\(\)\) w\.setContentProtection\(on === true\); \}/);
  });

  it('the phrase card turns protection on when it opens and off when it closes', () => {
    const src = read('src/renderer/src/screens/Onboarding.tsx');
    const card = src.slice(src.indexOf('function PhraseCard'), src.indexOf('if (checking) {', src.indexOf('function PhraseCard')));
    expect(card).toMatch(/call\(window\.api\.IPC\.PROTECT_SCREEN, true/);
    expect(card).toMatch(/return \(\) => \{ void call\(window\.api\.IPC\.PROTECT_SCREEN, false/);
  });
});
