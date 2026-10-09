"""Dortmund Open Data provider."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any

import requests
from requests.adapters import HTTPAdapter
import urllib3

from .models import ConstructionSite


CURRENT_URL = (
    "https://open-data.dortmund.de/api/explore/v2.1/catalog/"
    "datasets/fb66-baustellen-tagesaktuell-flachen/records"
)
PLANNED_URL = (
    "https://open-data.dortmund.de/api/explore/v2.1/catalog/"
    "datasets/fb66-baustellen-geplant-flachen/records"
)


def _create_session() -> requests.Session:
    """Create an HTTP session with conservative transient-error retries."""
    retry = urllib3.util.Retry(
        total=3,
        connect=3,
        read=3,
        status=3,
        backoff_factor=1,
        backoff_max=30,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)

    session = requests.Session()
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class DortmundProvider:
    """Fetch and normalize Dortmund roadworks."""

    def __init__(
        self,
        session: requests.Session | None = None,
        page_size: int = 100,
        timeout: float = 30.0,
    ) -> None:
        self.session = session or _create_session()
        self.page_size = page_size
        self.timeout = timeout

    def fetch_dataset(
        self,
        status: str,
        url: str,
    ) -> list[ConstructionSite]:
        sites: list[ConstructionSite] = []
        offset = 0

        while True:
            response = self.session.get(
                url,
                params={
                    "limit": self.page_size,
                    "offset": offset,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()

            records = response.json().get("results", [])

            for record in records:
                site = self._normalize_record(record, status)
                if site is not None:
                    sites.append(site)

            if len(records) < self.page_size:
                break

            offset += self.page_size

        return sites

    def fetch_snapshot(self) -> list[ConstructionSite]:
        """Fetch planned and current data.

        Current status wins if a stable construction ID exists in both
        datasets, because the current representation is the operational one.
        """
        planned = self.fetch_dataset("geplant", PLANNED_URL)
        current = self.fetch_dataset("aktuell", CURRENT_URL)

        merged: dict[str, ConstructionSite] = {
            site.construction_id: site
            for site in planned
        }

        for site in current:
            merged[site.construction_id] = site

        return list(merged.values())

    @staticmethod
    def _normalize_record(
        record: dict[str, Any],
        status: str,
    ) -> ConstructionSite | None:
        geometry = DortmundProvider._extract_geometry(record)
        if geometry is None:
            return None

        name = DortmundProvider._display_name(record)

        source_id = (
            record.get("id")
            or record.get("objectid")
            or record.get("ident")
        )

        if source_id is None:
            # The polygon datasets currently do not reliably expose a
            # dedicated stable ID. Build a fallback from stable descriptive
            # fields, deliberately excluding geometry.
            fallback = {
                "name": name,
                "art_der_baumassnahme": record.get(
                    "art_der_baumassnahme"
                ),
                "auftraggeber": record.get("auftraggeber"),
                "strasse": (
                    record.get("strasse")
                    or record.get("straße")
                ),
                "stadtbezirk": record.get("stadtbezirk"),
                # Keep the fallback identity independent of dates so
                # extensions remain the same construction.
                "location": DortmundProvider._location_key(record),
            }

            source_id = hashlib.sha256(
                json.dumps(
                    fallback,
                    ensure_ascii=False,
                    sort_keys=True,
                    default=str,
                ).encode("utf-8")
            ).hexdigest()[:20]

        return ConstructionSite(
            construction_id=f"dortmund:{source_id}",
            status=status,  # type: ignore[arg-type]
            name=name,
            geometry=geometry,
            start=DortmundProvider._parse_date(
                record.get("von")
            ),
            end=DortmundProvider._parse_date(
                record.get("bis")
            ),
            restriction=(
                record.get("einschrankung")
                or record.get("einschränkung")
                or None
            ),
            raw_data={
                key: value
                for key, value in record.items()
                if key != "geo_shape"
            },
        )

    @staticmethod
    def _extract_geometry(
        record: dict[str, Any],
    ) -> dict[str, Any] | None:
        geo = record.get("geo_shape")

        if not isinstance(geo, dict):
            return None

        geometry = geo.get("geometry")
        if isinstance(geometry, dict):
            return geometry

        if geo.get("type") in {"Polygon", "MultiPolygon"}:
            return geo

        return None

    @staticmethod
    def _location_key(record: dict[str, Any]) -> Any:
        """Return a stable, rounded location key when available."""
        point = record.get("geo_point_2d")
        if not isinstance(point, dict):
            return None

        lon = point.get("lon")
        lat = point.get("lat")

        if lon is None or lat is None:
            return None

        try:
            return (
                round(float(lon), 5),
                round(float(lat), 5),
            )
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _display_name(
        record: dict[str, Any],
    ) -> str:
        for key in (
            "strasse",
            "straße",
            "adresse",
            "art_der_baumassnahme",
        ):
            value = record.get(key)
            if value:
                return str(value)

        return "Baustelle"

    @staticmethod
    def _parse_date(
        value: Any,
    ) -> date | None:
        if not value:
            return None

        try:
            return date.fromisoformat(str(value))
        except ValueError:
            return None
