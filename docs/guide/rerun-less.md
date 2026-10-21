# Rerun less

harvest

```console
$ cat examples/acme/radius/stage-recap.yaml
(pending)
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/deviation-goal-shift.yaml
(pending)
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/stage-recap.yaml
(pending)
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/tool-coverage-check-input.yaml
(pending)
$ driftbench radius examples/acme/gated/specs --change examples/acme/radius/reply-language.yaml   # exit 1
(pending)
$ driftbench campaign run examples/acme/gated/specs/boundary examples/acme/gated/specs/cover examples/acme/gated/specs/deviation examples/acme/gated/specs/graph examples/acme/gated/specs/metamorphic examples/acme/gated/specs/twise --target function:acme-sales --agent-version acme-v1 --campaign c-base --store acme.db
(pending)
$ driftbench campaign run examples/acme/gated/specs/boundary examples/acme/gated/specs/cover examples/acme/gated/specs/deviation examples/acme/gated/specs/graph examples/acme/gated/specs/metamorphic examples/acme/gated/specs/twise --target function:acme-sales --agent-version acme-v2 --campaign c-v2 --store acme.db --change examples/acme/radius/deviation-goal-shift.yaml --from c-base --audit 20
(pending)
$ driftbench campaign status c-v2 --store acme.db
(pending)
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --campaign cache-1 --store cache.db
(pending)
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --campaign cache-2 --store cache.db
(pending)
$ driftbench campaign run examples/acme/specs/conversations --target function:acme --repeats 2 --campaign cache-3 --store cache.db --no-cache
(pending)
$ driftbench dataset push acme-specs examples/acme/specs/conversations --store versions.db --note 'first push'
(pending)
$ driftbench dataset push acme-specs examples/acme/specs/conversations --store versions.db
(pending)
$ cp -R examples/acme/specs/conversations edited
$ printf '# edited\n' >> edited/plan-upgrade.yaml
$ driftbench dataset push acme-specs edited --store versions.db
(pending)
$ driftbench dataset diff acme-specs@2 --store versions.db   # exit 1
(pending)
$ driftbench campaign run --dataset acme-specs@1 --target function:acme --campaign ds-1 --store versions.db
(pending)
```
