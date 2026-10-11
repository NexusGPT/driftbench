import type { IntakeMap } from '../../src/intake';

/** A small fictional map: a bank assistant with three stages, two flows, two channels. */
export const ZED_MAP: IntakeMap = {
  agent: 'zed',
  dimensions: [
    {
      id: 'stage',
      title: 'Stages',
      kind: 'stage',
      values: [
        { id: 'greet', title: 'The agent greets' },
        { id: 'verify', title: 'The agent asks for the last four digits of the card' },
        { id: 'help', title: 'The agent helps' },
      ],
    },
    {
      id: 'flow',
      title: 'Flows',
      kind: 'behaviour',
      values: [
        { id: 'balance', title: 'A customer asks for their balance' },
        { id: 'card-lost', title: 'A customer reports a lost card' },
      ],
    },
    {
      id: 'user_type',
      title: 'Who writes',
      kind: 'persona',
      values: [
        { id: 'customer', title: 'A bank customer' },
        { id: 'staff', title: 'Bank staff' },
      ],
    },
    {
      id: 'language',
      title: 'Language',
      kind: 'persona',
      values: [
        { id: 'english', title: 'English' },
        { id: 'other-language', title: 'Another language' },
      ],
    },
    {
      id: 'channel',
      title: 'Channels',
      kind: 'channel',
      values: [
        { id: 'chat', title: 'Chat' },
        { id: 'email', title: 'Email' },
      ],
    },
  ],
  constraints: [{ forbid: { flow: 'balance', channel: 'email' }, reason: 'balance is on chat only' }],
  phrases: [],
};

export const ZED_ANSWERS = `version: 1
agent: zed
map: map.yaml
personas:
  - id: saver
    description: A customer who checks their account often
    share: 3
    map: { user_type: customer }
    tone: short and polite
    languages: [en, nl]
    channels: [chat, email]
  - id: teller
    description: A bank teller who asks on behalf of a customer
    share: 1
    map: { user_type: staff }
    languages: [en]
    channels: [chat]
intents:
  - { value: balance, share: 2 }
  - { value: card-lost, share: 1, personas: [saver] }
examples:
  - stage: greet
    intent: balance
    persona: saver
    turns: ["hi, what's my balance?", "balance please"]
  - stage: verify
    intent: card-lost
    persona: saver
    turns: ["the last four are 1234"]
  - stage: help
    intent: balance
    persona: teller
    turns: ["my customer wants to know her balance"]
  - stage: help
    intent: card-lost
    persona: teller
    turns: ["a customer lost a card"]
never:
  - text: Users never ask for investment advice
    match: [invest]
tone: short messages, few typos
languages:
  - { lang: en, share: 9, map: { language: english } }
  - { lang: nl, share: 1, map: { language: other-language } }
channels:
  - { value: chat, share: 4 }
  - { value: email, share: 1 }
`;
