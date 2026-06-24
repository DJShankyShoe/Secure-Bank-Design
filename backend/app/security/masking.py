"""NRIC masking (SR-03).

NRIC is shown masked everywhere — UI, logs, audit ``action_detail`` — e.g.
``T1234518H`` → ``T****518H``. Full NRIC is only ever revealed via an
authenticated, audited admin endpoint. Masking keeps the leading prefix letter
and the trailing 3 digits + checksum letter, masking the middle.
"""

from __future__ import annotations

_VISIBLE_TAIL = 4  # last 4 chars kept (e.g. "518H")


def mask_nric(nric: str) -> str:
    """Return the masked form of a 9-character NRIC (e.g. ``T****518H``).

    The first character and the last four are preserved; the middle is replaced
    with ``*``. Input is upper-cased; length must be 9.
    """
    value = nric.strip().upper()
    if len(value) != 9:
        raise ValueError("NRIC must be 9 characters to mask.")
    stars = "*" * (len(value) - 1 - _VISIBLE_TAIL)
    return f"{value[0]}{stars}{value[-_VISIBLE_TAIL:]}"
