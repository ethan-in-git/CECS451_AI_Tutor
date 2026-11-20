
const test = require("node:test");
const assert = require("node:assert/strict");

const { isCorrect } = require("../lib/answers");

test("Equivalent fractions and decimals", () => {
    assert.equal(isCorrect("0.5", "1/2"), true);
    assert.equal(isCorrect("2/4", "1/2"), true);
    assert.equal(isCorrect("1/2", "0.5"), true);
});

test("Mixed numbers", () => {
    assert.equal(isCorrect("1 1/2", "3/2"), true);
    assert.equal(isCorrect("3/2", "1 1/2"), true);
});

test("Variable equations", () => {
    assert.equal(isCorrect("x = 5", "5"), true);
    assert.equal(isCorrect("5", "x = 5"), true);
});

test("Multiple accepted answers", () => {
    assert.equal(isCorrect("0.75", "3/4 | 0.75"), true);
    assert.equal(isCorrect("3/4", "3/4 | 0.75"), true);
    assert.equal(isCorrect("0.5", "3/4 | 0.75"), false);
});

test("Text answers ignore spaces and capitalization", () => {
    assert.equal(isCorrect("2x+3", "2x + 3"), true);
    assert.equal(isCorrect("ABC", "abc"), true);
});

test("Incorrect answers", () => {
    assert.equal(isCorrect("10", "12"), false);
    assert.equal(isCorrect("1/3", "1/2"), false);
});

test("Empty answers", () => {
    assert.equal(isCorrect("", "5"), false);
    assert.equal(isCorrect("5", ""), false);
});

test("Invalid input", () => {
    assert.equal(isCorrect(null, "5"), false);
    assert.equal(isCorrect("5", null), false);
});

test("Division by zero is not numeric", () => {
    assert.equal(isCorrect("1/0", "5"), false);
});
