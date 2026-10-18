export function expected({files}) {
    const rows = JSON.parse(files['input.json']).records;
    const path = "exports/record.json";
    return { slots: {}, blocks: {
      open: {files: [], workspace: {created: [], changed: [], deleted: []}},
      save: {files: [{path, kind: 'json', value: {agent: rows[0].agent, saved: true}}],
        workspace: {created: [path], changed: [], deleted: []},
        must: [path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]}
    }};
  }
