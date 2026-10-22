/**
 * The Golden Rules of the Pragmatic Segmenter, the edge cases its README lists for sentence segmentation,
 * as data. Source: https://github.com/diasks2/pragmatic_segmenter (README, section "The Golden Rules"),
 * by Kevin S. Dias, MIT licence; the notice is in validators/pointer/THIRD-PARTY.md. Each rule keeps its
 * README number, title and expected sentences verbatim. Only the rules whose answer a shape-only cutter can
 * give and that a markdown paragraph can hold are here; the reason for every rule left out is in
 * bank/specs/golden.ts.
 */
export type GoldenRule = {
  /** ISO 639-1 code of the README section. */
  lang: string;
  /** The rule's number in its README section. */
  n: number;
  title: string;
  /** The README's expected sentences, in order. */
  sentences: string[];
  /** What stands between two sentences in the README input: a space, or nothing. */
  joiner: ' ' | '';
};

export const GOLDEN_RULES: readonly GoldenRule[] = [
  {
    lang: 'en',
    n: 4,
    title: 'One letter upper case abbreviations',
    sentences: ['My name is Jonas E. Smith.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 5,
    title: 'One letter lower case abbreviations',
    sentences: ['Please turn to p. 55.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 6,
    title: 'Two letter lower case abbreviations in the middle of a sentence',
    sentences: ['Were Jane and co. at the party?'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 7,
    title: 'Two letter upper case abbreviations in the middle of a sentence',
    sentences: ['They closed the deal with Pitt, Briggs & Co. at noon.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 8,
    title: 'Two letter lower case abbreviations at the end of a sentence',
    sentences: ["Let's ask Jane and co.", 'They should know.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 11,
    title: 'Two letter (prepositive & postpositive) abbreviations',
    sentences: ["St. Michael's Church is on 5th st. near the light."],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 12,
    title: 'Possesive two letter abbreviations',
    sentences: ["That is JFK Jr.'s book."],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 13,
    title: 'Multi-period abbreviations in the middle of a sentence',
    sentences: ['I visited the U.S.A. last year.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 16,
    title: 'U.S. as non sentence boundary with next word capitalized',
    sentences: ['I work for the U.S. Government in Virginia.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 17,
    title: 'U.S. as non sentence boundary',
    sentences: ['I have lived in the U.S. for 20 years.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 20,
    title: 'Number as sentence boundary',
    sentences: ['She has $100.00.', 'It is in her bag.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 21,
    title: 'Parenthetical inside sentence',
    sentences: [
      'He teaches science (He previously worked for 5 years as an engineer.) at the local University.',
    ],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 22,
    title: 'Email addresses',
    sentences: ['Her email is Jane.Doe@example.com.', 'I sent her an email.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 24,
    title: 'Single quotations inside sentence',
    sentences: ["She turned to him, 'This is great.' she said."],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 25,
    title: 'Double quotations inside sentence',
    sentences: ['She turned to him, "This is great." she said.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 26,
    title: 'Double quotations at the end of a sentence',
    sentences: ['She turned to him, "This is great."', 'She held the book out to show him.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 27,
    title: 'Double punctuation (exclamation point)',
    sentences: ['Hello!!', 'Long time no see.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 28,
    title: 'Double punctuation (question mark)',
    sentences: ['Hello??', 'Who is there?'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 29,
    title: 'Double punctuation (exclamation point / question mark)',
    sentences: ['Hello!?', 'Is that you?'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 30,
    title: 'Double punctuation (question mark / exclamation point)',
    sentences: ['Hello?!', 'Is that you?'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 43,
    title: 'Geo Coordinates',
    sentences: ['You can find it at N°. 1026.253.553.', 'That is where the treasure is.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 46,
    title: 'Ellipsis at end of quotation',
    sentences: [
      'Thoreau argues that by simplifying one’s life, “the laws of the universe will appear less complex. . . .”',
    ],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 47,
    title: 'Ellipsis with square brackets',
    sentences: ['"Bohr [...] used the analogy of parallel stairways [...]" (Smith 55).'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 48,
    title: 'Ellipsis as sentence boundary (standard ellipsis rules)',
    sentences: [
      'If words are left off at the end of a sentence, and that is all that is omitted, indicate the omission with ellipsis marks (preceded and followed by a space) and then indicate the end of the sentence with a period . . . .',
      'Next sentence.',
    ],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 49,
    title: 'Ellipsis as sentence boundary (non-standard ellipsis rules)',
    sentences: ['I never meant that....', 'She left the store.'],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 50,
    title: 'Ellipsis as non sentence boundary',
    sentences: [
      "I wasn’t really ... well, what I mean...see . . . what I'm saying, the thing is . . . I didn’t mean it.",
    ],
    joiner: ' ',
  },
  {
    lang: 'en',
    n: 52,
    title: 'No whitespace in between sentences',
    sentences: [
      'Hello world.',
      'Today is Tuesday.',
      'Mr. Smith went to the store and bought 1,000.',
      'That is a lot.',
    ],
    joiner: '',
  },
  {
    lang: 'de',
    n: 1,
    title: 'Quotation at end of sentence',
    sentences: [
      '„Ich habe heute keine Zeit“, sagte die Frau und flüsterte leise: „Und auch keine Lust.“',
      'Wir haben 1.000.000 Euro.',
    ],
    joiner: ' ',
  },
  {
    lang: 'ja',
    n: 2,
    title: 'Question mark to end sentence',
    sentences: ['それは何ですか？', 'ペンですか？'],
    joiner: '',
  },
  {
    lang: 'ja',
    n: 3,
    title: 'Exclamation point to end sentence',
    sentences: ['良かったね！', 'すごい！'],
    joiner: '',
  },
  {
    lang: 'ja',
    n: 4,
    title: 'Quotation',
    sentences: [
      '自民党税制調査会の幹部は、「引き下げ幅は３．２９％以上を目指すことになる」と指摘していて、今後、公明党と合意したうえで、３０日に決定する与党税制改正大綱に盛り込むことにしています。',
    ],
    joiner: ' ',
  },
  {
    lang: 'ar',
    n: 2,
    title: 'Abbreviations',
    sentences: [
      'وقال د‪.‬ ديفيد ريدي و الأطباء الذين كانوا يعالجونها في مستشفى برمنجهام إنها كانت تعاني من أمراض أخرى.',
      'وليس معروفا ما اذا كانت قد توفيت بسبب اصابتها بأنفلونزا الخنازير.',
    ],
    joiner: ' ',
  },
  {
    lang: 'ar',
    n: 3,
    title: 'Numbers and Dates',
    sentences: [
      'ومن المنتظر أن يكتمل مشروع خط أنابيب نابوكو البالغ طوله 3300 كليومترا في 12‪/‬08‪/‬2014 بتكلفة تُقدر بـ 7.9 مليارات يورو أي نحو 10.9 مليارات دولار.',
      'ومن المقرر أن تصل طاقة ضخ الغاز في المشروع 31 مليار متر مكعب انطلاقا من بحر قزوين مرورا بالنمسا وتركيا ودول البلقان دون المرور على الأراضي الروسية.',
    ],
    joiner: ' ',
  },
  {
    lang: 'it',
    n: 1,
    title: 'Abbreviations',
    sentences: ['Salve Sig.ra Mengoni!', 'Come sta oggi?'],
    joiner: ' ',
  },
  {
    lang: 'it',
    n: 2,
    title: 'Quotations',
    sentences: ['Una lettera si può iniziare in questo modo «Il/la sottoscritto/a.».'],
    joiner: ' ',
  },
  {
    lang: 'it',
    n: 3,
    title: 'Numbers',
    sentences: ['La casa costa 170.500.000,00€!'],
    joiner: ' ',
  },
  {
    lang: 'ru',
    n: 1,
    title: 'Abbreviations',
    sentences: ['Объем составляет 5 куб.м.'],
    joiner: ' ',
  },
  {
    lang: 'ru',
    n: 2,
    title: 'Quotations',
    sentences: ['Маленькая девочка бежала и кричала: «Не видали маму?».'],
    joiner: ' ',
  },
  {
    lang: 'ru',
    n: 3,
    title: 'Numbers',
    sentences: ['Сегодня 27.10.14'],
    joiner: ' ',
  },
  {
    lang: 'es',
    n: 1,
    title: 'Question mark to end sentence',
    sentences: ['¿Cómo está hoy?', 'Espero que muy bien.'],
    joiner: ' ',
  },
  {
    lang: 'es',
    n: 2,
    title: 'Exclamation point to end sentence',
    sentences: ['¡Hola señorita!', 'Espero que muy bien.'],
    joiner: ' ',
  },
  {
    lang: 'es',
    n: 3,
    title: 'Abbreviations',
    sentences: [
      'Hola Srta. Ledesma.',
      'Buenos días, soy el Lic. Naser Pastoriza, y él es mi padre, el Dr. Naser.',
    ],
    joiner: ' ',
  },
  {
    lang: 'es',
    n: 4,
    title: 'Numbers',
    sentences: [
      '¡La casa cuesta $170.500.000,00!',
      '¡Muy costosa!',
      'Se prevé una disminución del 12.5% para el próximo año.',
    ],
    joiner: ' ',
  },
  {
    lang: 'es',
    n: 5,
    title: 'Quotations',
    sentences: ['«Ninguna mente extraordinaria está exenta de un toque de demencia.», dijo Aristóteles.'],
    joiner: ' ',
  },
  {
    lang: 'el',
    n: 1,
    title: 'Question mark to end sentence',
    sentences: [
      'Με συγχωρείτε· πού είναι οι τουαλέτες;',
      'Τις Κυριακές δε δούλευε κανένας.',
      'το κόστος του σπιτιού ήταν £260.950,00.',
    ],
    joiner: ' ',
  },
  {
    lang: 'hi',
    n: 1,
    title: 'Full stop',
    sentences: [
      'सच्चाई यह है कि इसे कोई नहीं जानता।',
      'हो सकता है यह फ़्रेन्को के खिलाफ़ कोई विद्रोह रहा हो, या फिर बेकाबू हो गया कोई आनंदोत्सव।',
    ],
    joiner: ' ',
  },
  {
    lang: 'hy',
    n: 2,
    title: 'Ellipsis',
    sentences: ['Ապրիլի 24-ին սկսեց անձրևել...Այդպես էի գիտեի:'],
    joiner: ' ',
  },
  {
    lang: 'my',
    n: 1,
    title: 'Sentence ending punctuation',
    sentences: ['ခင္ဗ်ားနာမည္ဘယ္လိုေခၚလဲ။', '၇ွင္ေနေကာင္းလား။'],
    joiner: '',
  },
  {
    lang: 'am',
    n: 1,
    title: 'Sentence ending punctuation',
    sentences: ['እንደምን አለህ፧', 'መልካም ቀን ይሁንልህ።', 'እባክሽ ያልሽዉን ድገሚልኝ።'],
    joiner: '',
  },
  {
    lang: 'fa',
    n: 1,
    title: 'Sentence ending punctuation',
    sentences: ['خوشبختم، آقای رضا.', 'شما کجایی هستید؟', 'من از تهران هستم.'],
    joiner: ' ',
  },
  {
    lang: 'ur',
    n: 1,
    title: 'Sentence ending punctuation',
    sentences: ['کیا حال ہے؟', 'ميرا نام ___ ەے۔', 'میں حالا تاوان دےدوں؟'],
    joiner: ' ',
  },
  {
    lang: 'nl',
    n: 1,
    title: 'Sentence starting with a number',
    sentences: [
      'Hij schoot op de JP8-brandstof toen de Surface-to-Air (sam)-missiles op hem af kwamen.',
      '81 procent van de schoten was raak.',
    ],
    joiner: ' ',
  },
  {
    lang: 'nl',
    n: 2,
    title: 'Sentence starting with an ellipsis',
    sentences: ['81 procent van de schoten was raak.', '...en toen barste de hel los.'],
    joiner: ' ',
  },
];
