# Read the numbers

```console
$ driftbench campaign plan examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --repeats 5 --baseline-rate 0.9 --rho 0.3
(pending)
$ driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --agent-version v1 --store runs.db --campaign v1
(pending)
$ driftbench report v1 --store runs.db --out v1.html --junit v1.xml
(pending)
$ sed -n 1,4p v1.xml
(pending)
$ driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --agent-version v2 --store runs.db --campaign v2
(pending)
$ driftbench compare --baseline v1 --candidate v2 --store runs.db
(pending)
$ driftbench compare --baseline v1 --candidate v2 --store runs.db --margin 10   # exit 1
(pending)
$ driftbench ci --specs examples/acme/golden/specs --target fault:control-sales-identity --faults examples/acme/faults --route flow:price-sheet=process:acme-ops --agent-version v1b --baseline v1 --store runs.db --out control-ci.json
(pending)
$ driftbench ci --specs examples/acme/golden/specs --target fault:x3-skips-recap --faults examples/acme/faults --route flow:price-sheet=process:acme-ops --agent-version v3 --baseline v1 --store runs.db --out v3-ci.json   # exit 1
(pending)
$ driftbench report --store runs.db --baseline v1 --out v3-vs-v1.html
(pending)
$ driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --agent-version v4 --store runs.db --campaign v4
(pending)
$ driftbench monitor --store runs.db --metric pass_rate --window 2   # exit 1
(pending)
$ driftbench monitor --store runs.db --metric pass_rate
(pending)
```
