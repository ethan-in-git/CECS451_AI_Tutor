const test = require("node:test");
const assert = require("node:assert");
const { revealsAnswer, buildSystemInstruction } = require("../lib/tutor");

test("flags replies that state the answer", () => {
    assert.ok(revealsAnswer("So x = 7.", "7"));
    assert.ok(revealsAnswer("The answer is 7", "7"));
    assert.ok(revealsAnswer("You should get 3/4 in the end.", "3/4"));
    assert.ok(revealsAnswer("That gives 0.75!", "0.75"));
    assert.ok(revealsAnswer("It simplifies to 2x+3.", "2x+3"));
});

test("does not flag harmless uses of small numbers", () => {
    assert.ok(!revealsAnswer("Try dividing both sides by 7.", "7"));
    assert.ok(!revealsAnswer("What is 14 divided by 2?", "7"));
    assert.ok(!revealsAnswer("What do you get if you add 1/4 to 1/2?", "3/4"));
});

test("accepted alternates are all checked", () => {
    assert.ok(revealsAnswer("That's 0.33 roughly.", "1/3 | 0.33"));
});

test("system prompt contains the problem and key but forbids revealing it", () => {
    const prompt = buildSystemInstruction(
        { title: "Equations", instructions: "Show work" },
        { question: "2x + 1 = 15", answer_key: "7" }
    );
    assert.match(prompt, /2x \+ 1 = 15/);
    assert.match(prompt, /CONFIDENTIAL/);
    assert.match(prompt, /Never state the final answer/);
});
