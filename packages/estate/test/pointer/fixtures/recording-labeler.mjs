// A labeler module for the privacy test: a system 2 labeler that keeps every request it is sent (as JSON) in the
// list the test put at globalThis.__pointerSeenTwo, and answers that no unit has a label. Invented.
export default {
  id: 'recording-two',
  cls: 'system2',
  model: 'recording-1',
  label(request) {
    globalThis.__pointerSeenTwo?.push(JSON.stringify(request));
    return { model: 'recording-1', labels: [], usage: { input_tokens: 1, output_tokens: 1 } };
  },
};
