# Diagnose and fix

```yaml
# file: specs/order.yaml
id: acme-order-confirm-guide
title: A home internet order placed only after CONFIRM
channel: chat
lang: EN
target: { adapter: function, agent: acme-sales }
blocks:
  - id: details
    user: Jo Okafor, jo.okafor@example.com
    expect:
      tools:
        - { label: order.create, count: 0 }
      must: ['CONFIRM']
  - id: loose-yes
    user: ok perfect
    expect:
      tools:
        - { label: order.create, count: 0 }
      must: ['Thank you for choosing']
  - id: confirm
    user: CONFIRM
    expect:
      tools:
        - { label: order.create, count: 1 }
metadata:
  links:
    - { block: details, to: { kind: prompt_section, prompt: acme-sales, section: new_customer_details }, status: declared, created_by: author }
    - { block: details, to: { kind: prompt_section, prompt: acme-sales, section: recap }, status: declared, created_by: author }
    - { block: loose-yes, to: { kind: prompt_section, prompt: acme-sales, section: explicit_confirm }, status: declared, created_by: author }
    - { block: confirm, to: { kind: prompt_section, prompt: acme-sales, section: explicit_confirm }, status: declared, created_by: author }
```

```markdown
# file: mini.md
## Persona
You are the Acme sales assistant. Keep replies short.

## Recap
Before any order, read the plan back and wait for the customer to say yes.

## Ordering
Call order.create only after the customer confirms the recap.
```

```yaml
# file: rules/driftbench.yaml
plugins: []
```

```yaml
# file: rules/specs/wording.yaml
id: acme-wording
target: { adapter: function, agent: acme-sales }
blocks:
  - id: ask
    user: Hi, I'm already an Acme customer and I want more data.
    expect:
      must: ['email address', 'Thank you']
```

```yaml
# file: rules/driftbench/check-set/acme.yaml
kind: check-set
id: acme
extends: default
items:
  - id: must
    enabled: false
```

```console
$ driftbench spec lint specs --sections examples/acme/prompts/acme-sales.sections.yaml
(pending)
$ driftbench radius sections init mini.md --id mini --prompt-version v1 --out mini.sections.yaml
(pending)
$ driftbench radius sections check mini.sections.yaml --prompt mini.md
(pending)
$ driftbench radius sections check examples/acme/prompts/acme-sales.sections.yaml --prompt examples/acme/prompts/acme-sales.md
(pending)
$ driftbench campaign run specs --target function:acme-sales --store runs.db --campaign bad   # exit 1
(pending)
$ driftbench campaign status bad --store runs.db   # exit 1
(pending)
$ driftbench campaign status bad --store runs.db --json   # exit 1
(pending)
$ driftbench campaign status bad --store runs.db --detail   # exit 1
(pending)
$ driftbench radius localize specs --store runs.db --campaign bad --sections examples/acme/prompts/acme-sales.sections.yaml
(pending)
$ cd rules
$ driftbench object list
(pending)
$ driftbench object show check-set/acme
(pending)
$ driftbench object explain check-set --at specs/wording.yaml
(pending)
$ driftbench campaign run specs/wording.yaml --target function:acme-sales --agent-version acme-v1 --campaign full --store runs.db   # exit 1
(pending)
$ driftbench campaign rejudge specs/wording.yaml --from full --campaign acme --store runs.db --use check-set/acme
(pending)
$ driftbench campaign status acme --store runs.db
(pending)
$ driftbench campaign status full --store runs.db --json   # exit 1
(pending)
$ driftbench campaign status acme --store runs.db --json
(pending)
$ cd ..
$ mkdir -p nw/specs
$ cp examples/northwind-campaign/specs/weekly-report.yaml nw/specs/weekly-report.yaml
$ sed -i.bak -e 's|\.\./\.\./estates|../../../examples/estates|' -e 's/must: \[.open.\]/must: [quarterly]/' nw/specs/weekly-report.yaml
$ grep -n "quarterly\|approved.yaml" nw/specs/weekly-report.yaml
(pending)
$ driftbench --plugin examples/northwind-campaign/plugin.mjs campaign run nw/specs --target claude-code:northwind --driver simulated --persona examples/northwind-campaign/personas/marta-lindqvist.yaml --recording examples/northwind-campaign/personas/recordings/marta-lindqvist.yaml --agent-family anthropic --no-cache --store nw.db --campaign nw-bad   # exit 1
(pending)
$ driftbench campaign status nw-bad --store nw.db --json   # exit 1
(pending)
$ driftbench report nw-bad --store nw.db --out nw.html
(pending)
$ grep -o "rewrite_description\|strengthen_rule" nw.html
(pending)
```
