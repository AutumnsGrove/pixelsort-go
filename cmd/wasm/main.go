//go:build js && wasm

// Command wasm is the browser entry point: it exposes the engine session to JavaScript as globalThis.pixelsort.
// It only converts values; every rule lives in engine/api.
package main

import (
	"errors"
	"syscall/js"

	"github.com/AutumnsGrove/pixelsort-go/engine/api"
)

func main() {
	s := api.NewSession()
	fns := map[string]func([]js.Value) (any, error){
		"version": func([]js.Value) (any, error) { return result(map[string]any{"version": api.Version()}), nil },
		"init": func(a []js.Value) (any, error) {
			if len(a) < 2 {
				return nil, errors.New("init needs w and h")
			}
			return okOr(s.Init(a[0].Int(), a[1].Int()))
		},
		"setImage": func(a []js.Value) (any, error) {
			if len(a) < 1 {
				return nil, errors.New("setImage needs RGBA bytes")
			}
			return okOr(s.SetImage(bytesFrom(a[0])))
		},
		"setRegions": func(a []js.Value) (any, error) {
			if len(a) < 3 {
				return nil, errors.New("setRegions needs labels, classOf and defs")
			}
			if isNull(a[0]) {
				return okOr(s.SetRegions(nil, nil, nil))
			}
			return okOr(s.SetRegions(u16From(a[0]), bytesFrom(a[1]), []byte(a[2].String())))
		},
		"setTiling": func(a []js.Value) (any, error) {
			if len(a) < 1 || isNull(a[0]) {
				return okOr(s.SetTiling(nil, nil))
			}
			var defs []byte
			if len(a) > 1 && !isNull(a[1]) {
				defs = []byte(a[1].String())
			}
			return okOr(s.SetTiling([]byte(a[0].String()), defs))
		},
		"setMaskSpec": func(a []js.Value) (any, error) {
			if len(a) < 1 || isNull(a[0]) {
				return okOr(s.SetMaskSpec(nil))
			}
			return okOr(s.SetMaskSpec([]byte(a[0].String())))
		},
		"labelsPtr": func([]js.Value) (any, error) {
			l := s.Labels()
			return result(map[string]any{"ptr": int(labelAddr(l)), "len": len(l) * 2}), nil
		},
		"classOf": func([]js.Value) (any, error) {
			return result(map[string]any{"classes": newU8(s.ClassOf())}), nil
		},
		"sortable": func([]js.Value) (any, error) {
			m, err := s.Sortable()
			if err != nil {
				return nil, err
			}
			return result(map[string]any{"mask": newU8(m)}), nil
		},
		"histogram": func(a []js.Value) (any, error) {
			if len(a) < 1 {
				return nil, errors.New("histogram needs a sort key")
			}
			h, err := s.Histogram(a[0].String())
			if err != nil {
				return nil, err
			}
			arr := js.Global().Get("Array").New(len(h))
			for i, c := range h {
				arr.SetIndex(i, c)
			}
			return result(map[string]any{"counts": arr}), nil
		},
		"caRules": func([]js.Value) (any, error) {
			rules := api.CARules()
			arr := js.Global().Get("Array").New(len(rules))
			for i, r := range rules {
				o := js.Global().Get("Object").New()
				o.Set("rule", r.Rule)
				o.Set("note", r.Note)
				arr.SetIndex(i, o)
			}
			return result(map[string]any{"rules": arr}), nil
		},
		"brightestSpot": func([]js.Value) (any, error) {
			cx, cy, w, h, err := s.BrightestSpot()
			if err != nil {
				return nil, err
			}
			return result(map[string]any{"cx": cx, "cy": cy, "w": w, "h": h}), nil
		},
		"setMask": func(a []js.Value) (any, error) {
			if len(a) < 1 || isNull(a[0]) {
				return okOr(s.SetMask(nil))
			}
			return okOr(s.SetMask(bytesFrom(a[0])))
		},
		"setSoft": func(a []js.Value) (any, error) {
			if len(a) < 1 {
				return nil, errors.New("setSoft needs a radius")
			}
			return okOr(s.SetSoft(a[0].Int()))
		},
		"configure": func(a []js.Value) (any, error) {
			if len(a) < 1 {
				return nil, errors.New("configure needs JSON")
			}
			return okOr(s.Configure([]byte(a[0].String())))
		},
		"prepare": func([]js.Value) (any, error) {
			st, err := s.Prepare()
			if err != nil {
				return nil, err
			}
			o := js.Global().Get("Object").New()
			o.Set("lines", st.Lines)
			o.Set("intervals", st.Intervals)
			o.Set("sortable", st.SortablePixels)
			o.Set("frozen", st.FrozenPixels)
			return result(map[string]any{"stats": o}), nil
		},
		"reset": func([]js.Value) (any, error) { return okOr(s.Reset()) },
		"step": func(a []js.Value) (any, error) {
			if len(a) < 1 {
				return nil, errors.New("step needs a pass count")
			}
			done, err := s.Step(a[0].Int())
			if err != nil {
				return nil, err
			}
			return result(map[string]any{"done": done, "progress": s.Progress(), "pass": s.Pass()}), nil
		},
		"seek": func(a []js.Value) (any, error) {
			if len(a) < 1 {
				return nil, errors.New("seek needs a pass number")
			}
			done, err := s.Seek(a[0].Int())
			if err != nil {
				return nil, err
			}
			return result(map[string]any{"done": done, "progress": s.Progress(), "pass": s.Pass()}), nil
		},
		"instant": func([]js.Value) (any, error) { return okOr(s.FinishInstant()) },
		"pixelsPtr": func([]js.Value) (any, error) {
			px := s.Pixels()
			return result(map[string]any{"ptr": int(pixelAddr(px)), "len": len(px) * 4}), nil
		},
		"copyPixels": func(a []js.Value) (any, error) {
			px := pixelBytes(s.Pixels())
			if len(a) < 1 || a[0].Get("length").Int() != len(px) {
				return nil, errors.New("copyPixels needs a Uint8Array of exactly 4*w*h bytes")
			}
			js.CopyBytesToJS(a[0], px)
			return result(nil), nil
		},
	}
	pixelsort := js.Global().Get("Object").New()
	for name, f := range fns {
		pixelsort.Set(name, guard(f))
	}
	pixelsort.Set("ping", pixelsort.Get("version")) // phase 0's name, kept as an alias
	js.Global().Set("pixelsort", pixelsort)
	js.Global().Set("pixelsortReady", true)
	select {} // keep the Go runtime alive so JavaScript can call back in
}

// okOr turns an error into the failure result and success into {ok: true}.
func okOr(err error) (any, error) {
	if err != nil {
		return nil, err
	}
	return result(nil), nil
}
