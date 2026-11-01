# pgmem

A real PostgreSQL server that runs entirely inside your Go test process,
keeps everything in memory, and speaks the normal wire protocol on a loopback
port. No Docker, no external binaries, no files on disk. Works wherever Go
and wazero run (macOS, Linux, Windows; amd64 and arm64).

```go
func TestSomething(t *testing.T) {
    s, err := pgmem.Start(context.Background(), pgmem.Options{Database: "app"})
    if err != nil {
        t.Fatal(err)
    }
    defer s.Close()

    db, _ := sql.Open("pgx", s.DSN()) // any driver works, pools included
    // ...
}
```

### Per-test forks

Load the schema and seed data once, snapshot, and give every test its own
copy. A fork is a full backend on a copy of the data directory, so tests
can run in parallel; `MaxForks` bounds how many exist at once (by default a
quarter of the available memory divided by a fork's cost, 28 on a 7 GB CI
runner) and `Fork` blocks when the cap is reached.

```go
var fx *pgmemtest.Fixture

func TestMain(m *testing.M) {
    os.Exit(pgmemtest.Run(m, pgmemtest.Options{
        Prepare: func(ctx context.Context, db *sql.DB, dsn string) error {
            _, err := db.ExecContext(ctx, schema) // migrations, seed data
            return err
        },
    }, func(f *pgmemtest.Fixture) { fx = f }))
}

func TestOrders(t *testing.T) {
    t.Parallel()
    testDB := fx.For(t) // one fresh copy, closed when t ends
    db := testDB.DB() // testDB.DSN() and testDB.PgxPool() use the same copy
    // fx.PgxConn(t), fx.PgxPool(t), fx.DSN(t) and fx.Fork(t) also exist
}
```

The same primitives are available without the test helpers:
`s.Snapshot(ctx, opts)` checkpoints and copies the server's state, and
`snap.Fork(ctx)` starts a new server from it. Snapshotting takes about
10 ms and a fork about 20 ms.

A fork can also be put back in place: `srv.Reset(ctx)` returns it to its
snapshot while it keeps its port and its client connections, so a pool or
a connection string captured once (an ORM client built at import time,
say) stays valid from test to test. Pooled connections continue in a fresh
session; pgmem re-creates their named prepared statements and LISTEN
registrations. `srv.Restore(ctx, snap)` does the same with any snapshot of
the same database, and a reset with nothing to undo returns at once.

Connecting over loopback TCP works with every driver. For pgx you can
skip the kernel entirely with the in-process dialer, which makes small
queries about three times faster:

```go
cfg, _ := pgx.ParseConfig(s.DSN())
cfg.DialFunc = s.Dial // net.Pipe, no TCP
conn, _ := pgx.ConnectConfig(ctx, cfg)
// database/sql: stdlib.RegisterConnConfig(cfg) then sql.Open("pgx", name)
```

The module is pure Go: PostgreSQL was compiled to WebAssembly once and
translated to Go ahead of time, so there is no wasm runtime, no cgo and
nothing to download at run time.

| first `Start` in a process | ~0.1 s |
|---|---|
| further servers in the process | ~0.1 s |
| simple indexed `SELECT` via pgx over TCP | ~27 µs |
| same, in-process via `Server.Dial` | ~8.5 µs |
| sort + count over 200k generated rows | ~95 ms |
| what ships | 115 MB generated Go (~35 s to compile once), 1.4 MB of AOT data |
| minimal program, `-ldflags="-s -w"` | 36.7 MB |

Reference measurements and their conditions are in
[docs/benchmarks.md](docs/benchmarks.md).

Every server has its own filesystem and its own database state.

## Go with an external process

Use `github.com/shibukawa/pgmem/pgmemprocess` to own a `pgmem` subprocess and
connect over TCP or Unix domain sockets. This package and `pgmemfixture` do not
import the embedded PostgreSQL engine. `pgmemprocess.Run` prepares one snapshot,
and `fx.For(t)` returns the same test database object used by embedded helpers.
