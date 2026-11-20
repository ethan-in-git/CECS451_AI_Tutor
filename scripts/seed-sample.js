"use strict";

/*
 * Creates a sample assignment in your Supabase database and prints its join code,
 * so anyone can reproduce a sample result in one command:
 *
 *   node scripts/seed-sample.js
 *
 * Then open http://localhost:3000/student.html (with `npm start` running) and enter the code.
 * Run it again for a fresh assignment. Delete extras on the teacher page.
 */
require("dotenv").config();
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const missing = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"].filter(name => !process.env[name]);
if (missing.length) {
    console.error(`Missing ${missing.join(", ")} in your .env file (see .env.example).`);
    process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const SAMPLE = {
    title: "Sample: Pre-Algebra Warm-Up",
    instructions: "Work each problem. Use Get a hint if you get stuck. The tutor will not give you the answer.",
    timeLimitMinutes: 10,
    problems: [
        { question: "What is 1/2 + 1/4?", answerKey: "3/4 | 0.75" },
        { question: "Solve for x: 2x + 3 = 15", answerKey: "6" },
        { question: "What is 25% of 80?", answerKey: "20" },
        {
            question: "A recipe uses 3 cups of flour for 12 cookies. How many cups are needed for 20 cookies?",
            answerKey: "5"
        },
        { question: "Find the area of a triangle with base 10 and height 7.", answerKey: "35" }
    ]
};

// Same join-code style as server.js (no look-alike characters)
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(length = 6) {
    let code = "";
    for (let i = 0; i < length; i++) {
        code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    return code;
}

async function main() {
    let assignment = null;
    let lastError = null;

    // Retry if the generated code already exists
    for (let attempt = 0; attempt < 5 && !assignment; attempt++) {
        const { data, error } = await supabase
            .from("assignments")
            .insert({
                code: generateCode(),
                title: SAMPLE.title,
                instructions: SAMPLE.instructions,
                time_limit_minutes: SAMPLE.timeLimitMinutes
            })
            .select("id, code")
            .single();

        if (!error) {
            assignment = data;
        } else {
            lastError = error;
            if (error.code !== "23505") throw error;
        }
    }

    if (!assignment) throw lastError || new Error("Could not generate a unique join code.");

    const { error: problemsError } = await supabase.from("problems").insert(
        SAMPLE.problems.map((p, index) => ({
            assignment_id: assignment.id,
            position: index + 1,
            question: p.question,
            answer_key: p.answerKey
        }))
    );

    if (problemsError) {
        // Don't leave an assignment behind without its problems
        await supabase.from("assignments").delete().eq("id", assignment.id);
        throw problemsError;
    }

    console.log("Sample assignment created.");
    console.log(`  Title:     ${SAMPLE.title}`);
    console.log(`  Problems:  ${SAMPLE.problems.length}`);
    console.log(`  Join code: ${assignment.code}`);
    console.log("\nNext: run `npm start`, open http://localhost:3000/student.html, and enter the code.");
    console.log("View results afterward at http://localhost:3000/teacher.html with your teacher passcode.");
}

main().catch(error => {
    console.error("Seeding failed:", error.message);
    console.error("Did you run schema.sql in the Supabase SQL Editor? (npm run check will tell you)");
    process.exit(1);
});
