import { describe, expect, it } from 'vitest';
import { relevancy } from '../src/checks/relevancy';
import { keyTerms, stemOf } from '../src/support/terms';
import { acme } from './support/acme';
import { context, observed, run } from './support/context';

const upgrade = acme('acme-plan-upgrade');

/** One ask per language, a reply that answers it with inflected forms, and one that does not. */
const pairs = [
  {
    lang: 'EN',
    ask: 'Which plans include more mobile data, and how much does the cheapest one cost each month?',
    terms: ['plans', 'include', 'mobile', 'data', 'cheapest', 'cost', 'month'],
    good: 'Our cheaper plan includes 40 GB of mobile data and costs $25 monthly; the unlimited plan costs $35.',
    bad: 'Our stores are open Monday to Saturday, from nine in the morning until six, and closed on Sunday.',
  },
  {
    lang: 'FR',
    ask: 'Quels forfaits proposent plus de données mobiles, et combien coûte le moins cher chaque mois ?',
    terms: ['forfaits', 'proposent', 'donnees', 'mobiles', 'combien', 'coute', 'cher', 'mois'],
    good: 'Le forfait Mobile M propose 40 Go de données mobiles et coûte 25 dollars par mois ; il est le moins cher.',
    bad: 'Nos magasins sont ouverts du lundi au samedi, de neuf heures à dix-huit heures, et fermés le dimanche.',
  },
  {
    lang: 'ES',
    ask: '¿Qué tarifas ofrecen más datos móviles y cuánto cuesta la más barata cada mes?',
    terms: ['tarifas', 'ofrecen', 'datos', 'moviles', 'cuanto', 'cuesta', 'barata'],
    good: 'La tarifa Mobile M ofrece 40 GB de datos móviles y cuesta 25 dólares al mes; es la tarifa más barata.',
    bad: 'Nuestras tiendas abren de lunes a sábado, de nueve de la mañana a seis de la tarde, y cierran el domingo.',
  },
  {
    lang: 'NL',
    ask: 'Welke abonnementen bieden meer mobiele data, en hoeveel kost het goedkoopste per maand?',
    terms: ['abonnementen', 'bieden', 'mobiele', 'data', 'hoeveel', 'kost', 'goedkoopste', 'maand'],
    good: 'Het abonnement Mobile M biedt 40 GB mobiele data en kost 25 dollar per maand; dat is het goedkoopste abonnement.',
    bad: 'Onze winkels zijn open van maandag tot zaterdag, van negen tot zes uur, en op zondag gesloten.',
  },
  {
    lang: 'DE',
    ask: 'Welche Tarife bieten mehr mobile Daten, und wie viel kostet der günstigste pro Monat?',
    terms: ['tarife', 'bieten', 'mobile', 'daten', 'kostet', 'gunstigste', 'monat'],
    good: 'Der Tarif Mobile M bietet 40 GB mobiler Daten und kostet 25 Dollar im Monat; er ist der günstigste Tarif.',
    bad: 'Unsere Geschäfte sind von Montag bis Samstag von neun bis achtzehn Uhr geöffnet und sonntags geschlossen.',
  },
];

describe('relevancy in every language the lang check is tested on', () => {
  it.each(pairs)('$lang: the key terms of the ask drop the stop words of the language', ({ ask, terms }) => {
    expect(keyTerms(ask).terms).toEqual(terms);
  });

  it.each(pairs)(
    '$lang: the answering reply passes on inflected forms, the store hours fail',
    async ({ ask, good, bad }) => {
      const block = { ...upgrade.blocks[1], when: { user: ask } } as NonNullable<
        (typeof upgrade.blocks)[number]
      >;
      const pass = (
        await run(relevancy, context(upgrade, 1, observed(good), { block, expect: { relevancy: {} } }))
      )[0];
      const fail = (
        await run(relevancy, context(upgrade, 1, observed(bad), { block, expect: { relevancy: {} } }))
      )[0];
      expect(pass?.outcome, pass?.evidence).toBe('pass');
      expect(fail?.outcome, fail?.evidence).toBe('fail');
      expect(fail?.score).toBe(0);
    },
  );

  it('stems lightly per language, with accents folded', () => {
    expect(['plans', 'costs', 'cheapest'].map((word) => stemOf(word, 'eng'))).toEqual([
      'plan',
      'cost',
      'cheap',
    ]);
    expect(['forfaits', 'données', 'coûte'].map((word) => stemOf(word, 'fra'))).toEqual([
      'forfait',
      'donne',
      'cout',
    ]);
    expect(['tarifas', 'datos', 'móviles'].map((word) => stemOf(word, 'spa'))).toEqual([
      'tarif',
      'dat',
      'movil',
    ]);
    expect(['abonnementen', 'mobiele', 'goedkoopste'].map((word) => stemOf(word, 'nld'))).toEqual([
      'abonnement',
      'mobiel',
      'goedkoop',
    ]);
    expect(['tarife', 'mobiler', 'günstigste'].map((word) => stemOf(word, 'deu'))).toEqual([
      'tarif',
      'mobil',
      'gunstig',
    ]);
  });

  it('names the language it read the ask in, and falls back to the spec language on a short ask', async () => {
    expect(keyTerms(pairs[1]?.ask ?? '').lang).toBe('fra');
    expect(keyTerms('Forfaits moins chers ?', 'FR').lang).toBe('fra');
    expect(keyTerms('Forfaits moins chers ?', 'FR').terms).toEqual(['forfaits', 'chers']);
  });
});
