# Run your agent

harvest

```js
// file: agent.mjs
import { existsSync, readFileSync } from 'node:fs';

const message = readFileSync(0, 'utf8').trim();
const history = JSON.parse(readFileSync(process.env.DRIFTBENCH_HISTORY_FILE, 'utf8'));
const orders = existsSync('orders.json') ? JSON.parse(readFileSync('orders.json', 'utf8')) : {};
const order = message.match(/\bA-\d+\b/)?.[0];

if (/refund/i.test(message)) {
  console.log('I can help with a refund. What is your order number?');
} else if (order && orders[order]) {
  console.log(`Refund started for order ${order}. You will get an email within 2 days.`);
} else if (order) {
  console.log(`I cannot find order ${order}.`);
} else {
  console.log(`Sorry, I did not get that. (${history.length} messages so far)`);
}
```

```yaml
# file: specs/refund.yaml
id: refund-happy-path
title: A customer asks for a refund and gives an order number
target: { adapter: process, agent: my-agent }

given:
  world:
    workspace:
      files: { orders.json: '{"A-1042": {"status": "paid", "total": 49.90}}' }
  vars: { channel: web-chat }

blocks:
  - user: Hi, I would like a refund please.
    expect:
      must: ['order number']
      must_not: ['Refund started']

  - given:
      prefix:
        - { role: user, content: 'Hi, I would like a refund please.' }
        - { role: assistant, content: 'I can help with a refund. What is your order number?' }
    user: It is A-1042.
    expect:
      must: ['Refund started', 'A-1042']
      must_not: ['Sorry']
```

```console
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --campaign fn-1
(pending)
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --campaign fn-all
(pending)
$ driftbench spec validate specs
(pending)
$ driftbench campaign run specs --target process:my-agent --process-command "[\"node\",\"$PWD/agent.mjs\"]" --campaign proc-1
(pending)
$ sed 's/Refund started for order/Started a return for/' agent.mjs > broken-agent.mjs
$ driftbench campaign run specs --target process:my-agent --process-command "[\"node\",\"$PWD/broken-agent.mjs\"]" --campaign proc-2   # exit 1
(pending)
$ driftbench campaign plan examples/acme/specs/conversations --target function:acme --repeats 2
(pending)
$ driftbench campaign plan examples/acme/specs/conversations --target function:acme --repeats 10 --rho 0.3
(pending)
$ driftbench campaign plan examples/acme/specs/conversations --target function:acme --mode X   # exit 2
(pending)
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --mode T,F,P --campaign modes-1 --store runs.db
(pending)
$ driftbench campaign status modes-1 --store runs.db --detail
(pending)
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 3 --campaign rep-1 --store runs.db
(pending)
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 3 --campaign rep-2 --store runs.db
(pending)
$ driftbench campaign status rep-1 --store runs.db
(pending)
$ driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml
(pending)
$ driftbench attack examples/acme/specs/conversations/order-loose-confirmation.yaml --rounds 10 --seed 0
(pending)
$ driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2
(pending)
$ driftbench perturb examples/acme/specs/conversations/order-loose-confirmation.yaml --perturbation second-loose-yes --faults examples/acme/faults --target fault:d4-order-on-loose-yes   # exit 1
(pending)
$ driftbench campaign run examples/acme/specs/tasks/price-sheet.yaml --campaign ops-1
(pending)
```
