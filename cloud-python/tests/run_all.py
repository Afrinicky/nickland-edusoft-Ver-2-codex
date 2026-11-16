#!/usr/bin/env python3
"""Run every cloud suite, not just the ones before the first failure.

`npm run test:online` was a chain of `&&`, with the same consequence the Node
chain had: one failing suite stopped the run and the rest reported nothing.
Worse here, because six of the twelve need a real Postgres in DATABASE_URL and
without one they fail at import — so a CI job with no database ran six suites,
stopped at the seventh, and said "failed" about a service that was fine.

    python3 tests/run_all.py                 every suite
    python3 tests/run_all.py --only test_attack
    EDUSOFT_REQUIRE_PG=1 python3 tests/run_all.py   a missing database is an error

Exit code is the worst result. A suite that needs a database it was not given
is reported as skipped, by name, rather than counted as a pass — which is the
part that was hiding `test_attack`, the security suite.
"""
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Suites that cannot run without DATABASE_URL. Named rather than discovered,
# so a suite that quietly grows a database dependency is noticed here.
NEEDS_DB = {
    "test_saas", "test_school", "test_payments",
    "test_licensing", "test_attack", "test_dashboards",
    # The enrolment rehearsal provisions real schemas and signs in to them.
    "test_enrolment",
}

TALLY = re.compile(r"(\d+) passed, (\d+) failed")


def suites():
    found = sorted(p.stem for p in HERE.glob("test_*.py"))
    return found


def main():
    argv = sys.argv[1:]
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    names = [s for s in suites() if not only or s == only]
    if not names:
        print(f'No suite called "{only}".' if only else "No suites found.")
        return 2

    have_db = bool(os.environ.get("DATABASE_URL"))
    require_db = os.environ.get("EDUSOFT_REQUIRE_PG") == "1"

    results = []
    for name in names:
        if name in NEEDS_DB and not have_db:
            mark = "✗" if require_db else "•"
            print(f"{mark} {name:<22} {'FAILING — no DATABASE_URL' if require_db else 'skipped — needs DATABASE_URL'}")
            results.append({"name": name, "ok": not require_db, "skipped": True, "passed": 0})
            continue

        started = time.time()
        run = subprocess.run([sys.executable, str(HERE / f"{name}.py")],
                             cwd=HERE.parent, capture_output=True, text=True)
        out = (run.stdout or "") + (run.stderr or "")
        found = TALLY.findall(out)
        passed, failed = (int(found[-1][0]), int(found[-1][1])) if found else (0, None)

        # psycopg_pool prints "couldn't stop thread" on teardown and can take
        # the exit code with it. The tally is what the suite itself reported,
        # so when there is one it decides — a suite that says "0 failed" has
        # not failed because its connection pool was slow to close.
        ok = (failed == 0) if found else (run.returncode == 0)
        results.append({"name": name, "ok": ok, "skipped": False,
                        "passed": passed, "out": out, "ms": int((time.time() - started) * 1000)})
        print(f"{'✓' if ok else '✗'} {name:<22} "
              f"{f'{passed} passed, {failed} failed' if found else f'exit {run.returncode}'}")
        if not ok:
            for line in [l for l in out.split("\n") if l.startswith("✗")][:15]:
                print(f"    {line}")
            if not any(l.startswith("✗") for l in out.split("\n")):
                print("    " + "\n    ".join(out.strip().split("\n")[-3:]))

    bad = [r for r in results if not r["ok"]]
    skipped = [r for r in results if r["skipped"] and r["ok"]]
    total = sum(r["passed"] for r in results)

    print()
    print(f"{len(results)} suites, {total} assertions passed, {len(bad)} suites failed")
    if skipped:
        print(f"{len(skipped)} skipped for want of a database: {', '.join(r['name'] for r in skipped)}")
        print("  (set DATABASE_URL to run them; EDUSOFT_REQUIRE_PG=1 makes skipping an error)")
    if bad:
        print(f"failed: {', '.join(r['name'] for r in bad)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
