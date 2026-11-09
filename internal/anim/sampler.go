// Package anim turns a stepped sort into a short, deterministic animation: which passes become frames, how long each
// frame lasts, and the encoders the CLI writes. It never touches pixels itself; the engine stays the only place that
// decides where a pixel goes.
package anim

import "slices"

// Ease is how time maps to passes. Linear walks the sort at a constant rate; EaseOut pushes through the early passes
// faster, where most of the visible movement is.
type Ease string

const (
	// Linear walks the sort at a constant rate.
	Linear Ease = "linear"
	// EaseOut pushes through the early passes faster, where most of the visible movement is.
	EaseOut Ease = "ease-out"
)

const (
	// MinFrames is the shortest animation worth encoding: two frames show the before and after.
	MinFrames = 2
	// MaxFrames bounds a single export. At 60 fps it is twenty seconds, far beyond the UI's longest duration, and it
	// keeps a mistyped duration from asking for a million frames.
	MaxFrames = 1200
	// MaxFPS is the fastest frame rate the UI and CLI accept.
	MaxFPS = 60
	// maxDurationMS clamps duration before multiplying, so a mistyped duration cannot overflow a 32-bit int on WASM.
	maxDurationMS = 600_000
)

// FrameCount is duration x fps, rounded to the nearest frame, kept between MinFrames and MaxFrames. Bad durations or
// frame rates give MinFrames rather than a negative count.
func FrameCount(durationMS, fps int) int {
	if durationMS <= 0 || fps <= 0 {
		return MinFrames
	}
	if durationMS > maxDurationMS {
		durationMS = maxDurationMS
	}
	if fps > MaxFPS {
		fps = MaxFPS
	}
	n := (durationMS*fps + 500) / 1000
	return min(MaxFrames, max(MinFrames, n))
}

// Sample picks the pass for each frame: `frames` numbers from 0 to `total`, non-decreasing, starting at 0 (the
// original) and ending at `total` (the finished sort). When there are more frames than passes (a merge sort can have
// ten), passes repeat and the easing falls back to linear so the repeats are spread evenly instead of piling up at the
// end. The arithmetic is integer-only so the Go CLI and the TypeScript studio pick identical frames.
func Sample(total, frames int, ease Ease) []int {
	frames = max(MinFrames, frames)
	total = max(0, total)
	out := make([]int, frames)
	den := int64(frames - 1)
	if total == 0 {
		return out
	}
	strict := frames <= total+1
	if ease == EaseOut && strict {
		// p = round(total * (1 - (1 - i/den)^2)) = round(total * i * (2*den - i) / den^2)
		sq := den * den
		for i := range out {
			num := int64(total) * int64(i) * (2*den - int64(i))
			out[i] = int((num + sq/2) / sq)
		}
	} else {
		for i := range out {
			out[i] = int((int64(total)*int64(i) + den/2) / den)
		}
	}
	if strict {
		// Rounding can put two frames on the same pass (a quadratic curve flattens); nudge them apart from both ends.
		for i := 1; i < frames; i++ {
			out[i] = max(out[i], out[i-1]+1)
		}
		out[frames-1] = total
		for i := frames - 2; i >= 0; i-- {
			out[i] = min(out[i], out[i+1]-1)
		}
	}
	out[0], out[frames-1] = 0, total
	return out
}

// Sequence is a complete frame plan: which pass each frame shows and how long it stays on screen.
type Sequence struct {
	// Passes has one entry per frame, in the order the frames are shown: up through the sort, and back down again for
	// an Infinity loop.
	Passes []int
	// DelaysMS has one entry per frame in milliseconds, with the end-hold already added to the last.
	DelaysMS []int
	// Ease is what was actually used (an unknown easing or too many frames becomes Linear).
	Ease Ease
	// FPS is the clamped frame rate the delays were built from.
	FPS int
}

// Mode is how a sequence plays. Once walks the sort from the original to the finished picture; Infinity walks it there
// and back again, so the last frame flows into the first with no seam.
type Mode string

const (
	// Once is a one-way sort: the original, then the finished picture.
	Once Mode = "once"
	// Infinity sorts, then unsorts back to the original. The return leg is the same passes replayed backwards, so it is
	// exact: the engine is a function of its recipe (see engine/README.md).
	Infinity Mode = "infinity"
)

// RoundTrip turns a forward sequence into a round trip: the forward frames, then the same passes back down to the first.
// The leading run of the original pass and the trailing run of the last one are dropped from the return leg, so a frame
// is never shown twice at a turnaround (which would read as a stutter exactly where the loop should breathe). The hold
// sits on both ends, and with loop false the closing frame is added so the animation still ends where it began.
func RoundTrip(forward Sequence, holdMS int, loop bool) Sequence {
	n := len(forward.Passes)
	if n == 0 {
		return forward
	}
	first, last := forward.Passes[0], forward.Passes[n-1]
	lo := 0
	for lo+1 < n && forward.Passes[lo+1] == first {
		lo++
	}
	hi := n - 1
	for hi > 0 && forward.Passes[hi-1] == last {
		hi--
	}
	passes := slices.Clone(forward.Passes)
	delays := slices.Clone(forward.DelaysMS)
	for i := hi - 1; i > lo; i-- {
		passes = append(passes, forward.Passes[i])
		delays = append(delays, forward.DelaysMS[i])
	}
	hold := max(0, holdMS)
	if len(delays) > 0 {
		delays[0] += hold
	}
	if !loop {
		passes = append(passes, first)
		delays = append(delays, forward.DelaysMS[0]+hold)
	}
	return Sequence{Passes: passes, DelaysMS: delays, Ease: forward.Ease, FPS: forward.FPS}
}

// NewSequence builds the frame plan for a sort with `total` passes (Stepper.MaxPasses) and the requested duration,
// frame rate, end-hold and easing. In Infinity mode the duration is split between the two legs, so the loop lasts as
// long as the settings say it does.
func NewSequence(total, durationMS, fps, holdMS int, ease Ease, mode Mode, loop bool) Sequence {
	fps = min(MaxFPS, max(1, fps))
	ms := durationMS
	if mode == Infinity {
		ms = max(1, (durationMS+1)/2)
	}
	frames := FrameCount(ms, fps)
	used := Linear
	if ease == EaseOut && frames <= total+1 {
		used = EaseOut
	}
	passes := Sample(total, frames, used)
	base := max(1, 1000/fps)
	delays := make([]int, frames)
	for i := range delays {
		delays[i] = base
	}
	if holdMS > 0 {
		delays[frames-1] += holdMS
	}
	seq := Sequence{Passes: passes, DelaysMS: delays, Ease: used, FPS: fps}
	if mode == Infinity {
		return RoundTrip(seq, holdMS, loop)
	}
	return seq
}
