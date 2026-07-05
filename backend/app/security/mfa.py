"""TOTP verification helper (SR-11) — reused by login MFA and sensitive-action
step-ups (e.g. account closure, FR-05). Decrypts the AES-256-GCM seed and checks
the code with a +/-1 step window for clock skew.
"""

from __future__ import annotations

import hmac
import time
from typing import Any, Optional

import pyotp

from .crypto import aes_decrypt


def verify_totp(totp_seed_encrypted: Optional[bytes], code: str, key: bytes) -> bool:
    """Return True if ``code`` is valid for the user's encrypted TOTP seed.

    Returns False if no seed is enrolled. ``key`` is the 32-byte AES key. Stateless
    (no replay protection) — used for one-time step-ups; login uses
    :func:`verify_totp_and_consume`.
    """
    if not totp_seed_encrypted:
        return False
    seed = aes_decrypt(totp_seed_encrypted, key).decode("utf-8")
    return pyotp.TOTP(seed).verify(code, valid_window=1)


def verify_totp_and_consume(user: Any, code: str, key: bytes) -> bool:
    """Verify a TOTP ``code`` (±1 step for skew) with **single-use replay protection**.

    A code's 30-second time-step is accepted only if it is newer than the last step
    this user consumed (``user.last_totp_timestep``); on success that step is recorded
    on ``user`` so the same code cannot be replayed within its validity window (SR-11).
    The caller must commit the session for the consumed step to persist. Returns False
    if no seed is enrolled or the code is absent/stale/reused.
    """
    if not getattr(user, "totp_seed_encrypted", None) or not code:
        return False
    seed = aes_decrypt(user.totp_seed_encrypted, key).decode("utf-8")
    totp = pyotp.TOTP(seed)
    now = time.time()
    current_step = int(now // totp.interval)
    last = user.last_totp_timestep if user.last_totp_timestep is not None else -1
    for offset in (-1, 0, 1):
        step = current_step + offset
        if step <= last:
            continue  # step already consumed (or older than the last one used)
        if hmac.compare_digest(totp.at(now, counter_offset=offset), str(code)):
            user.last_totp_timestep = step
            return True
    return False
