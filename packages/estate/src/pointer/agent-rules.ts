/**
 * The label set that ships for agent estates. It is data in the format of any user's set (`labels:` in a
 * YAML file), loaded by the same parser. The core knows none of these names.
 */
/**
 * A unit that is a rule of any kind and names a file of the estate in a code span is also a reference to read:
 * the file is found by the estate's own places, never by words. A code span that leads to no file builds nothing.
 */
const ALSO_REFERENCE = `          also:
            - kind: reference
              whenFile: true
              title: "Read \${code}"
              situation: $unit
              fields: { readWhen: $unit, from: $file }
              evidence:
                - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
`;

export const AGENT_RULES_SET = `labels:
  - set: agent-rules
    description: What an instruction file asks of the agent that reads it.
    spans:
      - name: governed-action
        description: The act that the rule governs or that waits for something, as a user would put it, without the words that order it.
      - name: first-call
        description: Inside the governed-action span, the call of the tool that must come first, as the unit writes it, in the fewest words that tell it from the other call, such as the command or the file name, with no quote marks and no word that orders it.
        within: governed-action
      - name: second-call
        description: Inside the governed-action span, the call of the same tool that must come second, as the unit writes it, in the fewest words that tell it from the other call, with no quote marks and no word that orders it.
        within: governed-action
    links:
      - name: act-tool
        description: The tool the reader uses for that act.
        values: [Read, Edit, Write, Bash, Agent]
    labels:
      - name: rule
        description: A unit that tells the reader what to do. A unit about an event the agent must get through has its own label instead.
        atom:
          kind: instruction
          polarity: obligation
${ALSO_REFERENCE}      - name: prohibition
        description: A unit that tells the reader what never to do.
        atom:
          kind: instruction
          polarity: prohibition
${ALSO_REFERENCE}
      - name: gate
        description: A unit that tells the reader to read a file first, before an act. Its file is the first code span of the unit. Give the act as the governed-action span and the tool that act uses as the act-tool link.
        spans: [governed-action]
        links: [act-tool]
        atom:
          kind: gate
          title: "Read \${code} before \${span.governed-action}"
          situation: "\${span.governed-action}"
          fields: { first: $code, trigger: "\${span.governed-action}", path: $path }
          evidence:
            - { type: ordered, before: Read, after: $link.act-tool }
            - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
          also:
            - kind: reference
              title: "Read \${code}"
              situation: $unit
              locate: true
              fields: { readWhen: $unit, from: $file }
              evidence:
                - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
      - name: gate-command
        description: A unit that tells the reader to run a command first, before an act. Its command is the first code span of the unit. Give the act as the governed-action span and the tool that act uses as the act-tool link.
        spans: [governed-action]
        links: [act-tool]
        atom:
          kind: gate
          title: "Read \${code} before \${span.governed-action}"
          situation: "\${span.governed-action}"
          fields: { first: $code, trigger: "\${span.governed-action}" }
          evidence:
            - { type: ordered, before: Bash, after: $link.act-tool }
            - { type: tool_called, label: Bash, input: { command: { contains: $code } } }
      - name: gate-calls
        description: A unit that orders two calls of one tool, one before the other, such as a command that must run before another command. Give the act that waits as the governed-action span, the two calls as the first-call and second-call spans inside it, and the tool as the act-tool link.
        spans: [governed-action, first-call, second-call]
        links: [act-tool]
        atom:
          kind: gate
          title: "Run \${span.first-call} before \${span.second-call}"
          situation: "\${span.governed-action}"
          fields: { first: "\${span.first-call}", second: "\${span.second-call}", trigger: "\${span.governed-action}" }
          evidence:
            - { type: ordered, before: "\${link.act-tool}~\${span.first-call}", after: "\${link.act-tool}~\${span.second-call}" }
      - name: reference
        description: A unit that tells the reader to read a file, or says where a file is that it can read, with no act that must wait for it. Its file is the first code span of the unit.
        atom:
          kind: reference
          title: "Read \${code}"
          situation: $unit
          locate: true
          fields: { readWhen: $unit, from: $file }
          evidence:
            - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
      - name: reply-rule
        description: A unit that sets the language, length, format, words or tone of the reader's reply.
        atom:
          kind: register
${ALSO_REFERENCE}
      - name: hazard-compaction
        description: A unit that says what the agent does when the agent's own conversation or context is compacted, summarised or truncated to fit its window, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: A compaction of the context
          fields: { hazard: compaction }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: compaction } }
${ALSO_REFERENCE}      - name: hazard-restart
        description: A unit that says what the agent does when the agent's own process, session host or runtime is restarted or rebooted, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: A process restart
          fields: { hazard: restart }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: restart } }
${ALSO_REFERENCE}      - name: hazard-rate-limit
        description: A unit that says what the agent does when the agent itself is rate limited, throttled or refused for sending too many requests, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: A wave of rate limits
          fields: { hazard: rate_wave }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: rate_wave } }
${ALSO_REFERENCE}      - name: hazard-new-session
        description: A unit that says what the agent does when the agent starts again in a new session, or resumes where an earlier session left off, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: A new session
          fields: { hazard: session_boundary }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: session_boundary } }
${ALSO_REFERENCE}      - name: hazard-notification
        description: A unit that says what the agent does when a helper the agent started reports back to it by a notification message, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: A helper notification
          fields: { hazard: notification }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: notification } }
${ALSO_REFERENCE}      - name: hazard-nudge
        description: A unit that says what the agent does when a guard sends the agent the same nudge or reminder again and again, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, and not an example.
        atom:
          kind: hazard
          situation: Repeated guard nudges
          fields: { hazard: nudge_storm }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: nudge_storm } }
${ALSO_REFERENCE}      - name: condition
        description: A unit that only says when another unit applies, such as a circumstance, a state of the world or a kind of request, and tells the reader nothing to do by itself. Give the unit it scopes as the target.
        target: required
        condition: true
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.
`;
