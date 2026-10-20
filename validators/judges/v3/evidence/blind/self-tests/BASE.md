# Base labeller contract

Implement scoreLabeller, labelSetHash, labellerRequestKey and createLabellerReplay using the supplied interfaces. Names compare exactly; none is an implicit valid class. Null abstains; all other undeclared/nonstring answers are invalid. Empty gold, unequal arrays, unknown gold and empty/invalid label sets throw. Raw agreement and empirical Cohen kappa retain all observations; abstain and invalid have distinct prediction-only categories and never agree. Coverage is valid answers/all observations. Perfect single-class agreement uses kappa=1; negative kappa remains negative.

SHA-256 label-set identity includes set name, ordered names and definitions. Request identity includes that hash, exact text, optional context and labeller ID. Replay takes an immutable snapshot of entries, rejects conflicting answers for one key, matches requested labeller ID, and throws on misses. No live fallback.

Advanced methods and defaults are in ADVANCED.md. Node built-ins may be used. You may implement the documented mathematics directly; do not import or inspect the finished labeller module, bank, fixture sources, repository tests, other executors or past evidence.
