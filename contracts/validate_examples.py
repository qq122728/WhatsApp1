from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker


ROOT = Path(__file__).resolve().parent
SCHEMA_PATH = ROOT / "v1" / "multiconnect.v1.schema.json"
EXAMPLES_ROOT = ROOT / "v1" / "examples"


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def semantic_errors(message: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if message.get("type") == "command.request":
        timestamp = parse_timestamp(message["timestamp"])
        expires_at = parse_timestamp(message["payload"]["expiresAt"])
        if expires_at <= timestamp:
            errors.append("command expiresAt must be later than envelope timestamp")
    return errors


def main() -> int:
    schema = load_json(SCHEMA_PATH)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    failures: list[str] = []

    for path in sorted((EXAMPLES_ROOT / "valid").glob("*.json")):
        message = load_json(path)
        schema_errors = list(validator.iter_errors(message))
        semantics = semantic_errors(message)
        if schema_errors or semantics:
            details = [error.message for error in schema_errors] + semantics
            failures.append(f"{path.relative_to(ROOT)} should be valid: {details}")

    for path in sorted((EXAMPLES_ROOT / "invalid" / "schema").glob("*.json")):
        message = load_json(path)
        if not list(validator.iter_errors(message)):
            failures.append(
                f"{path.relative_to(ROOT)} should fail JSON Schema validation"
            )

    for path in sorted((EXAMPLES_ROOT / "invalid" / "semantic").glob("*.json")):
        message = load_json(path)
        schema_errors = list(validator.iter_errors(message))
        semantics = semantic_errors(message)
        if schema_errors:
            failures.append(
                f"{path.relative_to(ROOT)} should be schema-valid before semantic checks"
            )
        if not semantics:
            failures.append(
                f"{path.relative_to(ROOT)} should fail semantic validation"
            )

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1

    print("Validated v1 schema plus valid, schema-invalid, and semantic-invalid examples.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
