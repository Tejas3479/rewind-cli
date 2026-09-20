# Reproducible Build Verification & Hashes (`REPRODUCIBLE_BUILD.md`)

> **Deterministic Reproducible Build**  
> *"Build your artifact twice and produce byte-identical output. Publish both hashes. Determinism is the discipline that most dependency-heavy stacks quietly lost."*

---

## 1. Verified Published Hashes

Every compilation of Rewind's source tree into a standalone distribution artifact produces **100% byte-for-byte identical output**:

```text
================================================================================
ARTIFACT:             dist/rewind.js
PASS #1 SHA-256:      68c81a190fc0de24f58def9068b794c0a3753bb813ad23ae4b62c995fb03b5f9
PASS #2 SHA-256:      68c81a190fc0de24f58def9068b794c0a3753bb813ad23ae4b62c995fb03b5f9
FILE SIZE:            494,078 bytes
DETERMINISTIC MATCH:  TRUE (100% Bitwise Parity)
================================================================================
```

---

## 2. 60-Second Verification Instructions

You can reproduce and independently verify these hashes with **one single command** without installing any packages:

### Option A: Using NPM
```bash
npm run build
```

### Option B: Using Node.js directly
```bash
node scripts/build.js
```

### Option C: Using Make
```bash
make build
```

### Option D: Run Automated Determinism Tests
```bash
node --test test/build.test.js
```

---

## 3. How Rewind Achieves Bitwise Determinism

Rewind implements a zero-dependency deterministic compilation pipeline in [`scripts/build.js`](./scripts/build.js):

1. **Lexicographical Module Sorting**: Source modules in `src/` and `bin/` are discovered recursively and sorted strictly alphabetically by relative path.
2. **Line-Ending Normalization**: All CRLF (`\r\n`) line endings are normalized to Unix LF (`\n`) ensuring bitwise parity regardless of host OS (Windows, macOS, Linux).
3. **Zero Dynamic Headers**: Compilation timestamps, random seeds, and host-specific path leaks are completely excluded.
4. **Self-Contained Module Registry**: Wraps modules in an in-memory virtual registry with built-in standard library bindings and strict isolation.
5. **Dual-Pass Verification**: The build engine performs two distinct in-memory compilation passes from clean state and cryptographically verifies `hash1 === hash2` before writing to `dist/rewind.js`.

---

## 4. Testing the Compiled Standalone Artifact

The resulting `dist/rewind.js` artifact is completely self-contained and runnable anywhere Node.js is installed:

```bash
# Check version
node dist/rewind.js --version

# Run full help screen
node dist/rewind.js help

# Run a failure capture command
node dist/rewind.js run node -e "throw new Error('Test Failure');"
```
