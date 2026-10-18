from inspect_ai import Task, eval, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import Score, Target, scorer, accuracy
from inspect_ai.solver import Generate, TaskState, solver
from inspect_ai.util import sandbox

@solver
def sample_steps():
    async def solve(state: TaskState, generate: Generate):
        box = sandbox()
        if state.sample_id == 1:
            await box.exec(["sh", "-c", "echo from-sample-1 > shared_marker.txt"])
            state.metadata["wrote"] = True
        else:
            r = await box.exec(["sh", "-c", "cat shared_marker.txt 2>&1; echo rc=$?"])
            state.metadata["sees"] = r.stdout.strip()
        for path in ["/etc/hosts", "../secret-outside.txt"]:
            try:
                data = await box.read_file(path)
                state.metadata[f"read {path}"] = f"read {len(data)} bytes"
            except Exception as e:
                state.metadata[f"read {path}"] = f"error {type(e).__name__}"
        return state
    return solve

@scorer(metrics=[accuracy()])
def report():
    async def score(state: TaskState, target: Target):
        return Score(value=1, explanation=str(state.metadata))
    return score

@task
def isolation():
    return Task(dataset=[Sample(input="a", target="x", id=1), Sample(input="b", target="x", id=2)], solver=[sample_steps()], scorer=report(), sandbox="local")

if __name__ == "__main__":
    logs = eval(isolation(), model="mockllm/model", log_dir="./out/iso-logs", display="none", max_samples=1)
    for s in logs[0].samples:
        print(s.id, s.scores["report"].explanation)
    print("error:", logs[0].error)
