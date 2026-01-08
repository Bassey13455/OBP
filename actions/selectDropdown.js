// actions/selectDropdown.js

/**
 * Simulates selecting an option in a <select> dropdown,
 * fully compatible with React / Preact / SFCC (React-based) forms.
 *
 * @param {import('playwright').Page} page
 * @param {string} selector - CSS selector for the <select>
 * @param {string} value - The value to set
 */
async function selectDropdown(page, selector, value) {
  await page.evaluate(
    ({ selector, value }) => {
      try {
        const select = document.querySelector(selector);
        if (!select) {
          console.warn(`Dropdown not found: ${selector}`);
          return;
        }

        const oldValue = select.value;
        select.value = value;

        // Fix React’s internal state tracking
        const tracker = select._valueTracker;
        if (tracker) {
          tracker.setValue(oldValue);
        }

        // Fire all necessary events
        const fire = (type) =>
          select.dispatchEvent(
            new Event(type, { bubbles: true, cancelable: true })
          );

        fire("mousedown");
        fire("click");
        fire("input");
        fire("change");

        console.log(`Dropdown selected → ${selector} = ${value}`);
      } catch (err) {
        console.error("Dropdown selection failed:", err);
      }
    },
    { selector, value }
  );
}

module.exports = selectDropdown;
