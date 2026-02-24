from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

app = FastAPI(title="Rule-Based Model System")

BASE_DIR = Path(__file__).resolve().parent

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class RuleInput(BaseModel):
    name: str = Field(min_length=1)
    field: str = Field(min_length=1)
    operator: str = Field(pattern=r"^(==|!=|>|<|>=|<=|contains|in)$")
    value: Any
    priority: int = 100


class Rule(RuleInput):
    id: str


class EvaluateRequest(BaseModel):
    facts: dict[str, Any]


class TransitionInput(BaseModel):
    from_state: str = Field(min_length=1)
    event: str = Field(min_length=1)
    to_state: str = Field(min_length=1)


class TransitionDeleteInput(BaseModel):
    from_state: str = Field(min_length=1)
    event: str = Field(min_length=1)


class TriggerRequest(BaseModel):
    event: str = Field(min_length=1)
    from_state: str | None = None


rules: list[Rule] = []

# Start FSM empty so users can build it from scratch in the UI.
fsm_states: set[str] = set()
fsm_transitions: dict[tuple[str, str], str] = {}
fsm_current_state: str | None = None
fsm_history: list[dict[str, Any]] = []
fsm_history_counter = 0


def rebuild_fsm_states() -> None:
    """Recompute FSM states from transitions and ensure current state is valid."""
    global fsm_current_state

    used_states: set[str] = set()
    for (src, _), dst in fsm_transitions.items():
        used_states.add(src)
        used_states.add(dst)

    fsm_states.clear()
    fsm_states.update(used_states)

    if fsm_current_state not in fsm_states:
        fsm_current_state = sorted(fsm_states)[0] if fsm_states else None


def evaluate_single_rule(rule: Rule, facts: dict[str, Any]) -> tuple[bool, str]:
    left = facts.get(rule.field)
    right = rule.value

    try:
        if rule.operator == "==":
            result = left == right
        elif rule.operator == "!=":
            result = left != right
        elif rule.operator == ">":
            result = left > right
        elif rule.operator == "<":
            result = left < right
        elif rule.operator == ">=":
            result = left >= right
        elif rule.operator == "<=":
            result = left <= right
        elif rule.operator == "contains":
            result = right in left if left is not None else False
        elif rule.operator == "in":
            result = left in right if right is not None else False
        else:
            raise ValueError(f"Unsupported operator: {rule.operator}")
    except Exception as exc:
        return False, f"Error evaluating '{rule.name}': {exc}"

    return result, f"{rule.field} {rule.operator} {rule.value} -> {result}"


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "rule-based-model-system"}


@app.get("/api/rules")
def list_rules():
    return {"rules": sorted(rules, key=lambda r: r.priority)}


@app.post("/api/rules")
def add_rule(rule_input: RuleInput):
    rule = Rule(id=str(uuid4()), **rule_input.model_dump())
    rules.append(rule)
    return {"message": "Rule added", "rule": rule}


@app.delete("/api/rules/{rule_id}")
def delete_rule(rule_id: str):
    for idx, rule in enumerate(rules):
        if rule.id == rule_id:
            removed = rules.pop(idx)
            return {"message": "Rule deleted", "rule": removed}
    raise HTTPException(status_code=404, detail="Rule not found")


@app.post("/api/evaluate")
def evaluate_rules(payload: EvaluateRequest):
    ordered = sorted(rules, key=lambda r: r.priority)
    results = []
    passed = 0

    for rule in ordered:
        ok, detail = evaluate_single_rule(rule, payload.facts)
        if ok:
            passed += 1
        results.append(
            {
                "id": rule.id,
                "name": rule.name,
                "priority": rule.priority,
                "matched": ok,
                "detail": detail,
            }
        )

    return {
        "total_rules": len(ordered),
        "matched_rules": passed,
        "results": results,
    }


@app.get("/api/fsm")
def get_fsm():
    transitions = [
        {"from_state": src, "event": event, "to_state": dst}
        for (src, event), dst in sorted(fsm_transitions.items())
    ]
    return {
        "states": sorted(fsm_states),
        "current_state": fsm_current_state,
        "transitions": transitions,
        "history": fsm_history[-20:],
    }


@app.post("/api/fsm/transitions")
def add_transition(payload: TransitionInput):
    global fsm_current_state

    fsm_transitions[(payload.from_state, payload.event)] = payload.to_state

    # If this is the first transition added, default current state to its source.
    if fsm_current_state is None:
        fsm_current_state = payload.from_state

    rebuild_fsm_states()

    return {"message": "Transition added", "transition": payload}


@app.delete("/api/fsm/transitions")
def delete_transition(payload: TransitionDeleteInput):
    key = (payload.from_state, payload.event)
    if key not in fsm_transitions:
        raise HTTPException(status_code=404, detail="Transition not found")

    to_state = fsm_transitions.pop(key)
    rebuild_fsm_states()

    return {
        "message": "Transition deleted",
        "transition": {
            "from_state": payload.from_state,
            "event": payload.event,
            "to_state": to_state,
        },
        "current_state": fsm_current_state,
    }


@app.delete("/api/fsm/transitions/all")
def delete_all_transitions():
    removed = len(fsm_transitions)
    fsm_transitions.clear()
    rebuild_fsm_states()

    return {
        "message": "All transitions deleted",
        "removed_transitions": removed,
        "current_state": fsm_current_state,
    }


@app.delete("/api/fsm/history")
def clear_fsm_history():
    global fsm_history_counter

    removed = len(fsm_history)
    fsm_history.clear()
    fsm_history_counter = 0
    return {"message": "FSM history cleared", "removed_history": removed}


@app.post("/api/fsm/event")
def trigger_event(payload: TriggerRequest):
    global fsm_current_state, fsm_history_counter

    source_state = payload.from_state or fsm_current_state

    if source_state is None:
        raise HTTPException(
            status_code=400,
            detail="Current state is not set. Add a transition first.",
        )

    if source_state not in fsm_states:
        raise HTTPException(
            status_code=400,
            detail=f"State '{source_state}' does not exist in FSM.",
        )

    key = (source_state, payload.event)
    if key not in fsm_transitions:
        raise HTTPException(
            status_code=400,
            detail=f"No transition for state '{source_state}' on event '{payload.event}'",
        )

    next_state = fsm_transitions[key]
    fsm_current_state = next_state
    fsm_history_counter += 1
    fsm_history.append(
        {
            "seq": fsm_history_counter,
            "action": "event",
            "state": fsm_current_state,
            "event": payload.event,
            "from_state": source_state,
            "to_state": next_state,
            "at": datetime.now(UTC).isoformat(),
        }
    )

    return {
        "message": "Transition applied",
        "from_state": source_state,
        "to_state": next_state,
        "event": payload.event,
        "current_state": fsm_current_state,
    }


@app.post("/api/fsm/reset")
def reset_fsm():
    global fsm_current_state, fsm_history_counter

    fsm_states.clear()
    fsm_transitions.clear()
    fsm_current_state = None
    fsm_history.clear()
    fsm_history_counter = 0
    return {"message": "FSM reset", "current_state": fsm_current_state}
