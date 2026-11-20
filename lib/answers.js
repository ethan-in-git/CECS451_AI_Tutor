
function parseNumericAnswer(value) {
    let text = String(value).trim().toLowerCase();

    // Remove a variable label, such as "x = "
    text = text.replace(/^[a-z]\s*=\s*/, "");

    // Handle mixed numbers, such as 1 1/2
    const mixed = text.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/);

    if (mixed) {
        const whole = Number(mixed[1]);
        const numerator = Number(mixed[2]);
        const denominator = Number(mixed[3]);

        if (denominator === 0) return null;

        const sign = whole < 0 ? -1 : 1;
        return whole + sign * numerator / denominator;
    }

    // Handle fractions, such as 3/4
    const fraction = text.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);

    if (fraction) {
        const numerator = Number(fraction[1]);
        const denominator = Number(fraction[2]);

        if (denominator === 0) return null;

        return numerator / denominator;
    }

    // Handle decimals and whole numbers
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
        const number = Number(text);
        return Number.isFinite(number) ? number : null;
    }

    return null;
}

// Make text comparisons consistent
function normalizeText(value) {
    return String(value)
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/−/g, "-");
}

// Check whether the student's answer is correct
function isCorrect(studentAnswer, answerKey) {
    if (
        typeof studentAnswer !== "string" ||
        typeof answerKey !== "string"
    ) {
        return false;
    }

    if (!studentAnswer.trim() || !answerKey.trim()) {
        return false;
    }

    // Allow multiple acceptable answers separated by |
    const acceptedAnswers = answerKey.split("|");

    const studentNumber = parseNumericAnswer(studentAnswer);

    return acceptedAnswers.some(accepted => {
        const key = accepted.trim();

        if (!key) return false;

        const keyNumber = parseNumericAnswer(key);

        // Compare numerical answers
        if (studentNumber !== null && keyNumber !== null) {
            return Math.abs(studentNumber - keyNumber) < 1e-9;
        }

        // Otherwise compare normalized text
        return normalizeText(studentAnswer) === normalizeText(key);
    });
}

// Split multiple acceptable answers separated by |
function splitAccepted(answerKey) {
    if (typeof answerKey !== "string") return [];

    return answerKey
        .split("|")
        .map(answer => answer.trim())
        .filter(Boolean);
}

module.exports = { isCorrect, splitAccepted, parseNumericAnswer, normalizeText };
