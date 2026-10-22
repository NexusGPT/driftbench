/**
 * The second shipped label set: the forms of a gate and of a citation that the main set (`agent-rules`) cannot hold
 * in one unit. It is asked over the same windows as the main set and is data in the format of any user's set, so the
 * text, the hash and the recorded answers of the main set stay as they are.
 *
 * - `gate-split`: the act is asked in one unit and the file to read first is named in the next one
 *   ("Editing a parcel? Read `f` first." is cut at the question mark).
 * - `gate-each`: one unit holds several gates, each with its own act and its own file.
 * - `cites-rule`: an annotation (it builds no atom): the labels of the other rules a rule cites, added to the atom
 *   the main set built for the same unit as `fields.cites`.
 */
export const GATE_FORMS_SET_NAME = 'gate-forms';

const ALSO_REFERENCE = `          also:
            - kind: reference
              title: "Read \${named}"
              situation: $unit
              locate: each
              fields: { readWhen: $unit, from: $file }
              evidence:
                - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
`;

const SET_ITEMS = `  - set: ${GATE_FORMS_SET_NAME}
    description: Forms of a gate and of a citation that one unit of the main set cannot hold.
    spans:
      - name: governed-action
        description: The act that the rule governs or that waits for something, as a user would put it, without the words that order it.
      - name: gate-file
        description: The file a gate tells the reader to read first, exactly as the unit writes it (the code span or the link, with its marks). One span for each gate of a unit that holds several, listed in the order of the gates. Not a file that is only mentioned.
      - name: cited-label
        description: The label of another rule of the estate that the unit cites as a rule, written as the estate writes its rule labels (a letter or two and a number, with or without a hash). One span for each cited rule. Not a form number, an article number, a version or any other code that only looks like a label.
    links:
      - name: act-tool
        description: The tool the reader uses for the act in the governed-action span, not the tool the read uses. Looking up a file is Read, changing a file is Edit or Write, running a command is Bash, handing work to a helper is Agent. Always one of the listed values, the one the act most likely uses, even when the unit names no tool.
        values: [Read, Edit, Write, Bash, Agent]
    labels:
      - name: gate-split
        description: A unit that asks the act that waits, such as a question or a heading, while the NEXT unit tells the reader to read a file first and names it in a code span or a link. Label the unit that holds the act, never the unit that names the file, and give the unit that names the file as the target. Give the act as the governed-action span and the tool that act uses as the act-tool link. Use it only when the unit itself holds no code span and no link that names a file. A single unit that holds both the act and the file is not this label.
        target: required
        paths: { max: 0 }
        spans: [governed-action]
        links: [act-tool]
        atom:
          kind: gate
          title: "Read \${named} before \${span.governed-action}"
          situation: "\${span.governed-action}"
          fields: { first: $named, trigger: "\${span.governed-action}", path: $path }
          evidence:
            - { type: ordered, before: Read, after: $link.act-tool }
            - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
${ALSO_REFERENCE}      - name: gate-each
        description: A unit that holds several gates, each with its own act and its own file named in a code span or a link, such as two orders in one sentence. For each gate give its governed-action span and its gate-file span, so that the nth governed-action goes with the nth gate-file, even when two gates name the same file (then give that file once for each gate). Give the tool the first act uses as the act-tool link. A unit that holds one gate is not this label.
        paths: { min: 2 }
        spans: [governed-action, gate-file]
        links: [act-tool]
        atom:
          kind: gate
          spanEach: governed-action
          spanFile: gate-file
          title: "Read \${named} before \${span.governed-action}"
          situation: "\${span.governed-action}"
          fields: { first: $named, trigger: "\${span.governed-action}", path: $path }
          evidence:
            - { type: ordered, before: Read, after: $link.act-tool }
            - { type: tool_called, label: Read, input: { file_path: { contains: $path } } }
${ALSO_REFERENCE}      - name: cites-rule
        description: A unit that tells the reader to do something and cites another rule of the estate by its label. Give the label of each cited rule as a cited-label span. A label that stands for a form, an article or a version is not a citation. It builds no atom of its own.
        annotate: true
        spans: [cited-label]
        atom:
          kind: instruction
          fields: { "cites?": $spans.cited-label }
`;

/** The set on its own, as a label file. */
export const GATE_FORMS_SET = `labels:\n${SET_ITEMS}`;

/** The sets the estate scan asks by default: the main set, then the gate forms, in one label file. */
export const SHIPPED_LABEL_SETS = (mainSet: string): string => `${mainSet.replace(/\n+$/, '')}\n${SET_ITEMS}`;
