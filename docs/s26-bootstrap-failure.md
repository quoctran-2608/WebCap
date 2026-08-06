# S26 bootstrap failure

Stage: apply
Run: 31071517096
Head: 693b4aa23a9c6218b829fa8a8f47029ec741a5bd

```text
file:///home/runner/work/WebCap/WebCap/scripts/s26-bootstrap.mjs:18
  if (index === -1) throw new Error(`S26 transform target missing: ${label}`);
                          ^

Error: S26 transform target missing: release browser install label
    at replaceOnce (file:///home/runner/work/WebCap/WebCap/scripts/s26-bootstrap.mjs:18:27)
    at updateReleaseWorkflow (file:///home/runner/work/WebCap/WebCap/scripts/s26-bootstrap.mjs:101:13)
    at async apply (file:///home/runner/work/WebCap/WebCap/scripts/s26-bootstrap.mjs:238:3)
    at async file:///home/runner/work/WebCap/WebCap/scripts/s26-bootstrap.mjs:267:23

Node.js v22.22.0
```
