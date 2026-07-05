"""Unit tests for the security primitives (: crypto/unit).

Argon2 verify round-trips, AES-256-GCM round-trip + tamper detection, NRIC
masking, and allowlist validators (accept valid, reject malformed/oversized).
No DB or network required.
"""

from __future__ import annotations

import os

import pytest
from cryptography.exceptions import InvalidTag

from app.config import Config
from app.security import crypto, masking
from app.security.validation import (
    ValidationError,
    validate_account_number,
    validate_amount_cents,
    validate_email,
    validate_full_name,
    validate_nric,
    validate_password,
    validate_transaction_pin,
)


# --------------------------------------------------------------------------- #
# Argon2 password / PIN (SR-01, SR-12)
# --------------------------------------------------------------------------- #

def test_password_hash_verify_round_trip():
    h = crypto.hash_password("Sup3rSecret!Pass")
    assert h != "Sup3rSecret!Pass"  # never plaintext
    assert crypto.verify_password(h, "Sup3rSecret!Pass") is True
    assert crypto.verify_password(h, "wrong") is False


def test_password_hashes_are_salted_unique():
    assert crypto.hash_password("samepass12!A") != crypto.hash_password("samepass12!A")


def test_pin_hash_verify_round_trip():
    h = crypto.hash_pin("123456")
    assert crypto.verify_pin(h, "123456") is True
    assert crypto.verify_pin(h, "000000") is False


def test_pin_and_password_use_distinct_params():
    # SR-12: PIN params must differ from password params.
    assert Config.ARGON2_PIN_MEMORY_KIB != Config.ARGON2_PASSWORD_MEMORY_KIB
    # A PIN hash carries the PIN's memory cost in its encoded parameters.
    assert f"m={Config.ARGON2_PIN_MEMORY_KIB}" in crypto.hash_pin("654321")
    assert f"m={Config.ARGON2_PASSWORD_MEMORY_KIB}" in crypto.hash_password("Abcdefgh1!xx")


def test_verify_rejects_malformed_hash():
    assert crypto.verify_password("not-a-hash", "whatever") is False


# --------------------------------------------------------------------------- #
# AES-256-GCM (SR-03)
# --------------------------------------------------------------------------- #

def test_aes_round_trip():
    key = os.urandom(32)
    blob = crypto.aes_encrypt("S1234567D", key)
    assert blob[:12] != blob[12:]  # nonce prepended
    assert crypto.aes_decrypt(blob, key) == b"S1234567D"


def test_aes_unique_nonce_per_encryption():
    key = os.urandom(32)
    assert crypto.aes_encrypt("same", key) != crypto.aes_encrypt("same", key)


def test_aes_tamper_detected():
    key = os.urandom(32)
    blob = bytearray(crypto.aes_encrypt("secret", key))
    blob[-1] ^= 0x01  # flip a tag bit
    with pytest.raises(InvalidTag):
        crypto.aes_decrypt(bytes(blob), key)


def test_aes_wrong_key_fails():
    blob = crypto.aes_encrypt("secret", os.urandom(32))
    with pytest.raises(InvalidTag):
        crypto.aes_decrypt(blob, os.urandom(32))


def test_aes_rejects_non_256_key():
    with pytest.raises(ValueError):
        crypto.aes_encrypt("x", os.urandom(16))


# --------------------------------------------------------------------------- #
# NRIC blind index (SR-03, FR-01 one-account-per-NRIC)
# --------------------------------------------------------------------------- #

def test_nric_blind_index_is_deterministic():
    key = os.urandom(32)
    assert crypto.nric_blind_index("S1234567D", key) == crypto.nric_blind_index("S1234567D", key)


def test_nric_blind_index_differs_by_nric_and_key():
    key = os.urandom(32)
    # Different NRIC -> different index.
    assert crypto.nric_blind_index("S1234567D", key) != crypto.nric_blind_index("S7654321A", key)
    # Same NRIC, different key -> different index (it is keyed, not a bare hash).
    assert crypto.nric_blind_index("S1234567D", key) != crypto.nric_blind_index(
        "S1234567D", os.urandom(32))


def test_nric_blind_index_shape_and_key_length():
    idx = crypto.nric_blind_index("S1234567D", os.urandom(32))
    assert isinstance(idx, bytes) and len(idx) == 32  # HMAC-SHA256 digest
    with pytest.raises(ValueError):
        crypto.nric_blind_index("S1234567D", os.urandom(16))


# --------------------------------------------------------------------------- #
# NRIC masking (SR-03)
# --------------------------------------------------------------------------- #

def test_mask_nric():
    assert masking.mask_nric("T1234518H") == "T****518H"
    assert masking.mask_nric("s7654321a") == "S****321A"


def test_mask_nric_bad_length():
    with pytest.raises(ValueError):
        masking.mask_nric("T123H")


# --------------------------------------------------------------------------- #
# Allowlist validators (SR-06)
# --------------------------------------------------------------------------- #

def test_validate_email_normalises():
    assert validate_email("User@Example.COM") == "user@example.com"


@pytest.mark.parametrize("bad", ["", "no-at", "a@b", "x" * 250 + "@e.com"])
def test_validate_email_rejects(bad):
    with pytest.raises(ValidationError):
        validate_email(bad)


def test_validate_password_accepts_strong():
    assert validate_password("Abcdefgh1!xx") == "Abcdefgh1!xx"


@pytest.mark.parametrize(
    "bad",
    ["short1!A", "alllowercase1!", "ALLUPPERCASE1!", "NoDigitsHere!!", "NoSymbol12345"],
)
def test_validate_password_rejects(bad):
    with pytest.raises(ValidationError):
        validate_password(bad)


def test_validate_nric():
    assert validate_nric("s1234567d") == "S1234567D"
    for bad in ["", "A1234567D", "S123456D", "S12345678"]:
        with pytest.raises(ValidationError):
            validate_nric(bad)


def test_validate_full_name():
    assert validate_full_name("  Tan Ah Kow  ") == "Tan Ah Kow"
    for bad in ["", "x" * 121, "Robert; DROP TABLE"]:
        with pytest.raises(ValidationError):
            validate_full_name(bad)


def test_validate_account_number():
    assert validate_account_number("0123456789") == "0123456789"
    for bad in ["123", "12345678901", "12345abcde"]:
        with pytest.raises(ValidationError):
            validate_account_number(bad)


def test_validate_transaction_pin():
    assert validate_transaction_pin("123456") == "123456"
    for bad in ["12345", "1234567", "12a456"]:
        with pytest.raises(ValidationError):
            validate_transaction_pin(bad)


def test_validate_amount_cents():
    assert validate_amount_cents(100000) == 100000
    for bad in [0, -5, True, 1.5, "100", Config.MAX_TRANSFER_CENTS + 1]:
        with pytest.raises(ValidationError):
            validate_amount_cents(bad)
