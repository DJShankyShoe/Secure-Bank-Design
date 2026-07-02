"""TOTP verification helper (SR-11) — reused by login MFA and sensitive-action
step-ups (e.g. account closure, FR-05). Decrypts the AES-256-GCM seed and checks
the code with a +/-1 step window for clock skew.
"""

from __future__ import annotations

from typing import Optional

import pyotp

from .crypto import aes_decrypt


def verify_totp(totp_seed_encrypted: Optional[bytes], code: str, key: bytes) -> bool:
    """Return True if ``code`` is valid for the user's encrypted TOTP seed.

    Returns False if no seed is enrolled. ``key`` is the 32-byte AES key.
    """
    if not totp_seed_encrypted:
        return False
    seed = aes_decrypt(totp_seed_encrypted, key).decode("utf-8")
    return pyotp.TOTP(seed).verify(code, valid_window=1)
