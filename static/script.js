function formatJson(obj) {
    return JSON.stringify(obj, null, 2);
}

let latestEvaluationDetails = null;
let fsmStateColors = {};
let latestFsmData = null;

function formatState(value) {
    return value ?? "not set";
}

const FSM_PALETTE = [
    "#0ea5e9",
    "#f97316",
    "#22c55e",
    "#a855f7",
    "#ef4444",
    "#14b8a6",
    "#eab308",
    "#06b6d4",
];

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function ensureFsmStateColors(states) {
    states.forEach((state, index) => {
        if (!fsmStateColors[state]) {
            fsmStateColors[state] = FSM_PALETTE[Object.keys(fsmStateColors).length % FSM_PALETTE.length] || FSM_PALETTE[index % FSM_PALETTE.length];
        }
    });
}

function renderFsmLegend(states, currentState) {
    const legend = document.getElementById("fsmStateLegend");
    if (!legend) return;

    if (!states.length) {
        legend.innerHTML = "<div class='meta'>No states available.</div>";
        return;
    }

    ensureFsmStateColors(states);

    legend.innerHTML = states
        .map((state) => {
            const color = fsmStateColors[state];
            const active = state === currentState ? "active" : "";
            return `
                <div class="state-pill ${active}" style="--state-color: ${color}">
                    <span class="state-dot"></span>
                    <span>${escapeHtml(state)}</span>
                </div>
            `;
        })
        .join("");
}

function renderFsmTransitions(transitions) {
    const list = document.getElementById("fsmTransitionList");
    if (!list) return;

    if (!transitions.length) {
        list.innerHTML = "<li><div><strong>No transitions</strong></div></li>";
        return;
    }

    list.innerHTML = transitions
        .map((item) => {
            const fromColor = fsmStateColors[item.from_state] || "#64748b";
            const toColor = fsmStateColors[item.to_state] || "#64748b";
            return `
                <li>
                    <div class="transition-row">
                        <span class="mini-state" style="--state-color: ${fromColor}">${escapeHtml(item.from_state)}</span>
                        <span class="transition-event">-- ${escapeHtml(item.event)} --></span>
                        <span class="mini-state" style="--state-color: ${toColor}">${escapeHtml(item.to_state)}</span>
                        <button
                            class="danger transition-delete-btn"
                            data-from-state="${escapeHtml(item.from_state)}"
                            data-event="${escapeHtml(item.event)}"
                            type="button"
                        >
                            Delete
                        </button>
                    </div>
                </li>
            `;
        })
        .join("");

    list.querySelectorAll(".transition-delete-btn").forEach((button) => {
        button.addEventListener("click", async () => {
            await deleteTransition(button.dataset.fromState, button.dataset.event);
        });
    });
}

function renderFsmHistory(history) {
    const list = document.getElementById("fsmHistoryList");
    if (!list) return;

    if (!history.length) {
        list.innerHTML = "<li><div><strong>No history yet</strong><div class='meta'>Apply an event to generate history records.</div></div></li>";
        return;
    }

    const recent = [...history].reverse().slice(0, 10);

    list.innerHTML = recent
        .map((step, idx) => {
            const color = fsmStateColors[step.state] || "#64748b";
            const sequence = step.seq ?? (idx + 1);
            const fromState = step.from_state ?? "?";
            const toState = step.to_state ?? step.state ?? "?";
            const eventName = step.event ?? "unknown";
            const rawTime = step.at;
            const timeText = rawTime ? new Date(rawTime).toLocaleString() : "time unavailable";
            return `
                <li>
                    <div>
                        <strong>Step #${escapeHtml(sequence)}</strong>
                        <div class="meta">
                            ${escapeHtml(fromState)} --${escapeHtml(eventName)}--> 
                            <span class="inline-state" style="--state-color: ${color}">${escapeHtml(toState)}</span>
                        </div>
                        <div class="meta">Recorded: ${escapeHtml(timeText)}</div>
                    </div>
                </li>
            `;
        })
        .join("");
}

function renderFsmVisual(states, transitions, currentState) {
    const visual = document.getElementById("fsmVisual");
    if (!visual) return;

    if (!states.length) {
        visual.innerHTML = "<div class='meta'>No states to visualize.</div>";
        return;
    }

    const width = 1200;
    const height = 560;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.33;

    const positions = {};
    states.forEach((state, index) => {
        const angle = (-Math.PI / 2) + ((2 * Math.PI * index) / states.length);
        positions[state] = {
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle),
        };
    });

    const usableTransitions = transitions.filter((tr) => positions[tr.from_state] && positions[tr.to_state]);
    const pairUsage = {};

    const links = usableTransitions
        .map((tr) => {
            const from = positions[tr.from_state];
            const to = positions[tr.to_state];
            const edgeColor = fsmStateColors[tr.from_state] || "#94a3b8";

            // Draw self-loop when transition returns to same state.
            if (tr.from_state === tr.to_state) {
                const loopRadius = 22;
                const startX = from.x + 10;
                const startY = from.y - 22;
                const d = `M ${startX} ${startY} a ${loopRadius} ${loopRadius} 0 1 1 1 0`;
                return `
                    <path d="${d}" fill="none" stroke="${edgeColor}" stroke-width="2.4" marker-end="url(#arrowhead)" opacity="0.85"></path>
                    <text x="${from.x + 26}" y="${from.y - 42}" class="fsm-link-label">${escapeHtml(tr.event)}</text>
                `;
            }

            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const distance = Math.hypot(dx, dy) || 1;
            const ux = dx / distance;
            const uy = dy / distance;
            const nx = -uy;
            const ny = ux;

            const ordered = [tr.from_state, tr.to_state].sort();
            const pairKey = `${ordered[0]}|${ordered[1]}`;
            const usage = pairUsage[pairKey] || { aToB: 0, bToA: 0, a: ordered[0], b: ordered[1] };
            const forward = tr.from_state === usage.a;
            if (forward) {
                usage.aToB += 1;
            } else {
                usage.bToA += 1;
            }
            pairUsage[pairKey] = usage;

            const sequence = forward ? usage.aToB : usage.bToA;
            const curveOffset = (forward ? 1 : -1) * (14 + ((sequence - 1) * 10));

            const nodeRadius = 28;
            const sx = from.x + (ux * nodeRadius);
            const sy = from.y + (uy * nodeRadius);
            const ex = to.x - (ux * nodeRadius);
            const ey = to.y - (uy * nodeRadius);
            const cxp = ((sx + ex) / 2) + (nx * curveOffset);
            const cyp = ((sy + ey) / 2) + (ny * curveOffset);

            const d = `M ${sx} ${sy} Q ${cxp} ${cyp} ${ex} ${ey}`;
            const labelX = ((sx + ex) / 2) + (nx * (curveOffset * 0.8));
            const labelY = ((sy + ey) / 2) + (ny * (curveOffset * 0.8)) - 4;

            return `
                <path d="${d}" fill="none" stroke="${edgeColor}" stroke-width="2.2" marker-end="url(#arrowhead)" opacity="0.82"></path>
                <text x="${labelX}" y="${labelY}" class="fsm-link-label">${escapeHtml(tr.event)}</text>
            `;
        })
        .join("");

    const nodes = states
        .map((state) => {
            const pos = positions[state];
            const color = fsmStateColors[state] || "#64748b";
            const isActive = state === currentState;
            return `
                <g>
                    <circle cx="${pos.x}" cy="${pos.y}" r="${isActive ? 31 : 25}" fill="${color}" opacity="${isActive ? "0.95" : "0.85"}"></circle>
                    <circle cx="${pos.x}" cy="${pos.y}" r="${isActive ? 36 : 0}" fill="none" stroke="${color}" stroke-width="3" opacity="0.4"></circle>
                    <text x="${pos.x}" y="${pos.y + 4}" class="fsm-node-label">${escapeHtml(state)}</text>
                </g>
            `;
        })
        .join("");

    visual.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" class="fsm-svg" role="img" aria-label="Finite State Machine graph">
            <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#64748b"></polygon>
                </marker>
            </defs>
            ${links}
            ${nodes}
        </svg>
    `;
}

function populateEventFromStateSelector(states, currentState) {
    const selector = document.getElementById("eventFromState");
    if (!selector) return;

    const previousValue = selector.value;
    const currentLabel = currentState ? `Use current state (${currentState})` : "Use current state";

    selector.innerHTML = `<option value="">${escapeHtml(currentLabel)}</option>`;

    states.forEach((state) => {
        const option = document.createElement("option");
        option.value = state;
        option.textContent = state;
        selector.appendChild(option);
    });

    if (previousValue && states.includes(previousValue)) {
        selector.value = previousValue;
    }
}

function getEventSourceState(currentState) {
    const selector = document.getElementById("eventFromState");
    if (selector && selector.value) return selector.value;
    return currentState;
}

function renderAvailableEvents(currentState, transitions) {
    const container = document.getElementById("fsmAvailableEvents");
    if (!container) return;

    const sourceState = getEventSourceState(currentState);

    if (!sourceState) {
        container.innerHTML = "<span class='meta'>Available events: none (current state is not set). Add a transition first.</span>";
        return;
    }

    const currentTransitions = transitions.filter((item) => item.from_state === sourceState);

    if (!currentTransitions.length) {
        container.innerHTML = `<span class='meta'>Available events from <strong>${escapeHtml(sourceState)}</strong>: none.</span>`;
        return;
    }

    const chips = currentTransitions
        .map(
            (item) => `
                <button
                    type="button"
                    class="secondary event-chip"
                    data-event="${escapeHtml(item.event)}"
                    title="Apply event '${escapeHtml(item.event)}'"
                >
                    ${escapeHtml(item.event)}
                </button>
            `
        )
        .join("");

    container.innerHTML = `
        <span class="meta">Available events from <strong>${escapeHtml(sourceState)}</strong>:</span>
        <div class="event-chip-row">${chips}</div>
    `;

    container.querySelectorAll(".event-chip").forEach((button) => {
        button.addEventListener("click", async () => {
            const eventInput = document.getElementById("eventInput");
            eventInput.value = button.dataset.event;
            await triggerEvent();
        });
    });
}

function normalizeError(payload) {
    if (!payload) return "Request failed";
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
        return payload.detail
            .map((item) => {
                const location = Array.isArray(item.loc) ? item.loc.join(".") : "request";
                return `${location}: ${item.msg}`;
            })
            .join(" | ");
    }
    if (payload.message) return payload.message;
    return "Request failed";
}

function parseMaybeJson(value) {
    const trimmed = value.trim();
    if (!trimmed) return "";

    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
}

async function callApi(path, method = "GET", body = null) {
    const options = { method, headers: {} };

    if (body !== null) {
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    const response = await fetch(path, options);
    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        throw new Error(normalizeError(payload));
    }

    return payload;
}

function renderRules(rules) {
    const rulesList = document.getElementById("rulesList");
    rulesList.innerHTML = "";

    const orderedRules = [...rules].sort((a, b) => {
        const priorityDiff = a.priority - b.priority;
        if (priorityDiff !== 0) return priorityDiff;
        return String(a.id).localeCompare(String(b.id));
    });

    orderedRules.forEach((rule, index) => {
        const li = document.createElement("li");
        li.innerHTML = `
            <div>
                <strong>Order ${index + 1}: ${rule.name}</strong>
                <div class="meta">id ${rule.id} | ${rule.field} ${rule.operator} ${JSON.stringify(rule.value)} | priority ${rule.priority}</div>
            </div>
        `;

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "danger";
        deleteBtn.style.width = "90px";
        deleteBtn.textContent = "Delete";
        deleteBtn.onclick = async () => {
            try {
                await callApi(`/api/rules/${rule.id}`, "DELETE");
                await loadRules();
            } catch (error) {
                document.getElementById("rulesOutput").textContent = error.message;
            }
        };

        li.appendChild(deleteBtn);
        rulesList.appendChild(li);
    });
}

async function loadRules() {
    const output = document.getElementById("rulesOutput");
    try {
        const data = await callApi("/api/rules");
        renderRules(data.rules);
        output.textContent = `Loaded ${data.rules.length} rule(s). Display order is by priority (lowest first).`;
    } catch (error) {
        output.textContent = error.message;
    }
}

async function addRule() {
    const output = document.getElementById("rulesOutput");

    try {
        const name = document.getElementById("ruleName").value.trim();
        const field = document.getElementById("ruleField").value.trim();
        const operator = document.getElementById("ruleOperator").value;
        const valueRaw = document.getElementById("ruleValue").value;
        const priorityRaw = document.getElementById("rulePriority").value;

        if (!name || !field) {
            throw new Error("Name and Field are required.");
        }

        const payload = {
            name,
            field,
            operator,
            value: parseMaybeJson(valueRaw),
            priority: Number(priorityRaw || 100),
        };

        if (Number.isNaN(payload.priority)) {
            throw new Error("Priority must be a valid number.");
        }

        const data = await callApi("/api/rules", "POST", payload);
        output.textContent = `Rule added: ${data.rule.name}`;
        await loadRules();
    } catch (error) {
        output.textContent = error.message;
    }
}

async function evaluateRules() {
    const output = document.getElementById("evaluateOutput");
    const matchedRulesList = document.getElementById("matchedRulesList");
    const toggleDetailsBtn = document.getElementById("toggleDetailsBtn");
    const factsText = document.getElementById("factsInput").value;

    try {
        const facts = JSON.parse(factsText);
        const data = await callApi("/api/evaluate", "POST", { facts });

        matchedRulesList.innerHTML = "";
        const matchedRules = data.results.filter((item) => item.matched);

        if (matchedRules.length === 0) {
            const li = document.createElement("li");
            li.innerHTML = "<div><strong>No matched rules</strong><div class='meta'>Try a different facts button or update rule conditions.</div></div>";
            matchedRulesList.appendChild(li);
        } else {
            matchedRules.forEach((item) => {
                const li = document.createElement("li");
                li.innerHTML = `<div><strong>${item.name}</strong><div class="meta">Priority ${item.priority} | ${item.detail}</div></div>`;
                matchedRulesList.appendChild(li);
            });
        }

        latestEvaluationDetails = {
            facts_used: facts,
            summary: {
                total_rules: data.total_rules,
                matched_rules: data.matched_rules,
            },
            evaluation_results: data.results,
        };

        output.textContent = formatJson(latestEvaluationDetails);
        output.classList.add("hidden");

        if (toggleDetailsBtn) {
            toggleDetailsBtn.disabled = false;
            toggleDetailsBtn.textContent = "View Details JSON";
        }
    } catch (error) {
        matchedRulesList.innerHTML = "";
        latestEvaluationDetails = null;
        if (toggleDetailsBtn) {
            toggleDetailsBtn.disabled = true;
            toggleDetailsBtn.textContent = "View Details JSON (Run Evaluate First)";
        }
        output.classList.remove("hidden");
        output.textContent = error.message;
    }
}

function toggleEvaluationDetails() {
    const output = document.getElementById("evaluateOutput");
    const toggleDetailsBtn = document.getElementById("toggleDetailsBtn");

    if (!latestEvaluationDetails || !output || !toggleDetailsBtn) {
        return;
    }

    const isHidden = output.classList.contains("hidden");

    if (isHidden) {
        output.textContent = formatJson(latestEvaluationDetails);
        output.classList.remove("hidden");
        toggleDetailsBtn.textContent = "Hide Details JSON";
    } else {
        output.classList.add("hidden");
        toggleDetailsBtn.textContent = "View Details JSON";
    }
}

async function loadFsm() {
    const output = document.getElementById("fsmOutput");
    const summary = document.getElementById("fsmSummary");

    try {
        const data = await callApi("/api/fsm");
        latestFsmData = data;
        const states = data.states || [];
        const transitions = data.transitions || [];
        const history = data.history || [];

        if (!states.length) {
            fsmStateColors = {};
        }

        ensureFsmStateColors(states);
        populateEventFromStateSelector(states, data.current_state);
        renderFsmLegend(states, data.current_state);
        renderFsmTransitions(transitions);
        renderFsmHistory(history);
        renderFsmVisual(states, transitions, data.current_state);
        renderAvailableEvents(data.current_state, transitions);

        if (summary) {
            summary.textContent = `Current state: ${formatState(data.current_state)} | States: ${states.length} | Transitions: ${transitions.length}`;
        }
    } catch (error) {
        latestFsmData = null;
        if (summary) summary.textContent = "";
        output.textContent = error.message;
    }
}

async function triggerEvent() {
    const output = document.getElementById("fsmOutput");

    try {
        const event = document.getElementById("eventInput").value.trim();
        if (!event) {
            throw new Error("Event is required.");
        }
        const sourceState = document.getElementById("eventFromState").value.trim();
        const payload = { event };
        if (sourceState) {
            payload.from_state = sourceState;
        }
        const data = await callApi("/api/fsm/event", "POST", payload);
        output.textContent = `Event applied: ${data.from_state} --${data.event}--> ${data.to_state}. Current state: ${formatState(data.current_state)}`;
        await loadFsm();
    } catch (error) {
        output.textContent = error.message;
    }
}

async function addTransition() {
    const output = document.getElementById("fsmOutput");

    try {
        const fromState = document.getElementById("fromState").value.trim();
        const event = document.getElementById("transitionEvent").value.trim();
        const toState = document.getElementById("toState").value.trim();

        if (!fromState || !event || !toState) {
            throw new Error("From State, Event, and To State are all required.");
        }

        const payload = {
            from_state: fromState,
            event,
            to_state: toState,
        };
        const data = await callApi("/api/fsm/transitions", "POST", payload);
        output.textContent = `Transition added: ${data.transition.from_state} --${data.transition.event}--> ${data.transition.to_state}`;
        await loadFsm();
    } catch (error) {
        output.textContent = error.message;
    }
}

async function deleteTransition(fromState, eventName) {
    const output = document.getElementById("fsmOutput");

    try {
        const data = await callApi("/api/fsm/transitions", "DELETE", {
            from_state: fromState,
            event: eventName,
        });
        output.textContent = `Transition deleted: ${data.transition.from_state} --${data.transition.event}--> ${data.transition.to_state}`;
        await loadFsm();
    } catch (error) {
        output.textContent = error.message;
    }
}

async function clearAllTransitions() {
    const output = document.getElementById("fsmOutput");

    try {
        const data = await callApi("/api/fsm/transitions/all", "DELETE");
        fsmStateColors = {};
        output.textContent = `All transitions deleted (${data.removed_transitions}). Current state: ${formatState(data.current_state)}`;
        await loadFsm();
    } catch (error) {
        output.textContent = error.message;
    }
}

async function clearFsmHistory() {
    const output = document.getElementById("fsmOutput");

    try {
        const data = await callApi("/api/fsm/history", "DELETE");
        output.textContent = `Recent history cleared (${data.removed_history}).`;
        await loadFsm();
    } catch (error) {
        output.textContent = error.message;
    }
}

async function resetFsm() {
    const output = document.getElementById("fsmOutput");

    try {
        const data = await callApi("/api/fsm/reset", "POST");
        fsmStateColors = {};
        output.textContent = `FSM reset. Current state: ${formatState(data.current_state)}`;
        await loadFsm();
    } catch (error) {
        output.textContent = error.message;
    }
}

function loadSampleFacts() {
    document.getElementById("factsInput").value = JSON.stringify(
        {
            amount: 1200,
            status: "urgent",
            tags: ["vip", "priority"],
        },
        null,
        2
    );
}

document.getElementById("addRuleBtn").addEventListener("click", addRule);
document.getElementById("refreshRulesBtn").addEventListener("click", loadRules);
document.getElementById("evaluateBtn").addEventListener("click", evaluateRules);
document.getElementById("sampleFactsBtn").addEventListener("click", loadSampleFacts);
document.getElementById("toggleDetailsBtn").addEventListener("click", toggleEvaluationDetails);
document.getElementById("triggerEventBtn").addEventListener("click", triggerEvent);
document.getElementById("addTransitionBtn").addEventListener("click", addTransition);
document.getElementById("clearTransitionsBtn").addEventListener("click", clearAllTransitions);
document.getElementById("clearHistoryBtn").addEventListener("click", clearFsmHistory);
document.getElementById("refreshFsmBtn").addEventListener("click", loadFsm);
document.getElementById("resetFsmBtn").addEventListener("click", resetFsm);
document.getElementById("eventFromState").addEventListener("change", () => {
    if (!latestFsmData) return;
    renderAvailableEvents(latestFsmData.current_state, latestFsmData.transitions || []);
});

loadRules();
loadFsm();
