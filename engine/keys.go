package engine

// KeyFunc maps a packed pixel to its sort key. Keys are one byte each (decision E2): on a 24 MP image that is
// 24 MB instead of 96, and a byte is all the ordering an 8-bit channel can carry.
type KeyFunc func(p uint32) uint8

// KeyFor returns the key function for a sort key. Reversed keys are 255-key, which keeps ties tied, so a stable
// sort stays stable in both directions.
//
// It panics for a key that is not one of the Key* constants. That cannot happen through the public API, because
// Params.Validate rejects unknown keys first: it is a programmer error, not bad input.
func KeyFor(k SortKey, reverse bool) KeyFunc {
	var f KeyFunc
	switch k {
	case KeyLuma:
		f = func(p uint32) uint8 {
			r, g, b, _ := Unpack(p)
			return uint8((299*uint32(r) + 587*uint32(g) + 114*uint32(b)) / 1000 & 0xff)
		}
	case KeyValue:
		f = func(p uint32) uint8 {
			r, g, b, _ := Unpack(p)
			return max(r, g, b)
		}
	case KeyIntensity:
		f = func(p uint32) uint8 {
			r, g, b, _ := Unpack(p)
			return uint8((uint32(r) + uint32(g) + uint32(b)) / 3 & 0xff)
		}
	case KeyMinimum:
		f = func(p uint32) uint8 {
			r, g, b, _ := Unpack(p)
			return min(r, g, b)
		}
	case KeySaturation:
		f = func(p uint32) uint8 {
			r, g, b, _ := Unpack(p)
			return uint8(saturationKey(r, g, b) & 0xff)
		}
	case KeyHue:
		f = func(p uint32) uint8 {
			r, g, b, _ := Unpack(p)
			return uint8(hueKey(r, g, b) & 0xff)
		}
	case KeyRed:
		f = func(p uint32) uint8 { return uint8(p & 0xff) }
	case KeyGreen:
		f = func(p uint32) uint8 { return uint8((p >> 8) & 0xff) }
	case KeyBlue:
		f = func(p uint32) uint8 { return uint8((p >> 16) & 0xff) }
	case KeyAlpha:
		f = func(p uint32) uint8 { return uint8((p >> 24) & 0xff) }
	default:
		panic("engine: KeyFor: unknown sort key " + string(k))
	}
	if !reverse {
		return f
	}
	return func(p uint32) uint8 { return 255 - f(p) }
}

// ComputeKeys returns one key per pixel of im, in position order. Plan does the same thing with per-class keys;
// this is the convenience a caller wants for a single recipe.
func ComputeKeys(im *Image, k SortKey, reverse bool) []uint8 {
	key := KeyFor(k, reverse)
	out := make([]uint8, len(im.Pix))
	for i, p := range im.Pix {
		out[i] = key(p)
	}
	return out
}

// hueKey is the integer HSV hue, quantised to 0..254: (sextant, position inside it) mapped onto a byte.
func hueKey(r, g, b uint8) int {
	mx, mn := max(r, g, b), min(r, g, b)
	d := int(mx) - int(mn)
	if d == 0 {
		return 0
	}
	var v int // 0..1529 around the colour wheel
	switch mx {
	case r:
		v = 255 * (int(g) - int(b)) / d // Go integer division truncates toward zero, fixed up just below
		if v < 0 {
			v += 1530
		}
	case g:
		v = 255*(int(b)-int(r))/d + 510
	default:
		v = 255*(int(r)-int(g))/d + 1020
	}
	return v / 6
}

// saturationKey is the integer HSV saturation, 0..255.
func saturationKey(r, g, b uint8) int {
	mx, mn := max(r, g, b), min(r, g, b)
	if mx == 0 {
		return 0
	}
	return (int(mx) - int(mn)) * 255 / int(mx)
}
