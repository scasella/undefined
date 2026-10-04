"""Verify only publisher metadata. Never fetch model weight payloads."""

import json
from datetime import datetime, timezone
from pathlib import Path
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen

from rev.config import DEFAULT_PINS, load_pins


def main() -> int:
    config = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PINS
    pins = load_pins(config)
    directory = (config.parent / pins["model_metadata_dir"]).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    for name, model in pins["models"].items():
        if name == "headline_winner":
            continue
        url = f"https://huggingface.co/api/models/{quote(model['repo'], safe='/')}/revision/{model['revision']}"
        with urlopen(Request(url, headers={"User-Agent": "rev-pin-check/0.1"}), timeout=30) as response:
            payload = json.load(response)
        if payload.get("id") != model["repo"] or payload.get("sha") != model["revision"]:
            raise ValueError(f"Publisher revision mismatch: {name}")
        evidence = {key: payload.get(key) for key in ("id", "sha", "gated", "pipeline_tag", "library_name")}
        evidence["source_url"] = url
        evidence["verified_on"] = pins["verified_on"]
        evidence["retrieved_at_utc"] = datetime.now(timezone.utc).isoformat()
        (directory / f"{name}.json").write_text(json.dumps(evidence, indent=2) + "\n")
        print(f"Verified {model['repo']}@{model['revision']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
