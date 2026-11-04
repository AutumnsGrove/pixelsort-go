//go:build js && wasm

package main

import (
	"fmt"
	"syscall/js"
	"unsafe"
)

// pixelBytes views a packed-pixel slice as bytes without copying. Safe here because Go WebAssembly is single
// threaded and little-endian, and the session keeps the slice referenced, so the address is stable until the next
// Init, SetImage or FinishInstant.
func pixelBytes(p []uint32) []byte {
	if len(p) == 0 {
		return nil
	}
	return unsafe.Slice((*byte)(unsafe.Pointer(&p[0])), len(p)*4) //nolint:gosec // see doc comment: single-threaded, little-endian
}

// pixelAddr is the byte address of the first pixel in Go's linear memory.
func pixelAddr(p []uint32) uintptr {
	if len(p) == 0 {
		return 0
	}
	return uintptr(unsafe.Pointer(&p[0])) //nolint:gosec // an address handed to JavaScript, which only reads it
}

// bytesFrom copies a Uint8Array / Uint8ClampedArray into Go memory.
func bytesFrom(v js.Value) []byte {
	b := make([]byte, v.Get("length").Int())
	js.CopyBytesToGo(b, v)
	return b
}

// u16From copies a Uint16Array into Go memory by way of its bytes.
func u16From(v js.Value) []uint16 {
	n := v.Get("length").Int()
	raw := make([]byte, n*2)
	js.CopyBytesToGo(raw, js.Global().Get("Uint8Array").New(v.Get("buffer"), v.Get("byteOffset"), n*2))
	out := make([]uint16, n)
	for i := range out {
		out[i] = uint16(raw[2*i]) | uint16(raw[2*i+1])<<8
	}
	return out
}

func isNull(v js.Value) bool { return v.IsNull() || v.IsUndefined() }

func result(fields map[string]any) any {
	o := js.Global().Get("Object").New()
	o.Set("ok", true)
	for k, v := range fields {
		o.Set(k, v)
	}
	return o
}

func fail(err error) any {
	o := js.Global().Get("Object").New()
	o.Set("ok", false)
	o.Set("error", err.Error())
	return o
}

// guard turns a panic into a failure result: a panic escaping a js.Func would end the whole Go runtime.
func guard(f func(args []js.Value) (any, error)) js.Func {
	return js.FuncOf(func(_ js.Value, args []js.Value) (ret any) {
		defer func() {
			if r := recover(); r != nil {
				ret = fail(fmt.Errorf("internal: %v", r))
			}
		}()
		out, err := f(args)
		if err != nil {
			return fail(err)
		}
		return out
	})
}
