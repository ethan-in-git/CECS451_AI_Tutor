"use strict";

const themeButton = document.getElementById("theme-toggle");
const themeRoot = document.documentElement;
const themeStorageKey = "mathTutorTheme";

let savedTheme = "light";
try {
    savedTheme = localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
} catch (error) {
    // Theme switching still works for this page when storage is unavailable.
}

function setTheme(theme, save = false) {
    const isDark = theme === "dark";

    if (isDark) {
        themeRoot.dataset.theme = "dark";
    } else {
        delete themeRoot.dataset.theme;
    }

    themeButton.textContent = isDark ? "Light mode" : "Dark mode";
    themeButton.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    themeButton.setAttribute("aria-pressed", String(isDark));
    themeButton.title = isDark ? "Switch to the light appearance" : "Switch to the dark appearance";

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = isDark ? "#121622" : "#f4f5fc";

    if (save) {
        try {
            localStorage.setItem(themeStorageKey, theme);
        } catch (error) {
            // The selected theme remains active until this page is refreshed.
        }
    }
}

setTheme(savedTheme);

themeButton.addEventListener("click", () => {
    const nextTheme = themeRoot.dataset.theme === "dark" ? "light" : "dark";
    setTheme(nextTheme, true);
});
