"""Domain models used by Comuro."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
import hashlib
import json
from typing import Any, Literal

ConstructionStatus = Literal["aktuell", "geplant"]


@dataclass(slots=True, frozen=True)
class Route:
    """A user-defined route."""

    id: str
    name: str
    coordinates: list[list[float]]
    buffer_m: int = 30
    enabled: bool = True


@dataclass(slots=True, frozen=True)
class ConstructionSite:
    """Normalized construction-site representation."""

    construction_id: str
    status: ConstructionStatus
    name: str
    geometry: dict[str, Any]
    start: date | None = None
    end: date | None = None
    restriction: str | None = None
    raw_data: dict[str, Any] = field(default_factory=dict)

    @property
    def fingerprint(self) -> str:
        """Return a stable fingerprint for change detection."""
        payload = {
            "name": self.name,
            "status": self.status,
            "start": self.start.isoformat() if self.start else None,
            "end": self.end.isoformat() if self.end else None,
            "restriction": self.restriction,
            "geometry": self.geometry,
        }
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()


@dataclass(slots=True, frozen=True)
class RouteMatch:
    """A construction site matching a configured route."""

    route_id: str
    construction_id: str
    status: ConstructionStatus
    route_position_m: float
    distance_m: float
    geometry: dict[str, Any]
    construction: ConstructionSite

    @property
    def match_id(self) -> str:
        return f"{self.route_id}:{self.construction_id}"


@dataclass(slots=True, frozen=True)
class ConstructionEvent:
    """A change detected between construction snapshots."""

    event_type: str
    construction_id: str
    occurred_at: datetime
    current: ConstructionSite | None = None
    previous: ConstructionSite | None = None
