"""Genera data/evoluciones.json a partir de PokeAPI (Gen 1-3).

Uso:
    python tools/generar_evoluciones.py

El archivo resultante mapea el dexId de una especie a una lista de evoluciones:
    { "255": [{ "to": 256, "level": 16, "method": "level-up" }], ... }
"""
from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

BASE = "https://pokeapi.co/api/v2"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "evoluciones.json"
MAX_DEX = 386


def get_json(url: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pokepoke-evolution-builder/1.0"})
            with urllib.request.urlopen(req, timeout=25) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


def dex_id_from_url(url: str) -> int:
    return int(url.rstrip("/").split("/")[-1])


def walk_chain(node: dict, out: dict[int, list[dict]]) -> None:
    current = dex_id_from_url(node["species"]["url"])
    for child in node.get("evolves_to", []):
        target = dex_id_from_url(child["species"]["url"])
        for detail in child.get("evolution_details") or []:
            trigger = ((detail.get("trigger") or {}).get("name")) or "unknown"
            entry = {
                "to": target,
                "method": trigger,
                "level": detail.get("min_level"),
                "item": ((detail.get("item") or {}).get("name")),
                "held_item": ((detail.get("held_item") or {}).get("name")),
                "time_of_day": detail.get("time_of_day") or None,
                "min_happiness": detail.get("min_happiness"),
            }
            entry = {k: v for k, v in entry.items() if v not in (None, "", [])}
            if entry not in out.setdefault(current, []):
                out[current].append(entry)
        walk_chain(child, out)


def main() -> None:
    chains: dict[str, str] = {}
    for dex in range(1, MAX_DEX + 1):
        species = get_json(f"{BASE}/pokemon-species/{dex}")
        url = (species.get("evolution_chain") or {}).get("url")
        if url:
            chains[url] = species["name"]
        if dex % 50 == 0:
            print(f"especies: {dex}/{MAX_DEX}")

    evolutions: dict[int, list[dict]] = {}
    for index, url in enumerate(sorted(chains), start=1):
        chain = get_json(url)
        walk_chain(chain["chain"], evolutions)
        if index % 25 == 0:
            print(f"cadenas: {index}/{len(chains)}")
        time.sleep(0.05)

    # Solo conservamos evoluciones cuyo destino esté dentro de Gen 1-3.
    cleaned: dict[str, list[dict]] = {}
    for source, entries in sorted(evolutions.items()):
        valid = [e for e in entries if 1 <= e["to"] <= MAX_DEX]
        if valid:
            cleaned[str(source)] = valid

    OUT.write_text(json.dumps(cleaned, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK -> {OUT} ({len(cleaned)} especies con evolución)")


if __name__ == "__main__":
    main()
