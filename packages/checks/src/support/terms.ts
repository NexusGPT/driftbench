import { wordsOf } from '@agent-nexus/driftbench-core';
import { confidentLanguage, detect, toDetectorCode } from './language';

/**
 * Key terms of an ask and light stemming, per language, in code, with no network. The language is the
 * ask's own when the detector is sure of it, else the language the spec gives, else English. Words are
 * folded (lower case, accents removed); a key term has four letters or more, is not a number and is not a
 * stop word of its language. Stemming strips one common inflection ending, keeping three letters at least.
 * Languages with a stop list and a stemmer: English, French, Spanish, Dutch, German, Italian, Portuguese;
 * any other language keeps every word of four letters and stems nothing.
 */

const STOP: Record<string, string> = {
  eng:
    'about above after again also always anything been before being both cannot could does done each even ' +
    'ever every from gave give gives going have having here hers into just know like make many more most ' +
    'much must need only other ours over please really same should some something such tell than that ' +
    'their them then there these they this those very want wants what when where which while will with ' +
    'would your yours okay thanks thank',
  fra:
    'alors aussi autre autres avec avez avoir avons bien cela celle celui cette ceux chaque comme comment ' +
    'dans depuis donc dont elle elles encore entre etre fait faire leur leurs mais meme merci moins notre ' +
    'nous peut peux plus pour pourquoi quand quel quelle quelles quels sans selon sont sous suis tous tout ' +
    'toute toutes tres vers votre vous voudrais veux',
  spa:
    'algo como cada cual cuales cuando desde donde ellos esta estas este esto estos gracias hace hacer hasta ' +
    'mientras mucho muchos nada nosotros otra otro para pero poco porque puede puedo quien quiero sobre ' +
    'solo tambien tengo tiene todo todos usted ustedes vuestro',
  nld:
    'alle alles altijd andere bijna daar dank dat deze door echt eens even geen graag heeft hebben hier ' +
    'hoe iets jullie kunnen meer niet niets omdat onze ook over toch tegen veel voor waar wanneer want ' +
    'welk welke wilt willen worden wordt zich zijn zonder zou zouden',
  deu:
    'aber alle alles also auch bitte dann dass denn dich diese dieser dieses doch dort durch eine einem ' +
    'einen einer eines etwas euch gibt habe haben hier ihre immer jetzt kann kein keine mehr mich mein ' +
    'meine muss nach nicht noch oder ohne sein sehr sich sind uber unser viel welche welcher welches wenn ' +
    'werden wieder will wird wollen zwischen danke',
  ita:
    'anche ancora come cosa dove essere fare grazie hanno loro mentre molto nella nelle ogni perche piu ' +
    'poco quale quali quando quanto questa questo sono sulla tutti tutto vorrei',
  por:
    'ainda antes aqui como cada coisa depois esta este isso isto mais muito nada obrigado para pela pelo ' +
    'pode porque quais qual quando quanto quem sobre tambem tenho todos voce',
};

const STOPS = new Map(Object.entries(STOP).map(([lang, list]) => [lang, new Set(list.split(' '))]));

/** Endings stripped, the first that fits, longest first within each language. */
const ENDINGS: Record<string, readonly string[]> = {
  eng: ['ies', 'ing', 'est', 'ed', 'es', 'er', 'ly', 's'],
  fra: ['ements', 'ement', 'ations', 'ation', 'euses', 'euse', 'ent', 'es', 'e', 's', 'x'],
  spa: ['aciones', 'acion', 'mente', 'idades', 'idad', 'es', 'os', 'as', 'en', 'o', 'a', 'e'],
  nld: ['heden', 'heid', 'ingen', 'ing', 'ste', 'en', 'e', 's'],
  deu: [
    'ungen',
    'ung',
    'heiten',
    'heit',
    'keiten',
    'keit',
    'ste',
    'ern',
    'em',
    'en',
    'er',
    'es',
    'e',
    's',
    'n',
  ],
  ita: ['azioni', 'azione', 'mente', 'i', 'e', 'o', 'a'],
  por: ['acoes', 'acao', 'mente', 'os', 'as', 'es', 'o', 'a', 'e'],
};

/** Lower case, accents removed. */
export function fold(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** One inflection ending stripped, the stem keeping three letters at least. */
export function stemOf(word: string, lang: string): string {
  let stem = fold(word);
  for (const ending of ENDINGS[lang] ?? []) {
    if (stem.length - ending.length >= 3 && stem.endsWith(ending)) {
      stem = stem.slice(0, -ending.length);
      break;
    }
  }
  return stem;
}

/** True when a reply word carries the term: the same stem, or one stem extending the other by one letter (a verb ending such as Dutch biedt). */
export function termMatches(term: string, word: string, lang: string): boolean {
  const a = stemOf(term, lang);
  const b = stemOf(word, lang);
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short) && long.length - short.length === 1;
}

/** The language of an ask: the detector's when sure, else the spec's, else English. */
export function askLanguage(ask: string, fallback?: string): string {
  const sure = confidentLanguage(detect(ask, { minLetters: 20, margin: 0.05 }));
  if (sure !== undefined) return sure;
  return (fallback === undefined ? undefined : toDetectorCode(fallback)) ?? 'eng';
}

/** The key terms of an ask, folded, in order, once each, and the language they were read in. */
export function keyTerms(ask: string, fallback?: string): { lang: string; terms: string[] } {
  const lang = askLanguage(ask, fallback);
  const stop = STOPS.get(lang) ?? new Set<string>();
  const words = wordsOf(ask).map(fold);
  const terms = [
    ...new Set(words.filter((word) => word.length >= 4 && !/^\d+$/.test(word) && !stop.has(word))),
  ];
  return { lang, terms };
}
