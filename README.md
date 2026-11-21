# AI Math Tutor (CECS 451 Term Project, Team 19)

## Tools
Node.js, Express, Supabase (Postgres), Google Gemini API (`@google/genai`).

## Setup
1. Install Node.js 20 or newer. From the repository root, run `npm install`.
2. Copy `.env.example` to `.env` and fill in the required values located in the report.
3. Start the app with `npm start`, then open http://localhost:3000.
4. Run `npm test` to run the unit tests.

## How to use it
1. Open http://localhost:3000/teacher.html, enter your teacher passcode from .env, create an assignment
   (problems + answer keys), and copy the join code.
2. Open http://localhost:3000/student.html, enter the code and a name, work the problems, and use
   "Get a hint" to talk to the tutor (new tutor for each problem upon pressing "Get a hint").
3. Back on the teacher page, click "View results" to see scores, hints asked, and tutor chats.

## Produce a sample teacher assignment
1. With the app configured and running, open a second terminal in the repository and run `node scripts/seed-sample.js`.
2. Copy the join code printed in the terminal.
3. Open http://localhost:3000/student.html, enter the code and a name, then answer the sample problems and submit.
4. Open http://localhost:3000/teacher.html, enter the teacher passcode, and view the results.