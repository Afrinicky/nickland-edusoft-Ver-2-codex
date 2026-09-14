"""The subscription and billing engine.

One package, read in this order:

    repo.py           where the rows live — memory and Postgres, one vocabulary
    defaults.py       what a fresh platform opens on: three plans, the features
    settings.py       the platform's own rules, as rows
    plans.py          plans, features, and the grid that joins them
    usage.py          how many pupils a school is billed for
    engine.py         the calculation: gross → discount → exemption → tax → total
    adjustments.py    discounts and exemptions, kept apart on purpose
    subscriptions.py  the lifecycle, and what a failed payment does over time
    invoices.py       the record, and the run that raises it
    provider.py       Nickland taking money from a school (not a school from a parent)
    entitlements.py   what a school may do today — the question the app asks
    audit.py          writing down what happened

The one thing to know before changing anything here: **no module in this
package, and no module outside it, may branch on a plan by name.** There is no
`if plan == "pro"`. Plans are rows, features are rows, and the grid between
them is rows, which is what lets the Superadmin reprice the product or move a
module between plans without a deployment (§6, §14, §16).
"""
from .repo import repo_for                          # noqa: F401


def bootstrap(store):
    """Make sure a store has a platform to be. Idempotent; called at boot.

    Returns what it created, or None when the billing tables are not reachable
    — which is not fatal. The service still starts, entitlements fail open, and
    the boot report says so.
    """
    from . import defaults
    try:
        repo = repo_for(store)
        return defaults.seed(repo)
    except Exception as exc:
        print(f"[edusoft] the billing tables could not be prepared: {exc}", flush=True)
        return None
