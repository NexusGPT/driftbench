from langchain.tools import tool
from langchain_core.messages import SystemMessage
from langgraph.graph import StateGraph

raise RuntimeError("Fictional fixture: importing or executing this file is forbidden")

policy = SystemMessage(content="Preserve every fictional row identifier.")


@tool
def lookup(key: str):
    """Read a fictional row by identifier."""
    return {"id": key, "amount": 7}


def collect(state):
    return state


def review(state):
    return state


flow = StateGraph(dict)
flow.add_node("collect", collect)
flow.add_node("review", review)
flow.add_edge("collect", "review")
compiled = flow.compile()
