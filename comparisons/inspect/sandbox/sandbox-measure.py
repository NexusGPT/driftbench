from inspect_ai import Task, eval, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import Score, Target, scorer, accuracy
from inspect_ai.solver import Generate, TaskState, solver
from inspect_ai.util import sandbox

N = 20_000_000

@solver
def probe():
    async def solve(state: TaskState, generate: Generate):
        result = await sandbox().exec(["python3", "-c", f"import sys; sys.stdout.write('x'*{N})"], timeout=120)
        state.metadata["returncode"] = result.returncode
        state.metadata["stdout_bytes"] = len(result.stdout.encode())
        state.metadata["stdout_is_full"] = len(result.stdout.encode()) == N
        return state
    return solve

@scorer(metrics=[accuracy()])
def report():
    async def score(state: TaskState, target: Target):
        return Score(value=1, explanation=str({k: state.metadata[k] for k in ("returncode", "stdout_bytes", "stdout_is_full")}))
    return score

@task
def sandbox_probe():
    return Task(dataset=[Sample(input="go", target="x")], solver=[probe()], scorer=report(), sandbox="local")

if __name__ == "__main__":
    logs = eval(sandbox_probe(), model="mockllm/model", log_dir="./out/inspect-logs", display="none")
    s = logs[0].samples[0]
    print("explanation:", s.scores["report"].explanation)
    print("error:", logs[0].error)
