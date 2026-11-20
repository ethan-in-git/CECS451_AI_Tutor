"use strict";

const $ = id => document.getElementById(id);

// Build an element with safe text (never innerHTML, so nothing typed by a user can inject markup)
function make(tag, text = "", className = "") {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

let assignment = null;
let studentName = "";
let activeProblem = null;
let hintCount = 0; // tutor messages sent; reported to the teacher
let submitted = false;
let timerId = null;
const chatHistory = {}; // problemId -> [{ role: "user" | "model", text }]

function showStatus(id, message, className = "") {
    const node = $(id);
    node.textContent = message;
    node.className = className;
}

function addChatMessage(role, text) {
    const box = $("chat-messages");
    const div = make("div", text, `msg ${role}`);
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
}

function setChatEnabled(enabled) {
    $("chat-input").disabled = !enabled;
    $("chat-send").disabled = !enabled;
}

// Show the chat for one problem (each problem keeps its own conversation)
function selectProblem(problem) {
    activeProblem = problem;

    document.querySelectorAll(".problem").forEach(card => {
        card.classList.toggle("active", card.dataset.id === problem.id);
    });

    $("chat-title").textContent = `Tutor: Problem ${problem.position}`;
    $("chat-messages").replaceChildren();

    const history = chatHistory[problem.id] || (chatHistory[problem.id] = []);
    if (!history.length) {
        addChatMessage(
            "model",
            "Hi! Tell me where you're stuck and I'll give you a hint. I won't give the answer, but I'll help you get there."
        );
    }
    history.forEach(m => addChatMessage(m.role, m.text));

    setChatEnabled(!submitted);
}

function renderProblems() {
    const container = $("problems");
    container.replaceChildren();

    for (const problem of assignment.problems) {
        const card = make("div", "", "problem");
        card.dataset.id = problem.id;

        const label = make("label", "Your answer");
        label.htmlFor = `answer-${problem.id}`;

        const input = make("input", "", "answer");
        input.id = `answer-${problem.id}`;
        input.maxLength = 200;
        input.autocomplete = "off";

        const hintButton = make("button", "Get a hint", "secondary");
        hintButton.type = "button";
        hintButton.addEventListener("click", () => {
            selectProblem(problem);
            $("chat-input").focus();
        });

        card.append(
            make("h3", `Problem ${problem.position}`),
            make("p", problem.question),
            label,
            input,
            hintButton
        );
        container.appendChild(card);
    }
}

function startTimer(minutes) {
    const endTime = Date.now() + minutes * 60 * 1000;

    const tick = () => {
        const remaining = Math.max(0, endTime - Date.now());
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor(remaining / 1000) % 60;
        $("timer").textContent = `${mins}:${String(secs).padStart(2, "0")}`;

        if (remaining === 0) {
            clearInterval(timerId);
            submitAnswers(true); // time is up: submit whatever is filled in
        }
    };

    tick();
    timerId = setInterval(tick, 1000);
}

function startAssignment() {
    $("join-section").hidden = true;
    $("workspace").hidden = false;

    $("assignment-title").textContent = assignment.title;
    $("assignment-instructions").textContent = assignment.instructions || "";
    $("assignment-instructions").hidden = !assignment.instructions;

    renderProblems();
    if (assignment.problems.length) selectProblem(assignment.problems[0]);
    startTimer(assignment.time_limit_minutes || 10);
}

function showResults(result) {
    const box = $("results");
    box.replaceChildren(
        make("h3", `Score: ${result.score} / ${result.total}`)
    );

    for (const item of result.results) {
        const problem = assignment.problems.find(p => p.id === item.problemId);
        box.appendChild(
            make(
                "p",
                `Problem ${problem ? problem.position : "?"}: ${item.correct ? "Correct" : "Not quite"}`,
                item.correct ? "ok" : "error"
            )
        );
    }

    box.hidden = false;
}

async function submitAnswers(auto = false) {
    if (submitted) return;

    const answers = [...document.querySelectorAll(".problem")].map(card => ({
        problemId: card.dataset.id,
        answer: card.querySelector(".answer").value.trim()
    }));

    if (
        !auto &&
        answers.some(a => !a.answer) &&
        !confirm("Some problems are blank. Submit anyway?")
    ) {
        return;
    }

    $("submit-button").disabled = true;
    showStatus("submit-status", auto ? "Time is up. Submitting..." : "Submitting...");

    try {
        const response = await fetch("/api/submissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                assignmentId: assignment.id,
                studentName,
                answers,
                aiQuestionCount: hintCount
            })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "Unable to submit your answers.");
        }

        submitted = true;
        clearInterval(timerId);
        document.querySelectorAll(".answer").forEach(i => (i.disabled = true));
        document.querySelectorAll(".problem button").forEach(b => (b.disabled = true));
        setChatEnabled(false);

        showStatus("submit-status", "Submitted!", "ok");
        showResults(result);
    } catch (error) {
        console.error("Submit error:", error);
        showStatus("submit-status", error.message, "error");
        $("submit-button").disabled = false;
    }
}

// Join with the teacher's code
$("join-form").addEventListener("submit", async event => {
    event.preventDefault();

    const code = $("join-code").value.trim().toUpperCase();
    studentName = $("student-name").value.trim();

    if (!code || !studentName) {
        showStatus("join-status", "Please enter the join code and your name.", "error");
        return;
    }

    $("join-button").disabled = true;
    showStatus("join-status", "Looking up assignment...");

    try {
        const response = await fetch(`/api/assignments/${encodeURIComponent(code)}`);
        const result = await response.json();

        if (!response.ok || !result.assignment) {
            throw new Error(result.error || "Unable to find that assignment.");
        }

        assignment = result.assignment;
        startAssignment();
    } catch (error) {
        console.error("Join error:", error);
        showStatus("join-status", error.message, "error");
    } finally {
        $("join-button").disabled = false;
    }
});

$("submit-button").addEventListener("click", () => submitAnswers(false));

// Ask the tutor for a hint on the selected problem
$("chat-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!activeProblem || submitted) return;

    const message = $("chat-input").value.trim();
    if (!message) return;

    const problem = activeProblem;
    const history = chatHistory[problem.id];
    const draft = document.querySelector(
        `.problem[data-id="${problem.id}"] .answer`
    ).value;

    $("chat-input").value = "";
    addChatMessage("user", message);
    hintCount++;

    const pending = addChatMessage("model", "Thinking...");
    setChatEnabled(false);

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                code: assignment.code,
                problemId: problem.id,
                message,
                history,
                draft,
                studentName
            })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || "Unable to reach the tutor.");
        }

        pending.textContent = result.reply;
        history.push(
            { role: "user", text: message },
            { role: "model", text: result.reply }
        );
    } catch (error) {
        console.error("Chat error:", error);
        pending.textContent = error.message;
    } finally {
        if (!submitted) {
            setChatEnabled(true);
            $("chat-input").focus();
        }
    }
});
