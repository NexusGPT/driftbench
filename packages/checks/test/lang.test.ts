import type { Expect } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { createLangCheck, lang } from '../src/checks/lang';
import { detect, toDetectorCode } from '../src/support/language';
import { acme, perturbation } from './support/acme';
import { context, history, observed, outcomes, run, verdict } from './support/context';

const upgrade = acme('acme-plan-upgrade');
const identify =
  "Hi, I'm the Acme Telecom sales assistant. I can help you move to a plan with more data. What is the email address on your Acme account?";
const offer =
  'Thanks, Sam. You are on Acme Mobile S, 10 GB for $15 a month. Plans with more data: Acme Mobile M, 40 GB for $25 a month; Acme Mobile L, unlimited data for $35 a month. Which one would you like: Acme Mobile M or Acme Mobile L?';
const offerInFrench =
  'Merci, Sam. Vous avez Acme Mobile S, 10 Go pour 15 $ par mois. Les forfaits avec plus de données sont Acme Mobile M et Acme Mobile L. Lequel voulez-vous choisir ?';
const withLang = (block: number): Expect => ({ ...upgrade.blocks[block]?.expect, lang: 'EN' });

describe('lang', () => {
  it('passes block 1 of acme-plan-upgrade: the reply reads as EN and stays in the language of block 0', async () => {
    const ctx = context(upgrade, 1, observed(offer), {
      expect: withLang(1),
      history: history([observed(identify)]),
    });
    const verdicts = await run(lang, ctx);
    expect(outcomes(verdicts)).toEqual({ 'lang.expected': 'pass', 'lang.stable': 'pass' });
    expect(verdict(verdicts, 'lang.expected').evidence).toBe('1 text segment read as eng (EN)');
    expect(verdict(verdicts, 'lang.stable').evidence).toMatch(
      /^the reply stays in eng; the run speaks eng since block 0 /,
    );
  });

  it('mutation: the reply switches to French; lang.expected and lang.stable fail and name the segment', async () => {
    const ctx = context(upgrade, 1, observed(offerInFrench), {
      expect: withLang(1),
      history: history([observed(identify)]),
    });
    const verdicts = await run(lang, ctx);
    expect(outcomes(verdicts)).toEqual({ 'lang.expected': 'fail', 'lang.stable': 'fail' });
    expect(verdict(verdicts, 'lang.expected').evidence).toMatch(
      /^EN expected; segment 0 reads as fra, not eng \(eng scores 0\.\d\d at best\): "Merci, Sam\./,
    );
    expect(verdict(verdicts, 'lang.stable').evidence).toMatch(
      /^segment 0 reads as fra: "Merci, Sam\..*"; the run speaks eng since block 0 \("Hi, I'm the Acme/,
    );
  });

  it('reads an English reply full of names as English, where franc alone scores French first', async () => {
    const tricky =
      'Done. A sales advisor will call you at +1 202 555 0131 about home internet at 88 Summit Avenue, Acmeville. Your reference is LEAD-10C86C.';
    const spec = acme('acme-new-customer-coverage');
    const ctx = context(spec, 3, observed(tricky), { expect: { lang: 'EN' } });
    expect(outcomes(await run(lang, ctx))).toEqual({ 'lang.expected': 'pass', 'lang.stable': 'pass' });
  });

  it('holds the D5 perturbation of acme-number-porting: a Spanish question, an English answer', async () => {
    const spec = acme('acme-number-porting');
    const injected = perturbation('acme-number-porting', 'spanish-line');
    const before = history([
      observed(
        "Hi, I'm the Acme Telecom sales assistant. Happy to help you switch and keep your number. Which number do you want to bring to Acme?",
      ),
    ]);
    const ctx = (text: string) =>
      context(spec, injected.inject_at, observed(text), {
        mode: 'P',
        expect: injected.expect ?? {},
        history: before,
      });
    const english = await run(
      lang,
      ctx(
        'I can only help in English for now. Which one would you like: Acme Mobile S, Acme Mobile M or Acme Mobile L?',
      ),
    );
    expect(outcomes(english)).toEqual({ 'lang.stable': 'pass' });
    const spanish = await run(
      lang,
      ctx(
        'Lo siento, solo puedo ayudar en inglés por ahora. ¿Cuál le gustaría: Acme Mobile S, Acme Mobile M o Acme Mobile L?',
      ),
    );
    expect(verdict(spanish, 'lang.stable').evidence).toMatch(/^segment 0 reads as spa: /);
  });

  it('is inconclusive and does not gate on a reply too short to judge', async () => {
    const ctx = context(upgrade, 4, observed("You're welcome, Sam. Have a good day."), {
      expect: withLang(4),
    });
    const verdicts = await run(lang, ctx);
    expect(verdicts.map((item) => [item.id, item.outcome, item.gating])).toEqual([
      ['lang.expected', 'inconclusive', false],
      ['lang.stable', 'inconclusive', false],
    ]);
    expect(verdict(verdicts, 'lang.expected').evidence).toBe(
      'no text segment has 30 letters or more, too short to tell its language (segment 0: 27 letters)',
    );
  });

  it('maps spec codes to the detector, and is inconclusive on a language it has no model for', async () => {
    expect(['EN', 'fr', 'NL', 'de-BE', 'fr_BE', 'eng'].map(toDetectorCode)).toEqual([
      'eng',
      'fra',
      'nld',
      'deu',
      'fra',
      'eng',
    ]);
    const french = context(upgrade, 1, observed(offerInFrench), { expect: { lang: 'fr-BE' } });
    expect(outcomes(await run(lang, { ...french, spec: { ...upgrade, rules: {} } }))).toEqual({
      'lang.expected': 'pass',
    });
    const unknown = context(upgrade, 1, observed(offer), {
      expect: { lang: 'LB' },
      spec: { ...upgrade, rules: {} },
    });
    const [only] = await run(lang, unknown);
    expect(only).toMatchObject({ outcome: 'inconclusive', gating: false });
    expect(only?.evidence).toBe('the detector has no model for the language LB');
  });

  it('can be tuned: a lower letter threshold judges the short closing reply', async () => {
    const short = createLangCheck({ minLetters: 10, margin: 0.25 });
    const ctx = context(upgrade, 4, observed("You're welcome, Sam. Have a good day."), {
      expect: withLang(4),
      spec: { ...upgrade, rules: {} },
    });
    expect(outcomes(await run(short, ctx))).toEqual({ 'lang.expected': 'pass' });
  });

  it('does not apply without expect.lang or rules.lang_stable', () => {
    const spec = { ...upgrade, rules: {} };
    expect(lang.applies(context(spec, 1, observed(offer)))).toBe(false);
    expect(detect('Bonjour').readings).toEqual([]);
  });
});

describe('detect, memoised', () => {
  it('gives the same detection for the same text and letter floor, and a fresh one for another floor', () => {
    const first = detect(offer);
    expect(detect(offer)).toBe(first);
    const loose = detect(offer, { minLetters: 10, margin: 0.05 });
    expect(loose).not.toBe(first);
    expect(detect(offer, { minLetters: 10, margin: 0.05 })).toBe(loose);
    // A floor above the text's letters judges nothing, whatever an earlier call cached.
    const strict = detect(offer, { minLetters: 100_000, margin: 0.05 });
    expect(strict.readings).toEqual([]);
    expect(first.readings.length).toBeGreaterThan(0);
  });

  it('caches what a fresh detection computes: the cached reading equals a recomputed one', () => {
    const text = `${offerInFrench} ${Date.now()}`;
    const cold = detect(text);
    // Short fillers: below the letter floor they are cheap to detect, and each still takes a cache entry.
    for (let i = 0; i < 5000; i += 1) detect(`ok ${i}`);
    // The cache holds 4096 entries: the first text was evicted and is computed again, equal to the first.
    const again = detect(text);
    expect(again).not.toBe(cold);
    expect(again).toEqual(cold);
  });
});

describe('lang: short English fallbacks', () => {
  const English = [
    'Sorry, I did not get that. Would you like Acme Air 5G?',
    'I can only help with Acme plans and orders. Would you like Acme Air 5G?',
    'Sorry, I did not understand that. Could you say it again?',
    'Sorry, I did not get that. Which one would you like: Acme Mobile M or Acme Mobile L?',
  ];
  it.each(English)('reads %j as English', async (text) => {
    const ctx = context(upgrade, 1, observed(text), { expect: withLang(1) });
    expect(outcomes(await run(lang, ctx))['lang.expected']).toBe('pass');
  });

  it('still flags a short French reply as not English: the fix does not give up on short texts', async () => {
    const french =
      "Désolé, je n'ai pas bien compris votre demande, pouvez-vous la répéter, s'il vous plaît ?";
    const ctx = context(upgrade, 1, observed(french), { expect: withLang(1) });
    expect(outcomes(await run(lang, ctx))['lang.expected']).toBe('fail');
  });
});
