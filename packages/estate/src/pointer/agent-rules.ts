/**
 * The label set that ships for agent estates. It is data in the format of any user's set (`labels:` in a
 * YAML file), loaded by the same parser. The core knows none of these names.
 */
export const AGENT_RULES_SET = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent that reads it.
    labels:
      - name: rule
        description: A unit that tells the reader what to do. A unit about an event that the runtime brings to the agent has its own label instead; a unit about what a person says or asks does not.
        atom: { kind: instruction, polarity: obligation }
      - name: prohibition
        description: A unit that tells the reader what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: gate
        description: A unit that sets an order, one act before another.
        atom: { kind: gate }
      - name: reply-rule
        description: A unit that sets the language, length, format, words or tone of the reader's reply.
        atom: { kind: register }
      - name: hazard-compaction
        description: A unit that says what the agent does when the agent's own conversation or context is compacted, summarised or truncated to fit its window, or that names this as an event of the runtime that the agent must get through. It is something the runtime does to the agent, never something a person asks or says. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: A compaction of the context
          fields: { hazard: compaction }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: compaction } }
      - name: hazard-restart
        description: A unit that says what the agent does when the agent's own process, session host or runtime is restarted or rebooted, or that names this as an event of the runtime that the agent must get through. It is something the runtime does to the agent, never something a person asks or says. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: A process restart
          fields: { hazard: restart }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: restart } }
      - name: hazard-rate-limit
        description: A unit that says what the agent does when the agent itself is rate limited, throttled or refused for sending too many requests, or that names this as an event of the runtime that the agent must get through. It is something the runtime does to the agent, never something a person asks or says. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: A wave of rate limits
          fields: { hazard: rate_wave }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: rate_wave } }
      - name: hazard-new-session
        description: A unit that says what the agent does when the agent starts again in a new session, or resumes where an earlier session left off, or that names this as an event of the runtime that the agent must get through. It is something the runtime does to the agent, never something a person asks or says. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: A new session
          fields: { hazard: session_boundary }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: session_boundary } }
      - name: hazard-notification
        description: A unit that says what the agent does when a helper the agent started reports back to it by a notification message, or that names this as an event of the runtime that the agent must get through. It is something the runtime does to the agent, never something a person asks or says. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: A helper notification
          fields: { hazard: notification }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: notification } }
      - name: hazard-nudge
        description: A unit that says what the agent does when a guard sends the agent the same nudge or reminder again and again, or that names this as an event of the runtime that the agent must get through. It is something the runtime does to the agent, never something a person asks or says. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: Repeated guard nudges
          fields: { hazard: nudge_storm }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: nudge_storm } }
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.
`;
