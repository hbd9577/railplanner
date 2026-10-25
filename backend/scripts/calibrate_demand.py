"""Fit the demand model to FY2024 Amtrak station ridership and write data/demand_calibration.json.

Run from backend/:
    python -m scripts.calibrate_demand
"""
from __future__ import annotations

import json

from app.config import DATA_DIR
from app.service import calibrate


def main() -> None:
    result = calibrate()
    out = DATA_DIR / "demand_calibration.json"
    out.write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(f"scale={result['scale']:.4g}  time_ratio_exponent={result['time_ratio_exponent']}  "
          f"rms_log_error={result['rms_log_error']}  pairs={result['pairs_used']}")
    for s in result["stations"]:
        print(f"  {s['name']:<12} observed {s['observed']:>9,}  modeled {s['modeled']:>9,}  ratio {s['ratio']}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
