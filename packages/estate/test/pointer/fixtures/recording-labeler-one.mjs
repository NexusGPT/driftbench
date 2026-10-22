// A labeler module for the privacy test: a system 1 labeler that keeps every request it is sent (as JSON) in the
// list the test put at globalThis.__pointerSeenOne, and answers with no probability. Invented.
export default {
  id: 'recording-one',
  cls: 'system1',
  model: 'recording-1',
  label(request) {
    globalThis.__pointerSeenOne?.push(JSON.stringify(request));
    return { model: 'recording-1', probabilities: {}, usage: { input_tokens: 1, output_tokens: 1 } };
  },
};
