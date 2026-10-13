// PLACEHOLDER DATA: NOT RESULTS. Every number below is a layout placeholder for the benchmark charts that
// land when the new result files arrive. Nothing in README.md reads these charts yet, and render.mjs has no
// job for them. When the results land, tools/readme-charts.mjs writes the real entries into chart-data.js
// under the same names, and the README embeds the rendered images.
//
// kind 'ranked': one benchmark, driftbench and every competitor, sorted from highest to lowest, score out of 100,
// the model named. A null score is drawn as an empty bar labelled "no default grader".
// kind 'grid': the four public benchmarks side by side, each a small 'ranked' panel.
window.CHART_TEMPLATE = {
  'bench-template-ranked': {
    kind: 'ranked',
    placeholder: true,
    kicker: 'PLACEHOLDER · benchmark name · test split · model name',
    title: 'PLACEHOLDER: one sentence the result supports.',
    axis: 'score out of 100',
    panels: [
      {
        name: 'Benchmark',
        model: 'Model name',
        bars: [
          { name: 'driftbench', ours: true, score: 50 },
          { name: 'Competitor A', score: 40 },
          { name: 'Competitor B', score: 30 },
          { name: 'Competitor C', score: 20 },
          { name: 'Competitor D', score: null },
        ],
      },
    ],
    note: 'PLACEHOLDER: n items per benchmark · sealed test',
  },
  'bench-template-grid': {
    kind: 'ranked',
    placeholder: true,
    kicker: 'PLACEHOLDER · four public judge benchmarks · test splits',
    title: 'PLACEHOLDER: one sentence the four results support.',
    axis: 'score out of 100',
    panels: ['Benchmark 1', 'Benchmark 2', 'Benchmark 3', 'Benchmark 4'].map((name) => ({
      name,
      model: 'Model name',
      bars: [
        { name: 'driftbench', ours: true, score: 50 },
        { name: 'A', score: 40 },
        { name: 'B', score: 30 },
        { name: 'C', score: null },
      ],
    })),
    note: 'PLACEHOLDER: n items per benchmark',
  },
};
