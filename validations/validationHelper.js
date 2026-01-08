// validations/validationHelper.js
function validateAdobeDataLayer(hit, rules = []) {
  if (!rules || rules.length === 0) {
    return [
      {
        name: "No validation rules",
        status: "PASS",
        details: "No validation rules defined for this step.",
      },
    ];
  }

  const results = [];

  for (const rule of rules) {
    const actual = hit[rule.field];
    const expected = rule.expectedValue;

    if (actual === expected) {
      results.push({
        name: rule.name,
        field: rule.field,
        expected: expected,
        actual: actual,
        status: "PASS",
      });
    } else {
      results.push({
        name: rule.name,
        field: rule.field,
        expected: expected,
        actual: actual,
        status: "FAIL",
      });
    }
  }

  return results;
}

module.exports = { validateAdobeDataLayer };
