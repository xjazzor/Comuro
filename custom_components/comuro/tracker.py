"""Persistent construction lifecycle tracking."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, UTC
from typing import Any

from .models import ConstructionEvent, ConstructionSite

NEW = "NEW"
UPDATED = "UPDATED"
EXTENDED = "EXTENDED"
STATUS_CHANGED = "STATUS_CHANGED"
RESOLVED = "RESOLVED"
REAPPEARED = "REAPPEARED"


@dataclass(slots=True)
class TrackedConstruction:
    site: ConstructionSite
    first_seen: datetime
    last_seen: datetime
    missing_cycles: int = 0
    resolved: bool = False


class ConstructionTracker:
    """Track constructions across snapshots."""

    def __init__(
        self,
        missing_cycles_before_resolved: int = 2,
    ) -> None:
        if missing_cycles_before_resolved < 1:
            raise ValueError(
                "missing_cycles_before_resolved must be >= 1"
            )

        self.missing_cycles_before_resolved = (
            missing_cycles_before_resolved
        )
        self._tracked: dict[
            str,
            TrackedConstruction,
        ] = {}

    @property
    def tracked(self) -> dict[str, TrackedConstruction]:
        return self._tracked

    def process_snapshot(
        self,
        sites: Iterable[ConstructionSite],
        observed_at: datetime | None = None,
    ) -> list[ConstructionEvent]:
        """Process one complete provider snapshot."""
        now = observed_at or datetime.now(UTC)

        current = {
            site.construction_id: site
            for site in sites
        }

        events: list[ConstructionEvent] = []

        for construction_id, site in current.items():
            previous = self._tracked.get(
                construction_id
            )

            if previous is None:
                self._tracked[construction_id] = (
                    TrackedConstruction(
                        site=site,
                        first_seen=now,
                        last_seen=now,
                    )
                )

                events.append(
                    ConstructionEvent(
                        event_type=NEW,
                        construction_id=construction_id,
                        occurred_at=now,
                        current=site,
                    )
                )

                continue

            old_site = previous.site

            if previous.resolved:
                events.append(
                    ConstructionEvent(
                        event_type=REAPPEARED,
                        construction_id=construction_id,
                        occurred_at=now,
                        current=site,
                        previous=old_site,
                    )
                )

            if (
                old_site.end is not None
                and site.end is not None
                and site.end > old_site.end
            ):
                events.append(
                    ConstructionEvent(
                        event_type=EXTENDED,
                        construction_id=construction_id,
                        occurred_at=now,
                        current=site,
                        previous=old_site,
                    )
                )

            if old_site.status != site.status:
                events.append(
                    ConstructionEvent(
                        event_type=STATUS_CHANGED,
                        construction_id=construction_id,
                        occurred_at=now,
                        current=site,
                        previous=old_site,
                    )
                )

            if (
                old_site.fingerprint != site.fingerprint
                and old_site.status == site.status
                and not (
                    old_site.end is not None
                    and site.end is not None
                    and site.end > old_site.end
                )
            ):
                events.append(
                    ConstructionEvent(
                        event_type=UPDATED,
                        construction_id=construction_id,
                        occurred_at=now,
                        current=site,
                        previous=old_site,
                    )
                )

            previous.site = site
            previous.last_seen = now
            previous.missing_cycles = 0
            previous.resolved = False

        for construction_id, previous in self._tracked.items():
            if construction_id in current:
                continue

            if previous.resolved:
                continue

            previous.missing_cycles += 1

            if (
                previous.missing_cycles
                >= self.missing_cycles_before_resolved
            ):
                previous.resolved = True

                events.append(
                    ConstructionEvent(
                        event_type=RESOLVED,
                        construction_id=construction_id,
                        occurred_at=now,
                        previous=previous.site,
                    )
                )

        return events

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-serializable persistent state."""
        return {
            "missing_cycles_before_resolved": (
                self.missing_cycles_before_resolved
            ),
            "tracked": {
                construction_id: {
                    "site": _site_to_dict(state.site),
                    "first_seen": state.first_seen.isoformat(),
                    "last_seen": state.last_seen.isoformat(),
                    "missing_cycles": state.missing_cycles,
                    "resolved": state.resolved,
                }
                for construction_id, state
                in self._tracked.items()
            },
        }

    @classmethod
    def from_dict(
        cls,
        data: dict[str, Any],
    ) -> ConstructionTracker:
        tracker = cls(
            missing_cycles_before_resolved=int(
                data.get(
                    "missing_cycles_before_resolved",
                    2,
                )
            )
        )

        for construction_id, item in data.get(
            "tracked",
            {},
        ).items():
            tracker._tracked[construction_id] = (
                TrackedConstruction(
                    site=_site_from_dict(
                        item["site"]
                    ),
                    first_seen=datetime.fromisoformat(
                        item["first_seen"]
                    ),
                    last_seen=datetime.fromisoformat(
                        item["last_seen"]
                    ),
                    missing_cycles=int(
                        item.get(
                            "missing_cycles",
                            0,
                        )
                    ),
                    resolved=bool(
                        item.get(
                            "resolved",
                            False,
                        )
                    ),
                )
            )

        return tracker


def _site_to_dict(
    site: ConstructionSite,
) -> dict[str, Any]:
    return {
        "construction_id": site.construction_id,
        "status": site.status,
        "name": site.name,
        "geometry": site.geometry,
        "start": (
            site.start.isoformat()
            if site.start
            else None
        ),
        "end": (
            site.end.isoformat()
            if site.end
            else None
        ),
        "restriction": site.restriction,
        "raw_data": site.raw_data,
    }


def _site_from_dict(
    data: dict[str, Any],
) -> ConstructionSite:
    def parse(value: Any) -> date | None:
        return (
            date.fromisoformat(value)
            if value
            else None
        )

    return ConstructionSite(
        construction_id=data[
            "construction_id"
        ],
        status=data["status"],
        name=data["name"],
        geometry=data["geometry"],
        start=parse(data.get("start")),
        end=parse(data.get("end")),
        restriction=data.get(
            "restriction"
        ),
        raw_data=data.get(
            "raw_data",
            {},
        ),
    )
