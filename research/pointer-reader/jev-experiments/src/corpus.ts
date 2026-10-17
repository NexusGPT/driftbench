// Corpus switch: CORPUS=5 points the phase 4 machinery at the growth corpus (gold5s.json: three estates, key = units on which the author and the Opus annotator agree).
export const C5 = process.env.CORPUS === '5';
export const GOLD_FILE = C5 ? 'gold5s.json' : 'gold3.json';
export const PROSE_DIR = C5 ? 'prose5' : 'prose3';
export const ESTATE_KEY = C5 ? 'phase5-growth' : 'phase3-repair-cafe';
export const R4_DIR = C5 ? 'results45' : 'results4';
export const HAIKU_DIR = C5 ? 'results5h' : 'results3';
export const HAIKU_CASSETTE = C5 ? 'cassette5-haiku.jsonl.gz' : 'cassette3-haiku.jsonl.gz';
export const HEADS_DIR = C5 ? 'heads5' : 'heads4';
export const JEV_CASSETTE = C5 ? 'cassette45' : 'cassette4';
