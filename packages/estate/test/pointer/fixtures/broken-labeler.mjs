// A labeler module whose service is down: every call throws. Invented.
export default {
  id: 'harbour-down',
  cls: 'system2',
  label() {
    throw new Error('the harbour service is down');
  },
};
