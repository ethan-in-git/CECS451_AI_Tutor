"use strict";

const $ = id => document.getElementById(id);
const MAX_PROBLEMS = 10;

// Build an element with safe text (never innerHTML)
function make(tag, text = "", className = "") {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

// The passcode lives only in this browser tab's session storage
let passcode = "";
try {
    passcode = sessionStorage.getItem("teacherPasscode") || "";
} catch (error) {
    passcode = "";
}

// Call a teacher API route with the passcode header
async function api(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "x-teacher-passcode": passcode
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(data.error || "Request failed.");
        error.status = response.status;
        throw error;
    }

    return data;
}

// ---- Sign in ---------------------------------------------------------------
async function unlock() {
    const { assignments } = await api("/api/assignments"); // throws 401 if wrong
    $("unlock-section").hidden = true;
    $("teacher-main").hidden = false;
    renderAssignments(assignments);
}

$("unlock-form").addEventListener("submit", async event => {
    event.preventDefault();
    passcode = $("passcode").value;

    try {
        await unlock();
        try {
            sessionStorage.setItem("teacherPasscode", passcode);
        } catch (error) {
            /* storage unavailable: they will just sign in again on refresh */
        }
    } catch (error) {
        passcode = "";
        $("unlock-status").textContent = error.message;
    }
});

// ---- Create assignment -----------------------------------------------------
function renumberProblems() {
    const rows = [...document.querySelectorAll("#problem-rows .problem")];
    rows.forEach((row, index) => {
        row.querySelector("h4").textContent = `Problem ${index + 1}`;
        row.querySelector(".remove").hidden = rows.length === 1;
    });
    $("add-problem").disabled = rows.length >= MAX_PROBLEMS;
}

function addProblemRow() {
    const row = make("div", "", "problem");

    const question = make("textarea", "", "question");
    question.maxLength = 2000;
    question.placeholder = "e.g. What is 1/2 + 1/4?";

    const key = make("input", "", "key");
    key.maxLength = 200;
    key.placeholder = "e.g. 3/4";

    const remove = make("button", "Remove", "secondary remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
        row.remove();
        renumberProblems();
    });

    row.append(
        make("h4"),
        make("label", "Question"),
        question,
        make("label", "Answer key"),
        key,
        remove
    );

    $("problem-rows").appendChild(row);
    renumberProblems();
}

$("add-problem").addEventListener("click", addProblemRow);

$("assignment-form").addEventListener("submit", async event => {
    event.preventDefault();

    const problems = [...document.querySelectorAll("#problem-rows .problem")].map(row => ({
        question: row.querySelector(".question").value.trim(),
        answerKey: row.querySelector(".key").value.trim()
    }));

    if (problems.some(p => !p.question || !p.answerKey)) {
        $("publish-status").textContent = "Every problem needs a question and an answer key.";
        $("publish-status").className = "error";
        return;
    }

    $("publish-button").disabled = true;
    $("publish-status").textContent = "Publishing...";
    $("publish-status").className = "";

    try {
        const { assignment } = await api("/api/assignments", {
            method: "POST",
            body: JSON.stringify({
                title: $("title").value.trim(),
                instructions: $("instructions").value.trim(),
                timeLimitMinutes: parseInt($("time-limit").value, 10),
                problems
            })
        });

        $("publish-status").textContent = "Assignment published!";
        $("publish-status").className = "ok";
        $("published-code").textContent = assignment.code;
        $("published").hidden = false;

        $("assignment-form").reset();
        $("problem-rows").replaceChildren();
        addProblemRow();
        await refreshAssignments();
    } catch (error) {
        $("publish-status").textContent = error.message;
        $("publish-status").className = "error";
    } finally {
        $("publish-button").disabled = false;
    }
});

// ---- Assignment list -------------------------------------------------------
async function refreshAssignments() {
    const { assignments } = await api("/api/assignments");
    renderAssignments(assignments);
}

function renderAssignments(assignments) {
    const list = $("assignment-list");
    list.replaceChildren();

    if (!assignments.length) {
        list.appendChild(make("p", "No assignments yet.", "muted"));
        return;
    }

    for (const assignment of assignments) {
        const card = make("div", "", "problem");
        card.append(
            make("strong", assignment.title),
            make(
                "p",
                `Code: ${assignment.code} · ${assignment.time_limit_minutes} min · ${new Date(assignment.created_at).toLocaleString()}`,
                "muted"
            )
        );

        const resultsButton = make("button", "View results", "secondary");
        resultsButton.addEventListener("click", () => showResults(assignment));

        const deleteButton = make("button", "Delete", "danger");
        deleteButton.addEventListener("click", async () => {
            if (!confirm(`Delete "${assignment.title}" and all of its results?`)) return;
            try {
                await api(`/api/assignments/${assignment.id}`, { method: "DELETE" });
                $("results-panel").hidden = true;
                await refreshAssignments();
            } catch (error) {
                alert(error.message);
            }
        });

        card.append(resultsButton, deleteButton);
        list.appendChild(card);
    }
}

// ---- Results ---------------------------------------------------------------
async function showResults(assignment) {
    const panel = $("results-panel");
    panel.hidden = false;
    panel.replaceChildren(
        make("h2", `Results: ${assignment.title}`),
        make("p", "Loading...", "muted")
    );

    try {
        const [{ problems }, { submissions }, { messages }] = await Promise.all([
            api(`/api/assignments/${assignment.id}/problems`),
            api(`/api/assignments/${assignment.id}/submissions`),
            api(`/api/assignments/${assignment.id}/chat`)
        ]);

        const position = Object.fromEntries(problems.map(p => [p.id, p.position]));
        panel.replaceChildren(make("h2", `Results: ${assignment.title}`));

        // Scores table
        if (!submissions.length) {
            panel.appendChild(make("p", "No submissions yet.", "muted"));
        } else {
            const table = make("table");
            const head = make("tr");
            ["Student", "Score", "Hints asked", "Answers", "Submitted"].forEach(text =>
                head.appendChild(make("th", text))
            );
            table.appendChild(head);

            for (const s of submissions) {
                const answers = make("td");
                [...s.submission_answers]
                    .sort((a, b) => position[a.problem_id] - position[b.problem_id])
                    .forEach(a =>
                        answers.appendChild(
                            make(
                                "div",
                                `${position[a.problem_id]}: ${a.answer || "(blank)"} ${a.is_correct ? "✓" : "✗"}`,
                                a.is_correct ? "ok" : "error"
                            )
                        )
                    );

                const row = make("tr");
                row.append(
                    make("td", s.student_name),
                    make("td", `${s.score} / ${s.total}`),
                    make("td", String(s.ai_question_count)),
                    answers,
                    make("td", new Date(s.submitted_at).toLocaleString())
                );
                table.appendChild(row);
            }
            panel.appendChild(table);
        }

        // Tutor chat log, grouped by student
        panel.appendChild(make("h3", "Tutor conversations"));
        if (!messages.length) {
            panel.appendChild(make("p", "No tutor messages yet.", "muted"));
        }

        const byStudent = {};
        messages.forEach(m => {
            const name = m.student_name || "Unknown student";
            (byStudent[name] = byStudent[name] || []).push(m);
        });

        for (const [name, items] of Object.entries(byStudent)) {
            const details = make("details");
            details.appendChild(make("summary", `${name} (${items.length} messages)`));
            items.forEach(m =>
                details.appendChild(
                    make(
                        "p",
                        `Problem ${position[m.problem_id] || "?"} · ${m.role === "student" ? "Student" : "Tutor"}: ${m.content}`
                    )
                )
            );
            panel.appendChild(details);
        }

        const refresh = make("button", "Refresh", "secondary");
        refresh.addEventListener("click", () => showResults(assignment));
        panel.appendChild(refresh);
    } catch (error) {
        panel.replaceChildren(
            make("h2", `Results: ${assignment.title}`),
            make("p", error.message, "error")
        );
    }
}

// ---- Start -----------------------------------------------------------------
addProblemRow();

// If the passcode was saved earlier in this tab, sign in automatically
if (passcode) {
    unlock().catch(() => {
        passcode = "";
    });
}
