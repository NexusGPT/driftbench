# Factuality against a reference (not loaded by the council)

`factual_against_reference.yaml` is a judged criterion whose input is the block's reference, a file the block
seeds in its Given workspace. It is not in `examples/acme/criteria`: a criterion there needs calibration labels,
a scripted cassette and an assignment-table row before the council will run it (see the criteria workflow).

Measured with haiku through the Claude command on 10 fictional cases, 3 repeats each: 30 of 30 verdicts correct,
no unparsed answers, 0.003 USD in total.
