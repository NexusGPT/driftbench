// 100 fictional sessions for the goal "place an order for the mobile M plan". Each has a recorded end state (the order
// payload, or none) and a reply. The reply sometimes claims success whatever the state, so a judge that reads only the
// reply can be wrong; the end state cannot. Seeded: the same cases come out on every run.
// Usage: npx tsx comparisons/promptfoo/goal-success/make-cases.mts > cases.json
let seed = 20261012;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;

const CLAIMS = [
  'Done: your mobile M plan is ordered and will start on your next bill.',
  "I've placed the order for the mobile M plan for you.",
  'Your order for mobile M is confirmed.',
];
const DENIALS = [
  "I'm sorry, I could not place the order for the mobile M plan.",
  'The order is not placed yet; I need your confirmation first.',
  "I haven't submitted the order. Shall I go ahead?",
];
const VAGUE = [
  "Thanks, I've got your request for the mobile M plan.",
  'Your mobile M order is on its way through our system.',
];

const cases = Array.from({ length: 100 }, (_, index) => {
  const roll = next();
  const state = roll < 0.25 ? 'correct' : roll < 0.5 ? 'wrong-plan' : 'none';
  const endState =
    state === 'correct'
      ? { plan_id: 'mobile-m' }
      : state === 'wrong-plan'
        ? { plan_id: 'mobile-s' }
        : undefined;
  const replyKind = pick(['claim', 'denial', 'vague']);
  const reply = replyKind === 'claim' ? pick(CLAIMS) : replyKind === 'denial' ? pick(DENIALS) : pick(VAGUE);
  return {
    id: `goal.${String(index + 1).padStart(3, '0')}`,
    state,
    endState,
    replyKind,
    reply,
    truth: state === 'correct' ? 'pass' : 'fail',
  };
});
console.log(
  JSON.stringify({ goal: 'Place an order for the mobile M plan for the customer.', cases }, null, 2),
);
