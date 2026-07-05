"""Cryptographic primitives (SR-01/03/11/12).

* Passwords  — Argon2id, 64 MB / t=3 / p=1 (SR-01).
* Transaction PIN — Argon2id with **distinct** params, 32 MB / t=2 / p=1 (SR-12).
* NRIC + TOTP seed — AES-256-GCM with a 32-byte env key (SR-03/11). Never Fernet.

Hashes are one-way (verification only); AES values are decrypted only in the app
layer when needed. Plaintext secrets are never logged or returned. The two
Argon2 hashers MUST differ — enforced indirectly by the config params and tested.
"""

from __future__ import annotations

import hashlib
import hmac
import os

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..config import Config

# 96-bit nonce is the AES-GCM standard; a fresh one per encryption.
NONCE_BYTES = 12

# Password hasher — SR-01 params.
_password_hasher = PasswordHasher(
    time_cost=Config.ARGON2_PASSWORD_TIME_COST,
    memory_cost=Config.ARGON2_PASSWORD_MEMORY_KIB,
    parallelism=Config.ARGON2_PASSWORD_PARALLELISM,
)

# Transaction-PIN hasher — SR-12 params, deliberately distinct from the password.
_pin_hasher = PasswordHasher(
    time_cost=Config.ARGON2_PIN_TIME_COST,
    memory_cost=Config.ARGON2_PIN_MEMORY_KIB,
    parallelism=Config.ARGON2_PIN_PARALLELISM,
)


def hash_password(password: str) -> str:
    """Return an Argon2id hash of ``password`` (SR-01). Salt is per-call/unique."""
    return _password_hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    """Constant-time verify of ``password`` against ``stored_hash`` (SR-01).

    Returns ``False`` on mismatch or malformed hash; never raises for a bad
    password, so callers get a uniform boolean (anti-enumeration, SR-09).
    """
    try:
        return _password_hasher.verify(stored_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def password_needs_rehash(stored_hash: str) -> bool:
    """True if ``stored_hash`` was made with weaker params and should be upgraded."""
    return _password_hasher.check_needs_rehash(stored_hash)


def hash_pin(pin: str) -> str:
    """Return an Argon2id hash of a transaction ``pin`` using the PIN params (SR-12)."""
    return _pin_hasher.hash(pin)


def verify_pin(stored_hash: str, pin: str) -> bool:
    """Constant-time verify of a transaction ``pin`` (SR-12). ``False`` on mismatch."""
    try:
        return _pin_hasher.verify(stored_hash, pin)
    except (VerifyMismatchError, InvalidHashError):
        return False


def hash_backup_code(code: str) -> str:
    """Return an Argon2id hash of a one-time MFA backup code (SR-11)."""
    return _password_hasher.hash(code)


def verify_backup_code(stored_hash: str, code: str) -> bool:
    """Constant-time verify of an MFA backup code (SR-11). ``False`` on mismatch."""
    try:
        return _password_hasher.verify(stored_hash, code)
    except (VerifyMismatchError, InvalidHashError):
        return False


# Domain-separation label so the blind-index subkey can never collide with any
# other use of the AES key material.
_NRIC_INDEX_LABEL = b"securebank|nric-blind-index|v1"


def nric_blind_index(nric: str, key: bytes) -> bytes:
    """Return a deterministic keyed blind index of an NRIC (SR-03, SR-06/FR-01).

    NRIC is stored AES-256-GCM encrypted with a random nonce, so its ciphertext is
    non-deterministic and cannot be uniqueness-checked directly. This HMAC-SHA256
    index is deterministic (32 raw bytes), letting us enforce one-account-per-NRIC
    (a UNIQUE column) and look a user up by NRIC without a full-table decrypt —
    while never exposing the plaintext (the index is one-way and keyed). The subkey
    is derived from the AES key with a domain-separation label, so it is independent
    of the encryption use of that key. ``nric`` must already be normalised
    (upper-cased by ``validate_nric``).
    """
    if len(key) != 32:
        raise ValueError("AES key must be 32 bytes (AES-256).")
    subkey = hashlib.sha256(_NRIC_INDEX_LABEL + key).digest()
    return hmac.new(subkey, nric.encode("utf-8"), hashlib.sha256).digest()


def aes_encrypt(plaintext: bytes | str, key: bytes) -> bytes:
    """AES-256-GCM encrypt ``plaintext`` (SR-03). Returns ``nonce || ciphertext||tag``.

    ``key`` must be 32 bytes (AES-256). A fresh 12-byte nonce is generated per call
    and prepended to the output; the GCM auth tag is appended by the cipher.
    """
    if len(key) != 32:
        raise ValueError("AES key must be 32 bytes (AES-256).")
    if isinstance(plaintext, str):
        plaintext = plaintext.encode("utf-8")
    nonce = os.urandom(NONCE_BYTES)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, None)
    return nonce + ciphertext


def aes_decrypt(blob: bytes, key: bytes) -> bytes:
    """AES-256-GCM decrypt a ``nonce || ciphertext||tag`` blob (SR-03).

    Raises ``InvalidTag`` if the data was tampered with or the key is wrong.
    """
    if len(key) != 32:
        raise ValueError("AES key must be 32 bytes (AES-256).")
    if len(blob) <= NONCE_BYTES:
        raise InvalidTag("ciphertext too short")
    nonce, ciphertext = blob[:NONCE_BYTES], blob[NONCE_BYTES:]
    return AESGCM(key).decrypt(nonce, ciphertext, None)
