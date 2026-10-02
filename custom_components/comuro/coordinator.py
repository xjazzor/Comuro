"""Data update coordinator for Comuro."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import (
    DataUpdateCoordinator,
    UpdateFailed,
)

from .const import (
    DOMAIN,
    MISSING_CYCLES_BEFORE_RESOLVED,
    ROUTES_FILE,
    TRACKER_STORE_KEY,
    TRACKER_STORE_VERSION,
    UPDATE_INTERVAL,
)
from .dortmund import DortmundProvider
from .geo import match_route
from .models import ConstructionEvent, Route, RouteMatch
from .tracker import ConstructionTracker

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RouteState:
    """Current evaluation of one configured route."""

    route: Route
    matches: tuple[RouteMatch, ...]
    updated_at: datetime

    @property
    def current_matches(self) -> tuple[RouteMatch, ...]:
        return tuple(
            match
            for match in self.matches
            if match.status == "aktuell"
        )

    @property
    def planned_matches(self) -> tuple[RouteMatch, ...]:
        return tuple(
            match
            for match in self.matches
            if match.status == "geplant"
        )

    @property
    def affected(self) -> bool:
        return bool(self.current_matches)


class ComuroCoordinator(DataUpdateCoordinator[dict[str, RouteState]]):
    """Coordinate Dortmund data, tracking and route matching."""

    def __init__(
        self,
        hass: HomeAssistant,
        *,
        provider: DortmundProvider | None = None,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=UPDATE_INTERVAL,
        )

        from homeassistant.helpers.storage import Store

        self.provider = provider or DortmundProvider()
        self.tracker_store = Store(
            hass,
            TRACKER_STORE_VERSION,
            TRACKER_STORE_KEY,
        )
        self.tracker = ConstructionTracker(
            missing_cycles_before_resolved=(
                MISSING_CYCLES_BEFORE_RESOLVED
            )
        )
        self.events: list[ConstructionEvent] = []

    async def _async_setup(self) -> None:
        """Load persistent lifecycle state before the first refresh."""
        stored = await self.tracker_store.async_load()

        if stored:
            self.tracker = ConstructionTracker.from_dict(
                stored
            )

    async def _async_update_data(
        self,
    ) -> dict[str, RouteState]:
        """Fetch one snapshot and evaluate all routes."""
        try:
            sites = await self.hass.async_add_executor_job(
                self.provider.fetch_snapshot
            )

            self.events = self.tracker.process_snapshot(
                sites
            )

            # Tracker state must survive HA restarts.
            await self.tracker_store.async_save(
                self.tracker.to_dict()
            )

            routes = await self.hass.async_add_executor_job(
                self._load_routes_file
            )

            if not routes:
                return {}

            evaluated = await self.hass.async_add_executor_job(
                self._match_routes,
                routes,
                sites,
            )

            return evaluated

        except Exception as err:
            raise UpdateFailed(
                f"Comuro update failed: {err}"
            ) from err

    def _load_routes_file(self) -> list[Route]:
        """Load routes produced by the route-editor app."""
        if not ROUTES_FILE.exists():
            return []

        try:
            payload = json.loads(
                ROUTES_FILE.read_text(
                    encoding="utf-8"
                )
            )
        except (OSError, json.JSONDecodeError) as err:
            raise RuntimeError(
                f"Cannot read {ROUTES_FILE}: {err}"
            ) from err

        # Current format:
        # {"version": 1, "routes": [...]}
        if isinstance(payload, dict):
            raw_routes = payload.get(
                "routes",
                [],
            )
        elif isinstance(payload, list):
            # Temporary compatibility with the PoC's routes.json format.
            raw_routes = payload
        else:
            raise RuntimeError(
                "Invalid routes file format"
            )

        routes: list[Route] = []
        seen_ids: set[str] = set()

        for item in raw_routes:
            if not isinstance(item, dict):
                continue

            route_id = str(
                item.get("id", "")
            ).strip()

            name = str(
                item.get("name", "")
            ).strip()

            coordinates = item.get(
                "coordinates"
            )

            if (
                not route_id
                or not name
                or not isinstance(
                    coordinates,
                    list,
                )
                or len(coordinates) < 2
            ):
                _LOGGER.warning(
                    "Ignoring invalid route entry: %s",
                    item,
                )
                continue

            if route_id in seen_ids:
                _LOGGER.warning(
                    "Ignoring duplicate route ID: %s",
                    route_id,
                )
                continue

            seen_ids.add(route_id)

            buffer_m = int(
                item.get(
                    "buffer_m",
                    30,
                )
            )

            if buffer_m < 0:
                buffer_m = 0

            routes.append(
                Route(
                    id=route_id,
                    name=name,
                    coordinates=coordinates,
                    buffer_m=buffer_m,
                    enabled=bool(
                        item.get(
                            "enabled",
                            True,
                        )
                    ),
                )
            )

        return [
            route
            for route in routes
            if route.enabled
        ]

    @staticmethod
    def _match_routes(
        routes: list[Route],
        sites: list,
    ) -> dict[str, RouteState]:
        """Evaluate all routes in the worker thread."""
        updated_at = datetime.now().astimezone()

        return {
            route.id: RouteState(
                route=route,
                matches=tuple(
                    match_route(
                        route,
                        sites,
                    )
                ),
                updated_at=updated_at,
            )
            for route in routes
        }
