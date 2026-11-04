// Package engine is the pixel-sorting engine. It is pure: no I/O, no globals, no syscall/js. PLAN.md section 3.
package engine

// EngineVersion identifies engine behaviour. It is stored with every run and bumped whenever a golden hash
// changes on purpose (see docs/dev/testing.md).
const EngineVersion = "1"
