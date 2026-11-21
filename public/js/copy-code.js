"use strict";

const copyButton = document.getElementById("copy-code-button");
const codeElement = document.getElementById("published-code");
const statusElement = document.getElementById("copy-code-status");

copyButton.addEventListener("click", async () => {
    const code = codeElement.textContent.trim();
    if (!code) return;

    try {
        await navigator.clipboard.writeText(code);
        statusElement.textContent = "Join code copied. You can paste it into a message for students.";
        statusElement.className = "status-message ok";
    } catch (error) {
        statusElement.textContent = "Could not copy automatically. Select the code above and copy it.";
        statusElement.className = "status-message error";
    }
});
