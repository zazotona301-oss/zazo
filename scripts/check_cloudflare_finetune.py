#!/usr/bin/env python3
"""Check the active LoRA pointer in Cloudflare KV and its Workers AI fine-tune."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


READY_STATES = {
    "active",
    "completed",
    "complete",
    "ready",
    "succeeded",
    "success",
    "uploaded",
}
FAILED_STATES = {"failed", "error", "cancelled", "canceled"}


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def request_json(url: str, token: str) -> tuple[int, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "zazo-cloudflare-finetune-check/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {"raw": body}
        return error.code, payload


def get_active_pointer(
    account_id: str, kv_token: str, namespace_id: str, key: str
) -> tuple[bool, Any]:
    encoded_key = urllib.parse.quote(key, safe="")
    url = (
        "https://api.cloudflare.com/client/v4/accounts/"
        f"{urllib.parse.quote(account_id, safe='')}/storage/kv/namespaces/"
        f"{urllib.parse.quote(namespace_id, safe='')}/values/{encoded_key}"
    )
    status, payload = request_json(url, kv_token)
    if status == 404:
        return False, None
    if status != 200:
        raise RuntimeError(f"Cloudflare KV read failed (HTTP {status}): {payload}")
    if isinstance(payload, dict):
        return True, payload
    if isinstance(payload, str):
        return True, json.loads(payload)
    raise RuntimeError(f"Unexpected KV payload: {payload!r}")


def flatten_items(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        result: list[dict[str, Any]] = []
        for item in value:
            result.extend(flatten_items(item))
        return result
    return []


def find_finetune(items: list[dict[str, Any]], pointer: dict[str, Any]) -> dict[str, Any] | None:
    pointer_id = str(pointer.get("id", ""))
    pointer_name = str(pointer.get("name", ""))
    for item in items:
        if pointer_id and str(item.get("id", "")) == pointer_id:
            return item
    for item in items:
        if pointer_name and str(item.get("name", "")) == pointer_name:
            return item
    return None


def state_of(finetune: dict[str, Any] | None) -> str:
    if not finetune:
        return "not_found"
    for key in ("status", "state", "phase"):
        value = finetune.get(key)
        if value is not None:
            return str(value).strip().lower()
    return "unknown"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check active-lora in Cloudflare KV and its Workers AI fine-tune."
    )
    parser.add_argument(
        "--json", action="store_true", dest="as_json", help="Print machine-readable JSON."
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Return non-zero unless the active pointer exists and the fine-tune is ready.",
    )
    args = parser.parse_args()

    try:
        account_id = require_env("CF_ACCOUNT_ID")
        ai_token = require_env("CF_AI_TOKEN")
        kv_token = require_env("CF_KV_TOKEN")
        namespace_id = require_env("CF_ACTIVE_CONTEXT_KV_NAMESPACE_ID")
        active_key = os.environ.get("CF_ACTIVE_KV_KEY", "active-lora")

        pointer_exists, pointer = get_active_pointer(
            account_id, kv_token, namespace_id, active_key
        )
        result: dict[str, Any] = {
            "active_key": active_key,
            "active_pointer_exists": pointer_exists,
            "active_pointer": pointer,
            "finetune": None,
            "status": "no_active_pointer" if not pointer_exists else "unknown",
            "is_active": pointer_exists,
            "is_ready": False,
        }

        if pointer_exists:
            list_url = (
                "https://api.cloudflare.com/client/v4/accounts/"
                f"{urllib.parse.quote(account_id, safe='')}/ai/finetunes"
            )
            http_status, response = request_json(list_url, ai_token)
            if http_status < 200 or http_status >= 300:
                raise RuntimeError(
                    f"Cloudflare Workers AI fine-tune list failed "
                    f"(HTTP {http_status}): {response}"
                )
            items = flatten_items(response.get("result", [])) if isinstance(response, dict) else []
            finetune = find_finetune(items, pointer)
            state = state_of(finetune)
            result["finetune"] = finetune
            result["status"] = state
            result["is_ready"] = state in READY_STATES
            if state in FAILED_STATES:
                result["is_active"] = False

        if args.as_json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"Active KV key: {active_key}")
            print(f"Active pointer exists: {'yes' if pointer_exists else 'no'}")
            if pointer:
                print(f"Fine-tune ID: {pointer.get('id', '<missing>')}")
                print(f"Fine-tune name: {pointer.get('name', '<missing>')}")
                print(f"Source: {pointer.get('sourceRepo', '<missing>')}@{pointer.get('sourceRevision', '<missing>')}")
            print(f"Fine-tune status: {result['status']}")
            print(f"Active: {'yes' if result['is_active'] else 'no'}")
            print(f"Ready: {'yes' if result['is_ready'] else 'no'}")
            if result["finetune"] is None and pointer_exists:
                print("Warning: active-lora points to a fine-tune that was not found in the Cloudflare list.")

        if args.strict and not (result["is_active"] and result["is_ready"]):
            return 2
        return 0
    except (RuntimeError, json.JSONDecodeError, urllib.error.URLError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
