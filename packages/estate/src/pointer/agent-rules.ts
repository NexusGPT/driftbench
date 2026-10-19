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
              whenFile: each
              title: "Read \${named}"
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
      - name: situation
        description: The circumstance in which the unit applies, in the unit's own words, such as a state of the world, a kind of request or a moment. Not the act the unit orders. Give it only when the unit states one.
      - name: ask-text
        description: A clause of the unit, as it stands, that a user could say as a complete request which makes the reader do what the unit orders or refuse what it forbids. Give it only when the unit holds such a clause.
      - name: retry
        description: The clause of the unit that orders the reader to try the failed request again. Give it only when the unit has one.
      - name: reread-self
        description: The clause of the unit that orders the reader to read again the file the unit itself is in ("this file"), as opposed to a file it names. Give it only when the unit has one.
    links:
      - name: act-tool
        description: The tool the reader uses for the act in the governed-action span, not the tool the read uses. Looking up a file is Read, changing a file is Edit or Write, running a command is Bash, handing work to a helper is Agent. Always one of the listed values, the one the act most likely uses, even when the unit names no tool.
        values: [Read, Edit, Write, Bash, Agent]
      - name: reply-act
        description: The act of the reply that the rule governs, when its task needs the reader to answer in words. answer supplies requested information, clarify asks for missing information, refuse declines the act, report states a result or a status, draft composes material for review, acknowledge confirms receipt. Leave it out when the rule governs no reply.
        values: [answer, clarify, refuse, report, draft, acknowledge]
      - name: reply-part
        description: The part of the output that carries the act in the reply-act link. reply is the reply itself, draft is the draft the reader composes for review. Give it with every reply-act link.
        values: [reply, draft]
      - name: order-key
        description: The input that both acts of an ordered pair share, when the rule orders a read and a change of the same object. Leave it out when the rule names a file.
        values: [file_path, command, path, url, pattern]
      - name: dispatches
        description: The helper agent that the unit tells the reader to hand work to.
        to: [subagent]
      - name: route-skill
        description: The skill that the request loads.
        to: [skill]
      - name: route-helper
        description: The helper agent that the request dispatches.
        to: [subagent]
    labels:
      - name: rule
        description: A unit that tells the reader to do something. A unit that only forbids is a prohibition, and a unit about an event the agent must get through has its own label instead.
        spans: [situation, ask-text]
        links: [reply-act, reply-part]
        atom:
          kind: instruction
          situation: $span.situation?
          polarity: obligation
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          fields: { "ask?": { text: $span.ask-text, "context?": $span.situation } }
${ALSO_REFERENCE}      - name: dispatch
        description: A unit that tells the reader to hand work to a helper agent. Give that helper as the dispatches link. A unit that only names a helper, or says not to use it, is a rule or a prohibition.
        spans: [situation, ask-text]
        links: [dispatches, reply-act, reply-part]
        atom:
          kind: instruction
          situation: $span.situation?
          polarity: obligation
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          fields: { "ask?": { text: $span.ask-text, "context?": $span.situation } }
${ALSO_REFERENCE}      - name: prohibition
        description: A unit that tells the reader never to do something, or not to do it. The unit holds never, do not or must not, even when it names a file, a folder or a command.
        spans: [situation, ask-text]
        links: [reply-act, reply-part]
        atom:
          kind: instruction
          situation: $span.situation?
          polarity: prohibition
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          fields: { "ask?": { text: $span.ask-text, "context?": $span.situation } }
${ALSO_REFERENCE}
      - name: gate
        description: A unit that tells the reader to read a file first, before an act, and names that file in a code span or a link. A unit that says to read a file without naming it is a rule. Its file is the first code span of the unit. Give the act as the governed-action span and the tool that act uses as the act-tool link.
        spans: [governed-action]
        links: [act-tool, reply-act, reply-part, order-key]
        atom:
          kind: gate
          title: "Read \${named} before \${span.governed-action}"
          situation: "\${span.governed-action}"
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          fields: { first: $named, trigger: "\${span.governed-action}", path: $path, "order?": { key: $link.order-key } }
          evidence:
            - { type: ordered, before: Read, after: $link.act-tool }
            - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
          also:
            - kind: reference
              title: "Read \${named}"
              situation: $unit
              locate: each
              fields: { readWhen: $unit, from: $file }
              evidence:
                - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
      - name: gate-command
        description: A unit that tells the reader to run a command first, before an act. Its command is the first code span of the unit. Give the act as the governed-action span and the tool that act uses as the act-tool link.
        spans: [governed-action]
        links: [act-tool, reply-act, reply-part, order-key]
        atom:
          kind: gate
          title: "Read \${code} before \${span.governed-action}"
          situation: "\${span.governed-action}"
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          fields: { first: $code, trigger: "\${span.governed-action}", "order?": { key: $link.order-key } }
          evidence:
            - { type: ordered, before: Bash, after: $link.act-tool }
            - { type: tool_called, label: Bash, input: { command: { contains: $code } } }
      - name: reference
        description: A unit that tells the reader to read a file, or says where a file is that it can read, with no act that must wait for it. Its file is the first code span of the unit.
        atom:
          kind: reference
          title: "Read \${named}"
          situation: $unit
          locate: each
          fields: { readWhen: $unit, from: $file }
          evidence:
            - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
      - name: reply-rule
        description: A unit that sets the language, length, format, words or tone of the reader's reply.
        spans: [situation, ask-text]
        links: [reply-act, reply-part]
        atom:
          kind: register
          situation: $span.situation?
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          fields: { "ask?": { text: $span.ask-text, "context?": $span.situation } }
${ALSO_REFERENCE}
      - name: hazard-compaction
        description: A unit that says what the agent does when the agent's own conversation or context is compacted, summarised or truncated to fit its window, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, not an example, and not a unit triggered by what the user says or asks, which is a rule.
        spans: [ask-text, retry, reread-self]
        links: [reply-act, reply-part]
        atom:
          kind: hazard
          situation: A compaction of the context
          fields: { hazard: compaction, "ask?": { text: $span.ask-text } }
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: compaction, reread: $paths, "rereadSelf?": $has.reread-self, "calls?": { each: $commands, item: { label: Bash, input: { command: { contains: $item } } } }, "retry?": $has.retry } }
${ALSO_REFERENCE}      - name: hazard-restart
        description: A unit that says what the agent does when the agent's own process, session host or runtime is restarted or rebooted, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, not an example, and not a unit triggered by what the user says or asks, which is a rule.
        spans: [ask-text, retry, reread-self]
        links: [reply-act, reply-part]
        atom:
          kind: hazard
          situation: A process restart
          fields: { hazard: restart, "ask?": { text: $span.ask-text } }
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: restart, reread: $paths, "rereadSelf?": $has.reread-self, "calls?": { each: $commands, item: { label: Bash, input: { command: { contains: $item } } } }, "retry?": $has.retry } }
${ALSO_REFERENCE}      - name: hazard-rate-limit
        description: A unit that says what the agent does when the agent itself is rate limited, throttled or refused for sending too many requests, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, not an example, and not a unit triggered by what the user says or asks, which is a rule.
        spans: [ask-text, retry, reread-self]
        links: [reply-act, reply-part]
        atom:
          kind: hazard
          situation: A wave of rate limits
          fields: { hazard: rate_wave, "ask?": { text: $span.ask-text } }
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: rate_wave, reread: $paths, "rereadSelf?": $has.reread-self, "calls?": { each: $commands, item: { label: Bash, input: { command: { contains: $item } } } }, "retry?": $has.retry } }
${ALSO_REFERENCE}      - name: hazard-new-session
        description: A unit that says what the agent does when the agent starts again in a new session, or resumes where an earlier session left off, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, not an example, and not a unit triggered by what the user says or asks, which is a rule.
        spans: [ask-text, retry, reread-self]
        links: [reply-act, reply-part]
        atom:
          kind: hazard
          situation: A new session
          fields: { hazard: session_boundary, "ask?": { text: $span.ask-text } }
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: session_boundary, reread: $paths, "rereadSelf?": $has.reread-self, "calls?": { each: $commands, item: { label: Bash, input: { command: { contains: $item } } } }, "retry?": $has.retry } }
${ALSO_REFERENCE}      - name: hazard-notification
        description: A unit that says what the agent does when a helper the agent started reports back to it by a notification message, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, not an example, and not a unit triggered by what the user says or asks, which is a rule.
        spans: [ask-text, retry, reread-self]
        links: [reply-act, reply-part]
        atom:
          kind: hazard
          situation: A helper notification
          fields: { hazard: notification, "ask?": { text: $span.ask-text } }
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: notification, reread: $paths, "rereadSelf?": $has.reread-self, "calls?": { each: $commands, item: { label: Bash, input: { command: { contains: $item } } } }, "retry?": $has.retry } }
${ALSO_REFERENCE}      - name: hazard-nudge
        description: A unit that says what the agent does when a guard sends the agent the same nudge or reminder again and again, or that names this as an event the agent must get through. Not a unit that only mentions the word for a file, a table or someone else's system, not an example, and not a unit triggered by what the user says or asks, which is a rule.
        spans: [ask-text, retry, reread-self]
        links: [reply-act, reply-part]
        atom:
          kind: hazard
          situation: Repeated guard nudges
          fields: { hazard: nudge_storm, "ask?": { text: $span.ask-text } }
          replyAct: { id: $link.reply-act, evidence: { type: text_segment, part: $link.reply-part } }
          evidence:
            - { type: custom, name: hazard_recovery, options: { hazard: nudge_storm, reread: $paths, "rereadSelf?": $has.reread-self, "calls?": { each: $commands, item: { label: Bash, input: { command: { contains: $item } } } }, "retry?": $has.retry } }
${ALSO_REFERENCE}      - name: route-skill
        description: A unit that is the request itself, in the words of a user, for which the reader loads a skill, such as the request cell of a routing table. Label the unit that holds the request, never the unit that names the skill. Give the unit that names the skill as the target, and that skill as the link. Not a unit that only says what a skill can do, and not a request for which the reader loads nothing.
        target: required
        links: [route-skill]
        atom:
          kind: route
          title: "An ask to \${unit} loads \${link.route-skill.name}"
          situation: $unit
          fields: { target: $link.route-skill.name, targetKind: skill, via: pointer, ask: $unit }
          evidence:
            - { type: skill_loaded, name: $link.route-skill.name }
      - name: route-helper
        description: A unit that is the request itself, in the words of a user, for which the reader dispatches a helper agent, such as the request cell of a routing table. Label the unit that holds the request, never the unit that names the helper. Give the unit that names the helper as the target, and that helper as the link. Not a unit that only says what a helper can do, and not a request for which the reader dispatches nothing.
        target: required
        links: [route-helper]
        atom:
          kind: route
          title: "An ask to \${unit} dispatches \${link.route-helper.name}"
          situation: $unit
          fields: { target: $link.route-helper.name, targetKind: subagent, via: pointer, ask: $unit }
          evidence:
            - { type: tool_called, label: Agent, input: { subagent_type: $link.route-helper.name } }
      - name: condition
        description: A unit that only says when another unit applies, such as a circumstance, a state of the world or a kind of request, and tells the reader nothing to do by itself. A unit that starts with a circumstance but also tells the reader to do something is not a condition. Give the unit it scopes as the target.
        target: required
        condition: true
      - name: example
        description: A unit that shows a case and is not itself an instruction.
      - name: description
        description: A unit that states how something is, with no instruction.
`;
