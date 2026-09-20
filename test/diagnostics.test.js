import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDiagnostic,
  ConfidenceLevel
} from '../src/diagnostics/index.js';

describe('Structured Diagnostic Parsing Layer (src/diagnostics/)', () => {

  // Fixture 1: Valid Node.js / V8 stack trace
  test('parses standard Node.js / V8 error with stack trace (Fixture 1)', () => {
    const stderr = `TypeError: Cannot read properties of undefined (reading 'connect')
    at DatabaseService.connect (C:\\Users\\developer\\rewind\\src\\db.js:45:18)
    at async initApp (/home/user/app/server.ts:12:5)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`;

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'node');
    assert.equal(diag.runtime, 'v8');
    assert.equal(diag.errorType, 'TypeError');
    assert.equal(diag.message, "Cannot read properties of undefined (reading 'connect')");
    assert.equal(diag.sourceFile, 'C:\\Users\\developer\\rewind\\src\\db.js');
    assert.equal(diag.line, 45);
    assert.equal(diag.column, 18);
    assert.equal(diag.confidence, ConfidenceLevel.EXACTLY_PARSED);
    assert.equal(diag.confidenceByField.language, ConfidenceLevel.EXACTLY_PARSED);
    assert.equal(diag.confidenceByField.location, ConfidenceLevel.EXACTLY_PARSED);
    assert.equal(diag.stackFrames.length, 3);
    assert.equal(diag.stackFrames[0].function, 'DatabaseService.connect');
  });

  // Fixture 2: Node error without stack trace
  test('parses Node.js error without stack trace (Fixture 2)', () => {
    const stderr = 'Error [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received undefined';

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'node');
    assert.equal(diag.runtime, 'v8');
    assert.equal(diag.errorType, 'Error');
    assert.equal(diag.errorCode, 'ERR_INVALID_ARG_TYPE');
    assert.equal(diag.message, 'The "path" argument must be of type string. Received undefined');
    assert.equal(diag.sourceFile, null);
    assert.equal(diag.line, null);
    assert.equal(diag.confidence, ConfidenceLevel.EXACTLY_PARSED);
  });

  // Fixture 3: Python traceback
  test('parses standard Python traceback (Fixture 3)', () => {
    const stderr = `Traceback (most recent call last):
  File "/var/app/handlers/auth.py", line 88, in authenticate_user
    user = db.get_user(username)
  File "/var/app/db/connection.py", line 24, in get_user
    raise KeyError("User not found in cache")
KeyError: 'User not found in cache'`;

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'python');
    assert.equal(diag.runtime, 'cpython');
    assert.equal(diag.errorType, 'KeyError');
    assert.equal(diag.message, "'User not found in cache'");
    // Primary location is bottom-most frame
    assert.equal(diag.sourceFile, '/var/app/db/connection.py');
    assert.equal(diag.line, 24);
    assert.equal(diag.confidence, ConfidenceLevel.EXACTLY_PARSED);
    assert.equal(diag.stackFrames.length, 2);
    assert.equal(diag.stackFrames[0].function, 'authenticate_user');
    assert.equal(diag.stackFrames[1].function, 'get_user');
  });

  // Fixture 4: Malformed / incomplete Python traceback
  test('handles malformed Python traceback safely (Fixture 4)', () => {
    const stderr = `Traceback (most recent call last):
  File "broken.py", line invalid_line_number
Malformed text`;

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'python');
    assert.equal(diag.confidence, ConfidenceLevel.EXACTLY_PARSED);
  });

  // Fixture 5: Rust compiler error with code and source span
  test('parses Rust compiler diagnostic with error code and span (Fixture 5)', () => {
    const stderr = `error[E0308]: mismatched types
  --> src/models/user.rs:54:19
   |
54 |         let id: u64 = "12345";
   |                       ^^^^^^^ expected \`u64\`, found \`&str\`

error: aborting due to 1 previous error`;

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'rust');
    assert.equal(diag.runtime, 'rustc');
    assert.equal(diag.errorCode, 'E0308');
    assert.equal(diag.errorType, 'CompilerError[E0308]');
    assert.equal(diag.message, 'mismatched types');
    assert.equal(diag.sourceFile, 'src/models/user.rs');
    assert.equal(diag.line, 54);
    assert.equal(diag.column, 19);
    assert.equal(diag.confidence, ConfidenceLevel.EXACTLY_PARSED);
  });

  // Fixture 6: Rust diagnostic without location
  test('parses Rust compiler error without location span (Fixture 6)', () => {
    const stderr = 'error[E0463]: can\'t find crate for `std`';

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'rust');
    assert.equal(diag.errorCode, 'E0463');
    assert.equal(diag.sourceFile, null);
    assert.equal(diag.line, null);
    assert.equal(diag.confidence, ConfidenceLevel.EXACTLY_PARSED);
  });

  // Fixture 7: Go runtime panic with goroutines
  test('parses Go runtime panic with stack frames (Fixture 7)', () => {
    const stderr = `panic: runtime error: index out of range [5] with length 3

goroutine 1 [running]:
main.processItems(0xc0000a4000, 0x3, 0x3)
	/workspace/project/cmd/worker.go:72 +0xa4
main.main()
	/workspace/project/cmd/main.go:18 +0x2e`;

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'go');
    assert.equal(diag.runtime, 'go');
    assert.equal(diag.errorType, 'panic');
    assert.equal(diag.message, 'runtime error: index out of range [5] with length 3');
    assert.equal(diag.sourceFile, '/workspace/project/cmd/worker.go');
    assert.equal(diag.line, 72);
    assert.equal(diag.confidence, ConfidenceLevel.EXACTLY_PARSED);
    assert.equal(diag.stackFrames.length, 2);
  });

  // Fixture 8: Unrelated stderr (returns UNKNOWN without hallucination)
  test('returns UNKNOWN confidence on arbitrary non-diagnostic stderr (Fixture 8)', () => {
    const stderr = 'curl: (7) Failed to connect to 127.0.0.1 port 8080 after 1 ms: Couldn\'t connect to server';

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, null);
    assert.equal(diag.runtime, null);
    assert.equal(diag.sourceFile, null);
    assert.equal(diag.line, null);
    assert.equal(diag.column, null);
    assert.equal(diag.confidence, ConfidenceLevel.UNKNOWN);
    assert.equal(diag.confidenceByField.language, ConfidenceLevel.UNKNOWN);
    assert.equal(diag.confidenceByField.location, ConfidenceLevel.UNKNOWN);
  });

  // Fixture 9: Mixed stdout and stderr
  test('resolves diagnostic when error is split across stdout/stderr (Fixture 9)', () => {
    const stdout = 'Building target: user-service';
    const stderr = `TypeError: Assignment to constant variable.
    at updateVersion (/app/src/version.js:10:3)`;

    const diag = parseDiagnostic(stderr, stdout);
    assert.equal(diag.language, 'node');
    assert.equal(diag.errorType, 'TypeError');
    assert.equal(diag.sourceFile, '/app/src/version.js');
    assert.equal(diag.line, 10);
    assert.equal(diag.column, 3);
  });

  // Fixture 10: Windows file paths
  test('correctly parses Windows backslash paths in stack traces (Fixture 10)', () => {
    const stderr = `ReferenceError: config is not defined
    at loadConfig (C:\\Users\\admin\\AppData\\Local\\rewind\\config.js:102:14)`;

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'node');
    assert.equal(diag.sourceFile, 'C:\\Users\\admin\\AppData\\Local\\rewind\\config.js');
    assert.equal(diag.line, 102);
    assert.equal(diag.column, 14);
  });

  // Fixture 11: Unix file paths
  test('correctly parses Unix forward-slash paths in stack traces (Fixture 11)', () => {
    const stderr = `AssertionError [ERR_ASSERTION]: false == true
    at Context.<anonymous> (/var/lib/jenkins/workspace/test/unit.js:33:12)`;

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'node');
    assert.equal(diag.sourceFile, '/var/lib/jenkins/workspace/test/unit.js');
    assert.equal(diag.line, 33);
    assert.equal(diag.column, 12);
  });

  // Fixture 12: Unicode in error messages
  test('handles Unicode and special characters safely (Fixture 12)', () => {
    const stderr = `SyntaxError: Invalid or unexpected token '🚀'
    at compileScript (node:internal/vm:100:10)
    at runTest (/project/src/unicode.js:5:1)`;

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'node');
    assert.equal(diag.errorType, 'SyntaxError');
    assert.ok(diag.message.includes('🚀'));
    assert.equal(diag.sourceFile, '/project/src/unicode.js');
    assert.equal(diag.line, 5);
  });

  // Fixture 13: Multiline error message
  test('handles multiline error messages without dropping details (Fixture 13)', () => {
    const stderr = `Error: Query failed with multi-line error:
  SELECT * FROM users
  WHERE id = $1
  Table 'users' does not exist
    at Query.run (/app/db.js:50:9)`;

    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'node');
    assert.equal(diag.sourceFile, '/app/db.js');
    assert.equal(diag.line, 50);
    assert.equal(diag.column, 9);
  });

  // Fixture 14: False parser matches prevention
  test('prevents false matches when generic text contains the word "Error" (Fixture 14)', () => {
    const genericText = `Compilation summary:
Error Count: 0
Warnings: 2
Status: Success with warnings`;

    const diag = parseDiagnostic(genericText);
    assert.equal(diag.language, null);
    assert.equal(diag.confidence, ConfidenceLevel.UNKNOWN);
  });

  // Fixture 15: Nested / Chained exception causes
  test('parses nested causes in Node and chained exceptions in Python (Fixture 15)', () => {
    const nodeNested = `Error: Service initialization failed
    at init (/app/app.js:20:5)
[cause]: TypeError: Missing database connection string
    at dbConnect (/app/db.js:10:3)`;

    const nodeDiag = parseDiagnostic(nodeNested);
    assert.equal(nodeDiag.language, 'node');
    assert.equal(nodeDiag.sourceFile, '/app/app.js');
    assert.ok(nodeDiag.nestedCause);
    assert.equal(nodeDiag.nestedCause.errorType, 'TypeError');
    assert.equal(nodeDiag.nestedCause.sourceFile, '/app/db.js');
    assert.equal(nodeDiag.nestedCause.line, 10);

    const pythonChained = `Traceback (most recent call last):
  File "app.py", line 10, in db_call
    raise ConnectionError("DB offline")
ConnectionError: DB offline

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "app.py", line 25, in handle_request
    raise RuntimeError("Request failed due to DB")
RuntimeError: Request failed due to DB`;

    const pyDiag = parseDiagnostic(pythonChained);
    assert.equal(pyDiag.language, 'python');
    assert.equal(pyDiag.errorType, 'RuntimeError');
    assert.equal(pyDiag.line, 25);
    assert.ok(pyDiag.nestedCause);
    assert.equal(pyDiag.nestedCause.errorType, 'ConnectionError');
    assert.equal(pyDiag.nestedCause.line, 10);
  });

  test('preserves raw evidence intact without destructive transformation', () => {
    const raw = `TypeError: Oops
    at test.js:1:1`;

    const diag = parseDiagnostic(raw);
    assert.equal(diag.rawEvidenceSnippet, 'TypeError: Oops');
  });

  test('parses AWS CLI errors', () => {
    const stderr = `An error occurred (AccessDenied) when calling the GetObject operation: Access Denied`;
    const diag = parseDiagnostic(stderr);
    
    assert.equal(diag.language, 'aws-cli');
    assert.equal(diag.runtime, 'aws');
    assert.equal(diag.errorType, 'GetObject');
    assert.equal(diag.errorCode, 'AccessDenied');
    assert.equal(diag.message, 'Access Denied');
  });

  test('parses Terraform errors', () => {
    const stderr = `Error: Reference to undeclared resource

  on main.tf line 10, in resource "aws_instance" "web":
  10:   ami = aws_ami.ubuntu.id`;
  
    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'terraform');
    assert.equal(diag.errorType, 'TerraformError');
    assert.equal(diag.message, 'Reference to undeclared resource');
    assert.equal(diag.sourceFile, 'main.tf');
    assert.equal(diag.line, 10);
  });

  test('parses Kubernetes (kubectl) server errors', () => {
    const stderr = `Error from server (NotFound): pods "foo" not found`;
    const diag = parseDiagnostic(stderr);
    
    assert.equal(diag.language, 'kubernetes');
    assert.equal(diag.errorType, 'ServerError');
    assert.equal(diag.errorCode, 'NotFound');
    assert.equal(diag.message, 'pods "foo" not found');
  });

  test('parses Kubernetes connection refused errors with kubectl signature or context', () => {
    const stderr = 'The connection to the server 127.0.0.1:6443 was refused - did you specify the right host or port?';
    const diag = parseDiagnostic(stderr);
    assert.ok(diag);
    assert.equal(diag.language, 'kubernetes');
    assert.equal(diag.errorType, 'ConnectionError');
    assert.equal(diag.errorCode, 'ECONNREFUSED');

    // Generic server connection refused without k8s context should not match kubernetes
    const nonKube = 'The connection to the server redis-cache was refused';
    const diagNonKube = parseDiagnostic(nonKube);
    assert.notEqual(diagNonKube?.language, 'kubernetes');
  });

  test('parses Java exceptions with stack trace', () => {
    const stderr = `Exception in thread "main" java.lang.NullPointerException: Object is null
	at com.example.MyClass.myMethod(MyClass.java:42)
	at com.example.MyClass.main(MyClass.java:10)`;
  
    const diag = parseDiagnostic(stderr);
    assert.equal(diag.language, 'java');
    assert.equal(diag.errorType, 'java.lang.NullPointerException');
    assert.equal(diag.message, 'Object is null');
    assert.equal(diag.sourceFile, 'MyClass.java');
    assert.equal(diag.line, 42);
    assert.equal(diag.stackFrames.length, 2);
    assert.equal(diag.stackFrames[0].function, 'com.example.MyClass.myMethod');
  });
});
