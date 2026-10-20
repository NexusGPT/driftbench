// A labeler module for the contract test: a system 2 labeler that calls a line with "Never" a prohibition and
// a line that starts with a verb of the harbour a rule. Invented; it reads the window it is sent and nothing else.
const VERBS = /^(?:- )?(Hang|Close|Check|Tie)\b/;
export default {
  id: 'harbour-rules',
  cls: 'system2',
  model: 'harbour-1',
  label(request) {
    const labels = request.window.units.map((unit) => ({
      units: String(unit.n),
      label: /^(?:- )?Never\b/.test(unit.text) ? 'prohibition' : VERBS.test(unit.text) ? 'rule' : 'none',
    }));
    return { model: 'harbour-1', labels, usage: { input_tokens: 40, output_tokens: 8 } };
  },
};
