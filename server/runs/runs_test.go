package runs_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/AutumnsGrove/pixelsort-go/server/blob"
	"github.com/AutumnsGrove/pixelsort-go/server/db"
	"github.com/AutumnsGrove/pixelsort-go/server/runs"
)

type env struct {
	svc  *runs.Service
	root string
	now  time.Time
}

func newEnv(t testing.TB) *env {
	t.Helper()
	root := t.TempDir()
	d, err := db.Open(filepath.Join(root, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := db.Migrate(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	b, err := blob.New(root, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	e := &env{root: root, now: time.Unix(1_700_000_000, 0)}
	e.svc = runs.New(d, b, 7)
	e.svc.Now = func() time.Time { return e.now }
	return e
}

// img returns a distinct tiny PNG and its hash for each n.
func img(_ testing.TB, n int) ([]byte, string) {
	g := image.NewGray(image.Rect(0, 0, 4, 4))
	g.Pix[0], g.Pix[1] = uint8(n), uint8(n>>8)
	var b bytes.Buffer
	if err := png.Encode(&b, g); err != nil {
		panic(err) // encoding a 4x4 gray image cannot fail
	}
	s := sha256.Sum256(b.Bytes())
	return b.Bytes(), hex.EncodeToString(s[:])
}

type spec struct {
	orig, res, thumb int
	settings         string
	seed             int64
	parent           *int64
	omitOriginal     bool
}

func (e *env) create(t testing.TB, sp spec) runs.Run {
	t.Helper()
	r, _, err := e.tryCreate(sp)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func (e *env) tryCreate(sp spec) (runs.Run, bool, error) {
	if sp.settings == "" {
		sp.settings = `{"mode":"random","angle":45}`
	}
	ob, os := img(nil, sp.orig)
	rb, rs := img(nil, sp.res)
	tb, ts := img(nil, sp.thumb)
	m := runs.Meta{Settings: []byte(sp.settings), Seed: sp.seed, EngineVersion: "1", ParentRunID: sp.parent,
		Original: runs.ImageMeta{SHA256: os, W: 4, H: 4}, Result: runs.ImageMeta{SHA256: rs, W: 4, H: 4}, Thumb: runs.ImageMeta{SHA256: ts, W: 4, H: 4}}
	p := runs.Parts{Original: bytes.NewReader(ob), Result: bytes.NewReader(rb), Thumb: bytes.NewReader(tb)}
	if sp.omitOriginal {
		p.Original = nil
	}
	return e.svc.Create(context.Background(), m, p)
}

func blobFiles(t testing.TB, root string) int {
	t.Helper()
	n := 0
	_ = filepath.WalkDir(filepath.Join(root, "images"), func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			n++
		}
		return nil
	})
	return n
}

func TestCreateHappyPath(t *testing.T) {
	e := newEnv(t)
	r := e.create(t, spec{orig: 1, res: 2, thumb: 3, seed: 7})
	if r.ID == 0 || r.Original.Mime != "image/png" || r.Result.Bytes == 0 || r.EngineVersion != "1" || len(r.Tags) != 0 || r.Starred {
		t.Fatalf("%+v", r)
	}
	if blobFiles(t, e.root) != 3 {
		t.Fatalf("%d files", blobFiles(t, e.root))
	}
}

func TestCreateOmitsKnownOriginal(t *testing.T) {
	e := newEnv(t)
	e.create(t, spec{orig: 1, res: 2, thumb: 3})
	if _, _, err := e.tryCreate(spec{orig: 1, res: 4, thumb: 5, omitOriginal: true}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := e.tryCreate(spec{orig: 99, res: 6, thumb: 7, omitOriginal: true}); !errors.Is(err, runs.ErrInvalid) {
		t.Fatalf("unknown original without a part: %v", err)
	}
	if blobFiles(t, e.root) != 5 {
		t.Fatalf("a failed create left files: %d", blobFiles(t, e.root))
	}
}

func TestCreateHashMismatchLeavesNothing(t *testing.T) {
	e := newEnv(t)
	ob, _ := img(t, 1)
	rb, rs := img(t, 2)
	tb, ts := img(t, 3)
	m := runs.Meta{Settings: []byte(`{}`), EngineVersion: "1", Original: runs.ImageMeta{SHA256: strings.Repeat("a", 64)},
		Result: runs.ImageMeta{SHA256: rs}, Thumb: runs.ImageMeta{SHA256: ts}}
	_, _, err := e.svc.Create(context.Background(), m, runs.Parts{Original: bytes.NewReader(ob), Result: bytes.NewReader(rb), Thumb: bytes.NewReader(tb)})
	if !errors.Is(err, blob.ErrHashMismatch) {
		t.Fatalf("got %v", err)
	}
	if blobFiles(t, e.root) != 0 {
		t.Fatal("orphan files")
	}
	if page, _ := e.svc.List(context.Background(), runs.ListQuery{}); len(page.Runs) != 0 {
		t.Fatal("a run exists")
	}
}

func TestCreateBadParentIsRejectedAndCleansUp(t *testing.T) {
	e := newEnv(t)
	missing := int64(999)
	if _, _, err := e.tryCreate(spec{orig: 1, res: 2, thumb: 3, parent: &missing}); !errors.Is(err, runs.ErrInvalid) {
		t.Fatalf("got %v", err)
	}
	if blobFiles(t, e.root) != 0 {
		t.Fatal("orphan files after a rejected run")
	}
}

func TestCreateValidation(t *testing.T) {
	e := newEnv(t)
	for name, sp := range map[string]spec{
		"settings not an object": {orig: 1, res: 2, thumb: 3, settings: `[1]`},
		"settings null":          {orig: 1, res: 2, thumb: 3, settings: `null`},
		"negative seed":          {orig: 1, res: 2, thumb: 3, seed: -1},
	} {
		if _, _, err := e.tryCreate(sp); !errors.Is(err, runs.ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	rb, rs := img(t, 2)
	tb, ts := img(t, 3)
	bad := []byte("not an image at all")
	s := sha256.Sum256(bad)
	m := runs.Meta{Settings: []byte(`{}`), EngineVersion: "1", Original: runs.ImageMeta{SHA256: hex.EncodeToString(s[:])}, Result: runs.ImageMeta{SHA256: rs}, Thumb: runs.ImageMeta{SHA256: ts}}
	if _, _, err := e.svc.Create(context.Background(), m, runs.Parts{Original: bytes.NewReader(bad), Result: bytes.NewReader(rb), Thumb: bytes.NewReader(tb)}); !errors.Is(err, blob.ErrBadType) {
		t.Fatalf("non-image original: %v", err)
	}
}

func TestDuplicateIsIdempotent(t *testing.T) {
	e := newEnv(t)
	a := e.create(t, spec{orig: 1, res: 2, thumb: 3, seed: 7})
	b, created, err := e.tryCreate(spec{orig: 1, res: 2, thumb: 3, seed: 7})
	if err != nil || created || b.ID != a.ID {
		t.Fatalf("created=%v id %d vs %d err %v", created, b.ID, a.ID, err)
	}
	if c, created, _ := e.tryCreate(spec{orig: 1, res: 2, thumb: 3, seed: 8}); !created || c.ID == a.ID {
		t.Fatal("a different seed must make a new run")
	}
}

func TestListPaginatesEveryRunOnce(t *testing.T) {
	e := newEnv(t)
	const n = 250
	for i := 0; i < n; i++ {
		e.now = e.now.Add(time.Second / 2) // several runs share a second, so the id tie-break matters
		e.create(t, spec{orig: 1, res: 1000 + i, thumb: 3000 + i, seed: int64(i)})
	}
	for _, sort := range []string{"new", "old", "size"} {
		seen := map[int64]bool{}
		cursor, pages := "", 0
		for {
			page, err := e.svc.List(context.Background(), runs.ListQuery{Cursor: cursor, Limit: 60, Sort: sort})
			if err != nil {
				t.Fatal(err)
			}
			for _, r := range page.Runs {
				if seen[r.ID] {
					t.Fatalf("%s: run %d twice", sort, r.ID)
				}
				seen[r.ID] = true
			}
			pages++
			if page.NextCursor == nil {
				break
			}
			cursor = *page.NextCursor
		}
		if len(seen) != n || pages != 5 {
			t.Fatalf("%s: %d runs in %d pages", sort, len(seen), pages)
		}
	}
}

func TestListStableUnderInserts(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 10; i++ {
		e.now = e.now.Add(time.Second)
		e.create(t, spec{orig: 1, res: 10 + i, thumb: 50 + i, seed: int64(i)})
	}
	first, _ := e.svc.List(context.Background(), runs.ListQuery{Limit: 5})
	e.now = e.now.Add(time.Hour)
	e.create(t, spec{orig: 1, res: 900, thumb: 901, seed: 900}) // newer than everything: must not shift page 2
	second, err := e.svc.List(context.Background(), runs.ListQuery{Limit: 5, Cursor: *first.NextCursor})
	if err != nil || len(second.Runs) != 5 || second.Runs[0].ID == first.Runs[4].ID {
		t.Fatalf("%v %v", second, err)
	}
}

func TestListFiltersAndSearch(t *testing.T) {
	e := newEnv(t)
	a := e.create(t, spec{orig: 1, res: 2, thumb: 3, settings: `{"mode":"wave","key":"hue","angle":45}`, seed: 1})
	b := e.create(t, spec{orig: 1, res: 4, thumb: 5, settings: `{"mode":"ca","rule":110,"angle":90}`, seed: 2})
	c := e.create(t, spec{orig: 1, res: 6, thumb: 7, settings: `{"mode":"random"}`, seed: 3})
	star := true
	title := "50% Sunset_glow"
	if _, err := e.svc.Update(context.Background(), c.ID, runs.Patch{Starred: &star, Title: &title}); err != nil {
		t.Fatal(err)
	}
	ids := func(q runs.ListQuery) []int64 {
		p, err := e.svc.List(context.Background(), q)
		if err != nil {
			t.Fatalf("%+v: %v", q, err)
		}
		var out []int64
		for _, r := range p.Runs {
			out = append(out, r.ID)
		}
		return out
	}
	for name, tc := range map[string]struct {
		q    runs.ListQuery
		want []int64
	}{
		"mode word":                    {runs.ListQuery{Q: "wave"}, []int64{a.ID}},
		"key word":                     {runs.ListQuery{Q: "HUE"}, []int64{a.ID}},
		"angle with degree":            {runs.ListQuery{Q: "90°"}, []int64{b.ID}},
		"rule N":                       {runs.ListQuery{Q: "rule 110"}, []int64{b.ID}},
		"percent literal":              {runs.ListQuery{Q: "50%"}, []int64{c.ID}},
		"underscore literal":           {runs.ListQuery{Q: "sunset_glow"}, []int64{c.ID}},
		"underscore is not a wildcard": {runs.ListQuery{Q: "sunset-glow"}, nil},
		"percent is not a wildcard":    {runs.ListQuery{Q: "%"}, []int64{c.ID}},
		"starred":                      {runs.ListQuery{Starred: true}, []int64{c.ID}},
	} {
		if got := ids(tc.q); fmt.Sprint(got) != fmt.Sprint(tc.want) {
			t.Errorf("%s: got %v, want %v", name, got, tc.want)
		}
	}
	if _, err := e.svc.List(context.Background(), runs.ListQuery{Cursor: "!!!"}); !errors.Is(err, runs.ErrInvalid) {
		t.Errorf("bad cursor: %v", err)
	}
	if _, err := e.svc.List(context.Background(), runs.ListQuery{Sort: "bogus"}); !errors.Is(err, runs.ErrInvalid) {
		t.Errorf("bad sort: %v", err)
	}
	if p, _ := e.svc.List(context.Background(), runs.ListQuery{Limit: 100000}); len(p.Runs) != 3 {
		t.Errorf("limit clamp: %d", len(p.Runs))
	}
}

func TestPatchTitleRules(t *testing.T) {
	e := newEnv(t)
	r := e.create(t, spec{orig: 1, res: 2, thumb: 3})
	set := func(s string) *string {
		out, err := e.svc.Update(context.Background(), r.ID, runs.Patch{Title: &s})
		if err != nil {
			t.Fatal(err)
		}
		return out.Title
	}
	if got := set("  hello \n\t world\u0007 "); got == nil || *got != "hello world" {
		t.Fatalf("control chars: %v", got)
	}
	long := strings.Repeat("a", 59) + "🙂🙂"
	if got := set(long); got == nil || len([]rune(*got)) != 60 || !strings.HasSuffix(*got, "🙂") {
		t.Fatalf("an emoji at the boundary was split: %v", got)
	}
	if got := set(strings.Repeat("b", 61)); got == nil || len([]rune(*got)) != 60 {
		t.Fatalf("61 chars: %v", got)
	}
	if got := set("   "); got != nil {
		t.Fatalf("empty title should clear to automatic, got %q", *got)
	}
}

func TestPatchTagsAndNotes(t *testing.T) {
	e := newEnv(t)
	r := e.create(t, spec{orig: 1, res: 2, thumb: 3})
	tags := []string{"b", "a", "A", " ", "c"}
	notes := "  remember this  "
	out, err := e.svc.Update(context.Background(), r.ID, runs.Patch{Tags: &tags, Notes: &notes})
	if err != nil || fmt.Sprint(out.Tags) != "[a b c]" || out.Notes == nil || *out.Notes != "remember this" {
		t.Fatalf("%+v %v", out, err)
	}
	many := make([]string, 21)
	for i := range many {
		many[i] = fmt.Sprint("t", i)
	}
	if _, err := e.svc.Update(context.Background(), r.ID, runs.Patch{Tags: &many}); !errors.Is(err, runs.ErrInvalid) {
		t.Fatalf("21 tags: %v", err)
	}
	if _, err := e.svc.Update(context.Background(), 12345, runs.Patch{}); !errors.Is(err, runs.ErrNotFound) {
		t.Fatalf("missing run: %v", err)
	}
}

func TestTrashStarredNeedsConfirm(t *testing.T) {
	e := newEnv(t)
	a := e.create(t, spec{orig: 1, res: 2, thumb: 3})
	b := e.create(t, spec{orig: 1, res: 4, thumb: 5, seed: 2})
	yes := true
	_, _ = e.svc.Update(context.Background(), b.ID, runs.Patch{Starred: &yes})
	res, err := e.svc.Trash(context.Background(), []int64{a.ID, b.ID}, false)
	if !errors.Is(err, runs.ErrStarredNeedOK) || fmt.Sprint(res.Starred) != fmt.Sprint([]int64{b.ID}) {
		t.Fatalf("%+v %v", res, err)
	}
	if p, _ := e.svc.List(context.Background(), runs.ListQuery{}); len(p.Runs) != 2 {
		t.Fatal("a refused trash still trashed something")
	}
	res, err = e.svc.Trash(context.Background(), []int64{a.ID, b.ID, 777}, true)
	if err != nil || len(res.Trashed) != 2 || fmt.Sprint(res.Missing) != "[777]" {
		t.Fatalf("%+v %v", res, err)
	}
	if p, _ := e.svc.List(context.Background(), runs.ListQuery{Trashed: "1"}); len(p.Runs) != 2 {
		t.Fatal("trashed runs not listed")
	}
	if err := e.svc.Restore(context.Background(), []int64{a.ID}); err != nil {
		t.Fatal(err)
	}
	if p, _ := e.svc.List(context.Background(), runs.ListQuery{}); len(p.Runs) != 1 {
		t.Fatal("restore failed")
	}
}

func TestEmptyDetachesRunsFromShares(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	r := e.create(t, spec{orig: 1, res: 2, thumb: 3, seed: 1})
	if _, err := e.svc.DB.ExecContext(ctx, `INSERT INTO shares (share_id, created_at, expires_at, include_recipe, include_original, title, revoked_at) VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaa', 1, NULL, 1, 0, NULL, NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.DB.ExecContext(ctx, `INSERT INTO share_items (share_id, run_id, position) VALUES (1, ?, 0)`, r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Trash(ctx, []int64{r.ID}, false); err != nil {
		t.Fatal(err)
	}
	// Without detaching share_items first, the FOREIGN KEY on share_items.run_id fails the delete.
	n, err := e.svc.EmptyTrash(ctx)
	if err != nil || n != 1 {
		t.Fatalf("empty with a shared run: %d %v", n, err)
	}
	if _, err := e.svc.Get(ctx, r.ID); !errors.Is(err, runs.ErrNotFound) {
		t.Fatalf("run should be gone: %v", err)
	}
	var items, shares int
	if err := e.svc.DB.QueryRowContext(ctx, `SELECT COUNT(*), (SELECT COUNT(*) FROM shares) FROM share_items`).Scan(&items, &shares); err != nil {
		t.Fatal(err)
	}
	if items != 0 || shares != 1 {
		t.Fatalf("items detached and the share kept: items=%d shares=%d", items, shares)
	}
}

func TestEmptyReparentsChildrenAndKeepsSharedImages(t *testing.T) {
	e := newEnv(t)
	grand := e.create(t, spec{orig: 1, res: 2, thumb: 3, seed: 1})
	mid := e.create(t, spec{orig: 1, res: 4, thumb: 5, seed: 2, parent: &grand.ID})
	leaf := e.create(t, spec{orig: 1, res: 6, thumb: 7, seed: 3, parent: &mid.ID})
	if _, err := e.svc.Trash(context.Background(), []int64{mid.ID}, false); err != nil {
		t.Fatal(err)
	}
	n, err := e.svc.EmptyTrash(context.Background())
	if err != nil || n != 1 {
		t.Fatalf("%d %v", n, err)
	}
	got, err := e.svc.Get(context.Background(), leaf.ID)
	if err != nil || got.ParentRunID == nil || *got.ParentRunID != grand.ID {
		t.Fatalf("child not re-parented: %+v %v", got.ParentRunID, err)
	}
	// The shared original (n=1) is still used by two runs; mid's own result and thumb are gone: 7 images - 2 = 5 files.
	if blobFiles(t, e.root) != 5 {
		t.Fatalf("%d files, want 5", blobFiles(t, e.root))
	}
	for _, r := range []runs.Run{grand, leaf} {
		if _, err := e.svc.Get(context.Background(), r.ID); err != nil {
			t.Fatal(err)
		}
	}
	// Removing the last two runs frees everything, shared original included.
	_, _ = e.svc.Trash(context.Background(), []int64{grand.ID, leaf.ID}, false)
	_, _ = e.svc.EmptyTrash(context.Background())
	if blobFiles(t, e.root) != 0 {
		t.Fatalf("%d files left", blobFiles(t, e.root))
	}
}

func TestDeleteTrashedDeletesOnlyTheSelection(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	grand := e.create(t, spec{orig: 1, res: 2, thumb: 3, seed: 1})
	parent := e.create(t, spec{orig: 4, res: 5, thumb: 6, seed: 2, parent: &grand.ID})
	child := e.create(t, spec{orig: 7, res: 8, thumb: 9, seed: 3, parent: &parent.ID})
	sibling := e.create(t, spec{orig: 10, res: 11, thumb: 12, seed: 4, parent: &grand.ID})
	kept := e.create(t, spec{orig: 13, res: 14, thumb: 15, seed: 5})
	live := e.create(t, spec{orig: 16, res: 17, thumb: 18, seed: 6})
	if _, err := e.svc.Trash(ctx, []int64{parent.ID, sibling.ID, kept.ID}, false); err != nil {
		t.Fatal(err)
	}
	// The live run and an unknown id are reported, not deleted; the duplicate is said once.
	res, err := e.svc.DeleteTrashed(ctx, []int64{parent.ID, sibling.ID, live.ID, kept.ID + 1000, sibling.ID})
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(res.Deleted) != fmt.Sprint([]int64{parent.ID, sibling.ID}) {
		t.Fatalf("deleted = %v, want %v", res.Deleted, []int64{parent.ID, sibling.ID})
	}
	if fmt.Sprint(res.Missing) != fmt.Sprint([]int64{live.ID, kept.ID + 1000}) {
		t.Fatalf("missing = %v, want %v", res.Missing, []int64{live.ID, kept.ID + 1000})
	}
	for _, id := range []int64{parent.ID, sibling.ID} {
		if _, err := e.svc.Get(ctx, id); !errors.Is(err, runs.ErrNotFound) {
			t.Fatalf("run %d should be gone: %v", id, err)
		}
	}
	got, err := e.svc.Get(ctx, child.ID)
	if err != nil || got.ParentRunID == nil || *got.ParentRunID != grand.ID {
		t.Fatalf("child not re-parented: %+v %v", got.ParentRunID, err)
	}
	if _, err := e.svc.Get(ctx, live.ID); err != nil {
		t.Fatalf("a live run was deleted: %v", err)
	}
	stillTrashed, err := e.svc.Get(ctx, kept.ID)
	if err != nil || stillTrashed.TrashedAt == nil {
		t.Fatalf("a trashed run outside the selection was deleted: %+v %v", stillTrashed.TrashedAt, err)
	}
}

func TestUsage(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	if u, err := e.svc.Usage(ctx, 100); err != nil || u.UsedBytes != 0 || u.TrashBytes != 0 || u.Runs != 0 || u.BudgetBytes != 100 {
		t.Fatalf("empty: %+v %v", u, err)
	}
	a := e.create(t, spec{orig: 1, res: 2, thumb: 3, seed: 1})
	b := e.create(t, spec{orig: 1, res: 4, thumb: 5, seed: 2}) // shares the original with a
	u, _ := e.svc.Usage(ctx, 100)
	want := a.Original.Bytes + a.Result.Bytes + a.Thumb.Bytes + b.Result.Bytes + b.Thumb.Bytes
	if u.UsedBytes != want || u.Runs != 2 {
		t.Fatalf("shared original must count once: %d, want %d", u.UsedBytes, want)
	}
	_, _ = e.svc.Trash(ctx, []int64{b.ID}, false)
	u, _ = e.svc.Usage(ctx, 100)
	if u.TrashBytes != b.Result.Bytes+b.Thumb.Bytes || u.TrashRuns != 1 || u.UsedBytes != want {
		t.Fatalf("trash bytes %d, want %d (%+v)", u.TrashBytes, b.Result.Bytes+b.Thumb.Bytes, u)
	}
	_, _ = e.svc.EmptyTrash(ctx)
	after, _ := e.svc.Usage(ctx, 100)
	if after.UsedBytes != u.UsedBytes-u.TrashBytes || after.TrashBytes != 0 {
		t.Fatalf("emptying should free exactly trash_bytes: %+v -> %+v", u, after)
	}
}

func TestJanitorRespectsTheWindowAndSweepsOrphans(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	old := e.create(t, spec{orig: 1, res: 2, thumb: 3, seed: 1})
	young := e.create(t, spec{orig: 11, res: 12, thumb: 13, seed: 2})
	_, _ = e.svc.Trash(ctx, []int64{old.ID}, false)
	e.now = e.now.Add(6 * 24 * time.Hour)
	_, _ = e.svc.Trash(ctx, []int64{young.ID}, false)
	e.now = e.now.Add(2 * 24 * time.Hour) // old has been trashed 8 days, young 2
	if err := e.svc.Janitor(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Get(ctx, old.ID); !errors.Is(err, runs.ErrNotFound) {
		t.Fatal("an expired run survived")
	}
	if _, err := e.svc.Get(ctx, young.ID); err != nil {
		t.Fatal("a run inside the window was deleted")
	}
	// An unreferenced file: swept once it is older than an hour (by the fake clock), kept while fresh.
	b, _ := blob.New(e.root, 1<<20)
	data, _ := img(t, 500)
	if _, err := b.Put(ctx, bytes.NewReader(data), ""); err != nil {
		t.Fatal(err)
	}
	e.now = time.Now().Add(-48 * time.Hour)
	if n, _ := e.svc.SweepOrphans(ctx, time.Hour); n != 0 {
		t.Fatal("a fresh orphan was swept")
	}
	e.now = time.Now().Add(2 * time.Hour)
	if n, _ := e.svc.SweepOrphans(ctx, time.Hour); n != 1 {
		t.Fatalf("swept %d, want the one orphan (referenced files must stay)", n)
	}
	if blobFiles(t, e.root) != 3 { // young's three
		t.Fatalf("%d files", blobFiles(t, e.root))
	}
}

func TestPresetsSettingsShapes(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	p, err := e.svc.AddPreset(ctx, " Glitch  Rain ", "wet", []byte(`{"mode":"wave"}`))
	if err != nil || p.Name != "Glitch Rain" {
		t.Fatalf("%+v %v", p, err)
	}
	if _, err := e.svc.AddPreset(ctx, "glitch rain", "", []byte(`{}`)); !errors.Is(err, runs.ErrConflict) {
		t.Fatalf("case-insensitive duplicate: %v", err)
	}
	if _, err := e.svc.AddPreset(ctx, "  ", "", []byte(`{}`)); !errors.Is(err, runs.ErrInvalid) {
		t.Fatalf("blank name: %v", err)
	}
	if list, _ := e.svc.Presets(ctx); len(list) != 1 {
		t.Fatalf("%d presets", len(list))
	}
	if _, err := e.svc.DB.Exec(`INSERT INTO presets(name, settings_json, built_in, created_at) VALUES ('Builtin','{}',1,1)`); err != nil {
		t.Fatal(err)
	}
	list, _ := e.svc.Presets(ctx)
	if !list[0].BuiltIn {
		t.Fatal("built-ins should come first")
	}
	if err := e.svc.DeletePreset(ctx, list[0].ID); !errors.Is(err, runs.ErrConflict) {
		t.Fatalf("built-in delete: %v", err)
	}
	if err := e.svc.DeletePreset(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeletePreset(ctx, p.ID); !errors.Is(err, runs.ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}

	if s, _ := e.svc.Settings(ctx); string(s) != `{}` {
		t.Fatalf("default settings %s", s)
	}
	if err := e.svc.PutSettings(ctx, []byte(`{"speed":5}`)); err != nil {
		t.Fatal(err)
	}
	if s, _ := e.svc.Settings(ctx); string(s) != `{"speed":5}` {
		t.Fatalf("settings %s", s)
	}

	sh, err := e.svc.AddShape(ctx, "", []byte(`[[0,0],[1,0],[1,1]]`), nil)
	if err != nil || sh.Name != "Untitled shape" || string(sh.More) != "[]" {
		t.Fatalf("%+v %v", sh, err)
	}
	if shapes, _ := e.svc.Shapes(ctx); len(shapes) != 1 {
		t.Fatal("shape not listed")
	}
	if err := e.svc.DeleteShape(ctx, sh.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.DeleteShape(ctx, sh.ID); !errors.Is(err, runs.ErrNotFound) {
		t.Fatalf("second shape delete: %v", err)
	}
}

func TestCleanName(t *testing.T) {
	for in, want := range map[string]string{
		"": "", "  a   b": "a b", "a\nb": "a b", "zero" + string(rune(0x200b)) + "width": "zero width", "ok": "ok",
		strings.Repeat("x", 80): strings.Repeat("x", 60),
	} {
		if got := runs.CleanName(in); got != want {
			t.Errorf("CleanName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestConcurrentTrashAndList(t *testing.T) {
	e := newEnv(t)
	var ids []int64
	for i := 0; i < 20; i++ {
		ids = append(ids, e.create(t, spec{orig: 1, res: 100 + i, thumb: 200 + i, seed: int64(i)}).ID)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for _, id := range ids {
			if _, err := e.svc.Trash(context.Background(), []int64{id}, false); err != nil {
				t.Error(err)
			}
		}
	}()
	for i := 0; i < 20; i++ {
		if _, err := e.svc.List(context.Background(), runs.ListQuery{Trashed: "any"}); err != nil {
			t.Fatal(err)
		}
	}
	<-done
}

// A saved run may carry one animation (GIF or APNG image, or an MP4/WebM video). It is stored as kind 'video' and
// comes back on Get; a later save of the same look attaches an animation the first run did not have.
func TestCreateWithVideoAndDuplicateAttach(t *testing.T) {
	e := newEnv(t)
	ob, os := img(nil, 1)
	rb, rs := img(nil, 2)
	tb, ts := img(nil, 3)
	gifBytes := []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;")
	gs := sha256.Sum256(gifBytes)
	gh := hex.EncodeToString(gs[:])
	base := runs.Meta{
		Settings: []byte(`{"mode":"random"}`), Seed: 4, EngineVersion: "1",
		Original: runs.ImageMeta{SHA256: os, W: 4, H: 4},
		Result:   runs.ImageMeta{SHA256: rs, W: 4, H: 4},
		Thumb:    runs.ImageMeta{SHA256: ts, W: 4, H: 4},
	}
	parts := func(video bool) runs.Parts {
		p := runs.Parts{Original: bytes.NewReader(ob), Result: bytes.NewReader(rb), Thumb: bytes.NewReader(tb)}
		if video {
			p.Video = bytes.NewReader(gifBytes)
		}
		return p
	}

	first, created, err := e.svc.Create(context.Background(), base, parts(false))
	if err != nil || !created {
		t.Fatalf("first create: created %v err %v", created, err)
	}
	if first.Video != nil {
		t.Fatal("a run without a video has one")
	}

	withVideo := base
	withVideo.Video = &runs.ImageMeta{SHA256: gh, W: 1, H: 1}
	second, created, err := e.svc.Create(context.Background(), withVideo, parts(true))
	if err != nil {
		t.Fatalf("second create: %v", err)
	}
	if created {
		t.Fatal("the same look was stored twice instead of attaching the animation")
	}
	if second.ID != first.ID {
		t.Fatalf("second create made run %d, want the existing %d", second.ID, first.ID)
	}
	if second.Video == nil {
		t.Fatal("the animation was not attached to the existing run")
	}
	if second.Video.SHA256 != gh || second.Video.Mime != "image/gif" {
		t.Fatalf("video = %+v, want the GIF", second.Video)
	}
	got, err := e.svc.Get(context.Background(), first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Video == nil || got.Video.SHA256 != gh {
		t.Fatalf("Get lost the video: %+v", got.Video)
	}
}
