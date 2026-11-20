/*
 * AI Math Tutor server (CECS 451, Team 19).
 */
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { GoogleGenAI } = require("@google/genai");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const { isCorrect } = require("./lib/answers");
const {
    buildSystemInstruction,
    revealsAnswer,
    LEAK_REMINDER,
    FALLBACK_REPLY
} = require("./lib/tutor");

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Configuration ---------------------------------------------------------
const missing = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "GEMINI_API_KEY",
    "TEACHER_PASSCODE"
].filter(name => !process.env[name]);

if (missing.length) {
    console.error(`Missing ${missing.join(", ")} in your .env file (see .env.example).`);
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Columns that are safe to send to a browser. answer_key is never included.
const ASSIGNMENT_COLUMNS =
    "id, code, title, instructions, time_limit_minutes, created_at";
const PROBLEM_COLUMNS_PUBLIC = "id, position, question";

// ---- Middleware ------------------------------------------------------------
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "homepage.html"));
});

// Teacher tools require the passcode in the x-teacher-passcode header.
function requireTeacher(req, res, next) {
    const sha = value =>
        crypto.createHash("sha256").update(String(value || "")).digest();

    const ok = crypto.timingSafeEqual(
        sha(req.get("x-teacher-passcode")),
        sha(process.env.TEACHER_PASSCODE)
    );

    if (!ok) {
        return res.status(401).json({ error: "Incorrect teacher passcode." });
    }
    next();
}

// ---- Helpers ---------------------------------------------------------------
// Join codes avoid look-alike characters (0/O, 1/I), e.g. "K7M2QX"
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateAssignmentCode(length = 6) {
    let code = "";
    for (let i = 0; i < length; i++) {
        code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    return code;
}

function isNonEmptyString(value, maxLength) {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.trim().length <= maxLength
    );
}

// ---- Teacher routes --------------------------------------------------------
// GET: Load all assignments (no answer keys)
app.get("/api/assignments", requireTeacher, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("assignments")
            .select(ASSIGNMENT_COLUMNS)
            .order("created_at", { ascending: false });

        if (error) throw error;
        res.json({ assignments: data });
    } catch (error) {
        console.error("Error loading assignments:", error.message);
        res.status(500).json({ error: "Unable to load assignments." });
    }
});

// POST: Create an assignment with 1-10 problems and their answer keys
app.post("/api/assignments", requireTeacher, async (req, res) => {
    const { title, instructions = "", timeLimitMinutes = 10, problems } = req.body;

    const problemsValid =
        Array.isArray(problems) &&
        problems.length >= 1 &&
        problems.length <= 10 &&
        problems.every(
            p =>
                p &&
                isNonEmptyString(p.question, 2000) &&
                isNonEmptyString(p.answerKey, 200)
        );

    if (
        !isNonEmptyString(title, 200) ||
        typeof instructions !== "string" ||
        instructions.length > 2000 ||
        !Number.isInteger(timeLimitMinutes) ||
        timeLimitMinutes < 1 ||
        timeLimitMinutes > 120 ||
        !problemsValid
    ) {
        return res.status(400).json({
            error:
                "Provide a title and 1-10 problems, each with a question and an answer key."
        });
    }

    let assignment = null;

    try {
        let insertError = null;

        // Retry if the generated join code already exists
        for (let attempt = 0; attempt < 5; attempt++) {
            const { data, error } = await supabase
                .from("assignments")
                .insert({
                    code: generateAssignmentCode(),
                    title: title.trim(),
                    instructions: instructions.trim(),
                    time_limit_minutes: timeLimitMinutes
                })
                .select(ASSIGNMENT_COLUMNS)
                .single();

            if (!error) {
                assignment = data;
                break;
            }

            insertError = error;
            if (error.code !== "23505") throw error;
        }

        if (!assignment) {
            throw insertError || new Error("Could not generate a unique code.");
        }

        const { error: problemsError } = await supabase.from("problems").insert(
            problems.map((p, index) => ({
                assignment_id: assignment.id,
                position: index + 1,
                question: p.question.trim(),
                answer_key: p.answerKey.trim()
            }))
        );

        if (problemsError) throw problemsError;

        res.status(201).json({
            message: "Assignment published successfully!",
            assignment
        });
    } catch (error) {
        console.error("Error publishing assignment:", error.message);

        // Don't leave an assignment behind without its problems
        if (assignment) {
            await supabase.from("assignments").delete().eq("id", assignment.id);
        }

        res.status(500).json({ error: "Unable to publish assignment." });
    }
});

// DELETE: Remove an assignment (problems, submissions, chat logs cascade)
app.delete("/api/assignments/:id", requireTeacher, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("assignments")
            .delete()
            .eq("id", req.params.id)
            .select("id")
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ error: "Assignment not found." });
        }

        res.json({ message: "Assignment deleted successfully." });
    } catch (error) {
        console.error("Error deleting assignment:", error.message);
        res.status(500).json({ error: "Unable to delete assignment." });
    }
});

// GET: Student results for an assignment (correctness only, never the answer key)
app.get("/api/assignments/:id/submissions", requireTeacher, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("submissions")
            .select(`
                id,
                student_name,
                submitted_at,
                paste_count,
                tab_leave_count,
                ai_question_count,
                submission_answers ( problem_id, answer, is_correct )
            `)
            .eq("assignment_id", req.params.id)
            .order("submitted_at", { ascending: false });

        if (error) throw error;

        const submissions = data.map(s => ({
            ...s,
            score: s.submission_answers.filter(a => a.is_correct).length,
            total: s.submission_answers.length
        }));

        res.json({ submissions });
    } catch (error) {
        console.error("Error loading submissions:", error.message);
        res.status(500).json({ error: "Unable to load student submissions." });
    }
});

// GET: Problems for an assignment (question text only, never answer keys)
app.get("/api/assignments/:id/problems", requireTeacher, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("problems")
            .select(PROBLEM_COLUMNS_PUBLIC)
            .eq("assignment_id", req.params.id)
            .order("position", { ascending: true });

        if (error) throw error;
        res.json({ problems: data });
    } catch (error) {
        console.error("Error loading problems:", error.message);
        res.status(500).json({ error: "Unable to load problems." });
    }
});

// GET: Tutor chat log for an assignment (for the teacher)
app.get("/api/assignments/:id/chat", requireTeacher, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("chat_messages")
            .select("student_name, problem_id, role, content, created_at")
            .eq("assignment_id", req.params.id)
            .order("created_at", { ascending: true });

        if (error) throw error;
        res.json({ messages: data });
    } catch (error) {
        console.error("Error loading chat log:", error.message);
        res.status(500).json({ error: "Unable to load chat log." });
    }
});

// ---- Student routes --------------------------------------------------------
// GET: Find an assignment by join code. Returns problems WITHOUT answer keys.
app.get("/api/assignments/:code", async (req, res) => {
    const code = req.params.code.trim().toUpperCase();

    try {
        const { data: assignment, error } = await supabase
            .from("assignments")
            .select(ASSIGNMENT_COLUMNS)
            .eq("code", code)
            .maybeSingle();

        if (error) throw error;

        if (!assignment) {
            return res.status(404).json({
                error: "Assignment not found. Please check the code."
            });
        }

        const { data: problems, error: problemsError } = await supabase
            .from("problems")
            .select(PROBLEM_COLUMNS_PUBLIC)
            .eq("assignment_id", assignment.id)
            .order("position", { ascending: true });

        if (problemsError) throw problemsError;

        res.json({ assignment: { ...assignment, problems } });
    } catch (error) {
        console.error("Error finding assignment:", error.message);
        res.status(500).json({ error: "Unable to find assignment." });
    }
});

// POST: Submit answers. The server grades them against the hidden key.
app.post("/api/submissions", async (req, res) => {
    const {
        assignmentId,
        studentName,
        answers,
        pasteCount = 0,
        tabLeaveCount = 0,
        aiQuestionCount = 0
    } = req.body;

    const counts = [pasteCount, tabLeaveCount, aiQuestionCount];

    if (
        typeof assignmentId !== "string" ||
        !isNonEmptyString(studentName, 100) ||
        !Array.isArray(answers) ||
        answers.length > 10 ||
        !counts.every(c => Number.isInteger(c) && c >= 0)
    ) {
        return res.status(400).json({
            error: "Please provide your name and your answers."
        });
    }

    try {
        const { data: problems, error: problemsError } = await supabase
            .from("problems")
            .select("id, position, answer_key")
            .eq("assignment_id", assignmentId)
            .order("position", { ascending: true });

        if (problemsError) throw problemsError;

        if (!problems.length) {
            return res.status(404).json({ error: "Assignment not found." });
        }

        const givenByProblem = new Map(
            answers
                .filter(a => a && typeof a.problemId === "string")
                .map(a => [a.problemId, String(a.answer ?? "").trim().slice(0, 200)])
        );

        const graded = problems.map(problem => {
            const answer = givenByProblem.get(problem.id) || "";
            return {
                problem_id: problem.id,
                answer,
                is_correct: isCorrect(answer, problem.answer_key)
            };
        });

        const { data: submission, error: submissionError } = await supabase
            .from("submissions")
            .insert({
                assignment_id: assignmentId,
                student_name: studentName.trim(),
                paste_count: pasteCount,
                tab_leave_count: tabLeaveCount,
                ai_question_count: aiQuestionCount
            })
            .select("id")
            .single();

        if (submissionError) throw submissionError;

        const { error: answersError } = await supabase
            .from("submission_answers")
            .insert(graded.map(g => ({ ...g, submission_id: submission.id })));

        if (answersError) throw answersError;

        const score = graded.filter(g => g.is_correct).length;

        res.status(201).json({
            message: "Answers submitted!",
            score,
            total: graded.length,
            results: graded.map(g => ({
                problemId: g.problem_id,
                correct: g.is_correct
            }))
        });
    } catch (error) {
        console.error("Error saving submission:", error.message);
        res.status(500).json({ error: "Unable to save your answers." });
    }
});

// ---- AI tutor --------------------------------------------------------------
const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 15, // 15 messages per minute per IP
    message: { error: "You're sending messages too quickly. Please wait a moment." }
});

// Call Gemini, retrying temporary service errors with exponential backoff
async function generateWithRetry({ contents, systemInstruction }) {
    let lastError;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents,
                config: { systemInstruction }
            });
        } catch (error) {
            lastError = error;

            const errorText = `${error.message || ""} ${JSON.stringify(error)}`;
            const isTemporary =
                /503|UNAVAILABLE|429|RESOURCE_EXHAUSTED|500|INTERNAL/i.test(errorText);

            if (!isTemporary || attempt === 2) throw error;

            const delayMs = 1000 * 2 ** attempt + Math.random() * 300;
            console.warn(
                `Gemini request failed (attempt ${attempt + 1}/3). Retrying in ${Math.round(delayMs)} ms.`
            );
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    throw lastError || new Error("Gemini did not return a response.");
}

// POST: Ask the tutor for a hint on one problem
app.post("/api/chat", chatLimiter, async (req, res) => {
    const {
        code,
        problemId,
        message,
        history = [],
        draft = "",
        studentName = ""
    } = req.body;

    if (
        typeof code !== "string" ||
        typeof problemId !== "string" ||
        !isNonEmptyString(message, 2000)
    ) {
        return res.status(400).json({
            error: "Assignment code, problem, and message are required."
        });
    }

    try {
        // Look everything up on the server so the client can't change the problem or see the key
        const { data: assignment, error } = await supabase
            .from("assignments")
            .select("id, title, instructions")
            .eq("code", code.trim().toUpperCase())
            .maybeSingle();

        if (error) throw error;
        if (!assignment) {
            return res.status(404).json({ error: "Assignment not found." });
        }

        const { data: problem, error: problemError } = await supabase
            .from("problems")
            .select("id, question, answer_key")
            .eq("id", problemId)
            .eq("assignment_id", assignment.id)
            .maybeSingle();

        if (problemError) throw problemError;
        if (!problem) {
            return res.status(404).json({ error: "Problem not found." });
        }

        const systemInstruction = buildSystemInstruction(assignment, problem);

        // Rebuild history from trusted fields only and cap its size
        const past = Array.isArray(history)
            ? history.slice(-20).map(m => ({
                role: m.role === "model" ? "model" : "user",
                parts: [{ text: String(m.text).slice(0, 4000) }]
            }))
            : [];

        const question = message.trim().slice(0, 2000);
        const work = String(draft).trim().slice(0, 1000);

        const userText = work
            ? `Student's current work/answer:\n"""\n${work}\n"""\n\nStudent's message: ${question}`
            : question;

        const contents = [...past, { role: "user", parts: [{ text: userText }] }];

        let response = await generateWithRetry({ contents, systemInstruction });
        let reply = response.text || "";

        // Guard: if the reply gives away the answer, regenerate once, then fall back
        if (revealsAnswer(reply, problem.answer_key)) {
            console.warn("Tutor reply revealed the answer; regenerating.");
            response = await generateWithRetry({
                contents,
                systemInstruction: systemInstruction + LEAK_REMINDER
            });
            reply = response.text || "";

            if (revealsAnswer(reply, problem.answer_key)) {
                reply = FALLBACK_REPLY;
            }
        }

        if (!reply.trim()) {
            reply = "I couldn't come up with a response to that. Try rephrasing your question.";
        }

        // Best-effort logging of the conversation (never blocks the reply)
        const name = String(studentName).trim().slice(0, 100) || null;
        supabase
            .from("chat_messages")
            .insert([
                {
                    assignment_id: assignment.id,
                    problem_id: problem.id,
                    student_name: name,
                    role: "student",
                    content: question
                },
                {
                    assignment_id: assignment.id,
                    problem_id: problem.id,
                    student_name: name,
                    role: "tutor",
                    content: reply
                }
            ])
            .then(({ error: logError }) => {
                if (logError) console.warn("Chat log failed:", logError.message);
            });

        res.json({ reply });
    } catch (error) {
        console.error("Error in chat:", error.message);
        res.status(500).json({ error: "The AI assistant is unavailable right now." });
    }
});

// ---- Start -----------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`Math tutor server running at http://localhost:${PORT}`);
});
