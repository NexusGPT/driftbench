import asyncio
from inspect_ai.scorer import includes, match, exact
from inspect_ai.scorer._target import Target
from inspect_ai.solver import TaskState
from inspect_ai.model import ChatMessageUser, ModelOutput
cases = [
    ("includes '300' in '3000 Mbps plan'", "3000 Mbps plan", "300"),
    ("includes 'hi' in 'This is fine'", "This is fine", "hi"),
    ("includes 'fiber' in 'Fiber is here'", "Fiber is here", "fiber"),
    ("match exact 'Yes.' vs 'yes'", "yes", "Yes."),
    ("match end 'Mbps' in 'fiber at 300 Mbps.'", "fiber at 300 Mbps.", "Mbps"),
]
async def main():
    for name, output, target in cases:
        state = TaskState(model="mock", sample_id=1, epoch=0, input="q", messages=[ChatMessageUser(content="q")], output=ModelOutput.from_content("mock", output))
        t = Target(target)
        inc = await includes()(state, t)
        ex = await exact()(state, t)
        ma = await match()(state, t)
        print(f"{name:42s} includes={inc.value} exact={ex.value} match={ma.value}")
asyncio.run(main())
