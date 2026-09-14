
# Rewind Diagnostic Parsers

Rewind supports an extensible, pluggable diagnostic parsing system to extract structured insights from raw terminal stderr and stdout.

## The Parser Contract

A parser is a pure JavaScript function that takes a raw string (the error output) and returns a `StructuredDiagnostic` object (or `null` if it cannot confidently parse the output).

### 1. Creating a Parser

Create a new file in `src/diagnostics/parsers/`. Below is a template:

```javascript
import { ConfidenceLevel, createStructuredDiagnostic } from "../model.js";

export function parseMyToolDiagnostic(text) {
  if (!text || typeof text !== "string") return null;

  // 1. Detect if this is your tool (strict regex matching is highly recommended)
  const isMyTool = text.includes("MyToolError:");
  if (!isMyTool) return null;

  // 2. Extract structured fields
  const message = text.split(":")[1].trim();

  // 3. Return a unified StructuredDiagnostic
  return createStructuredDiagnostic({
    language: "mytool",      // The tool or language ecosystem
    runtime: "mytool-cli",   // Specific engine or runtime
    errorType: "MyToolError",
    message: message,
    confidence: ConfidenceLevel.EXACTLY_PARSED,
    rawEvidenceSnippet: text
  });
}
```

### 2. Registering the Parser

To enable your parser, import and register it in `src/diagnostics/index.js` inside the `PARSER_REGISTRY`:

```javascript
import { parseMyToolDiagnostic } from "./parsers/mytool.js";

const PARSER_REGISTRY = [
  // Add specific CLI tools first (aws, kubectl, terraform, etc.)
  { name: "mytool", parse: parseMyToolDiagnostic },
  // ...
  // Generic language parsers act as fallbacks (node, python, java, etc.)
  { name: "node", parse: parseNodeDiagnostic }
];
```

### 3. Writing Tests

Add your test fixtures to `test/diagnostics.test.js`. Ensure you include cases where the text does NOT match to prevent false positives overriding other parsers.
