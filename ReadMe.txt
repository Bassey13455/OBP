## Overview

This automates a web journey and captures analytics hits for:

* Adobe Analytics
* Google Analytics 4 (GA4)
* Adobe Customer Journey Analytics (CJA / AEP Web SDK)

For each step, it:

* Captures network hits
* Validates them against predefined rules
* Exports results into **separate Excel workbooks per platform**
* Highlights validation failures **directly in red within each workbook**
* Produces partial exports if a step fails

---

## Setup Instructions

### 1. Install dependencies

Required:

* Node.js 18+
* Playwright
* ExcelJS

Once cloned or copied locally:
Command Prompt: npm install

This installs Playwright, ExcelJS, and supporting dependencies.

If this is the first time running Playwright on your machine (or if browsers are missing):
Command Prompt: npx playwright install

---

### 2. Run the test

To start the journey type 
node index.js
Into your Command window and press ENTER

What happens when you run this:
1. A Chromium browser opens in non-headless mode
2. Analytics listeners are attached (Adobe, GA4, CJA)
3. The scripted journey begins, step by step

If bot protection is triggered:
You will be prompted in the terminal to complete the verification manually
Once verified, wait until page reload and then press ENTER in Command Window to continue


If a step throws an error:
Partial Excel files are exported immediately 
You are prompted whether to continue or stop the journey (This is better than ObservePoint lol)
Press Y to continue and N to stop, confirm entry with ENTER

Notes:

* The browser runs non-headless on purpose
* You may need to manually complete bot / “Press & Hold” verification
* You’ll be prompted in the terminal when manual interaction is required

---

### 3. How to configure
The entire user journey is defined in one place inside index.js as an ordered array:

```
const steps = [
  {
    name: "Reload Home Page",
    action: async () => {
      await reloadPage(page);
    },
  },
  {
    name: "Add to Cart",
    action: async () => {
      await click(page, "#add-to-cart");
    },
  },
];

```
Each step consists of:
* name - Readable name used in Excel and Validation Mapping, it's important not to use the characters (\, /, ?, *, [, ]) in step names as this is included in the Excel tabs
* action - Async function defining what happens in the browser

To add a new step:
* Choose the appropriate action(s)
* Give the step a clear, unique name
* Add corresponding validation rules (if required)

Example:
{
  name: "Apply Promo Code",
  action: async () => {
    await inputText(page, "#promoCode", "TEST10");
    await click(page, "#applyPromo");
  },
}

The step name must match the key used in your validation rules.

---

### 4. Actions (How Steps Work)
All journey steps are built using a small, consistent set of reusable actions located in /actions.

You can mix and match these freely.

* visitPage
Navigates directly to a URL.
``` await visitPage(page, "https://example.com"); ```

* reloadPage
Reloads the current page
``` await reloadPage(page); ```

* click
Clicks an element using a selector
``` await click(page, ".exampleSelector"); ```

* inputText
Types text into an input field using a selector
``` await inputText(page, "#exampleSelector", "example input"); ```

* selectDropdown
Selects a value in a dropdown list using a selector for the dropdown and the desired value
``` await selectDropdown(page, "#exampleDropdown", "exampleValue"); ```
An attempt was made to ensure that JS events are used on the drop down

* runJavascript
Executes JavaScript within the Browser
``` await runJavascript(page, () => {
  document.querySelector("#example").click();
}); ```

* handleCookieBanner
Handles cookie consent banners if present.
``` await handleCookieBanner(page); ```
Created this one really early, configured for onetrust banners

---

### 5. Output files

At the end of a run (or on failure), you’ll see:

* index_adobe_hits_per_step.xlsx
* index_ga4_hits_per_step.xlsx
* index_cja_hits_per_step.xlsx

Each file:

* Has one sheet per journey step
* Highlights failed parameters in red (This needs fixing)
* Preserves all captured hit data for debugging

---

## 6. Validation Rules

Validation rules live in:

/validations/ValidationRules.js


Rules are platform-specific. They support:

* Exact matches
* Regex validation
* Multi-hit expectations

Validation rules are mapped by step name and platform

Example:
"Add to Cart": {
  expectedHits: [
    {
      events: /scAdd/,
    },
  ],
}

If the step name changes, validation rules must be updated accordingly.

---

## 7. Important Notes

* Network listeners are carefully managed to avoid duplicate captures
* CJA events are flattened so nested XDM fields are accessible for validation

---

## 8. About

This framework was designed and implemented by:

Bassey Udohaya
Analytics Consultant

---

