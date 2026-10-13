# Acme personas

Three fictional people for the simulated user of `@agent-nexus/driftbench-users`. Each file names who the person is,
what they want, the facts they know (given only once the assistant asks for them, by the ask patterns in
`reveal_when_asked`), the stop token they say when the goal is met or abandoned, and the spec they play.
Every name, address, number and email is made up; numbers sit in the reserved range +1 202 555 0100 to 0199
and emails at example.com.

`recordings/` holds answers written by hand, one per turn, which the recording port replays instead of a
model. The simulated user must run on a model family other than the agent's and the judges'; a recording
names the family `hand-written`.
