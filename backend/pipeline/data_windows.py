"""
Central place for transaction time windows.

- Non-seasonality steps: last ``NON_SEASONALITY_MONTHS`` distinct ``YEAR_MONTH`` values
  within calendar year ``NON_SEASONALITY_YEAR`` (e.g. Jul–Dec 2025 when data runs through Dec 2025).
- Seasonality (09_seasonality.py): last ``SEASONALITY_HISTORY_YEARS`` of INV_DATE — configured in step 9.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import NON_SEASONALITY_MONTHS, NON_SEASONALITY_YEAR


def filter_last_n_months_in_year(
    df: pd.DataFrame,
    *,
    year: int | None = None,
    n_months: int | None = None,
    ym_col: str = "YEAR_MONTH",
) -> pd.DataFrame:
    """
    Keep rows whose YEAR_MONTH is among the last ``n_months`` distinct months in ``year``.

    If no rows exist for that year, falls back to the last ``n_months`` calendar months
    from max INV_DATE (rolling window).
    """
    year = NON_SEASONALITY_YEAR if year is None else year
    n_months = NON_SEASONALITY_MONTHS if n_months is None else n_months

    if df.empty or ym_col not in df.columns:
        return df.iloc[0:0].copy()

    ym = df[ym_col].astype(str).str.strip()
    prefix = f"{year}-"
    sub = df.loc[ym.str.startswith(prefix)].copy()

    if sub.empty:
        print(
            f"WARNING: No rows with {ym_col} in year {year}; "
            f"using rolling last {n_months} months from max date."
        )
        if "INV_DATE" not in df.columns:
            return df.iloc[0:0].copy()
        inv = pd.to_datetime(df["INV_DATE"], errors="coerce")
        end = inv.max()
        if pd.isna(end):
            return df.iloc[0:0].copy()
        start = end - pd.DateOffset(months=n_months)
        return df.loc[inv >= start].copy()

    months = sorted(sub[ym_col].astype(str).unique())
    if len(months) > n_months:
        months = months[-n_months:]
    out = sub.loc[sub[ym_col].astype(str).isin(months)].copy()
    print(
        f"Non-seasonality window: year={year}, months={len(months)} "
        f"({months[0]} .. {months[-1]}), rows={len(out)}"
    )
    return out


def non_seasonality_label() -> str:
    return (
        f"Last {NON_SEASONALITY_MONTHS} months in {NON_SEASONALITY_YEAR} "
        f"(non-seasonality pipeline steps)"
    )
