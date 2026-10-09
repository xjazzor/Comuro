"""Data update coordinator for Comuro."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import (
    DataUpdateCoordinator,
    UpdateFailed,
)

from .const import (
    DOMAIN,
    MISSING_CYCLES_BEFORE_RESOLVED,
    TRACKER_STORE_KEY,
    TRACKER_STORE_VERSION,
    UPDATE_INTERVAL,
)
from .dortmund import DortmundProvider
from .geo import match_route
from .models import ConstructionEvent, ConstructionSite, Route, RouteMatch
from .route_store import RouteStore
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
        """Return currently active construction matches."""
        return tuple(
            match
            for match in self.matches
            if match.status == "aktuell"
        )

    @property
    def planned_matches(self) -> tuple[RouteMatch, ...]:
        """Return planned construction matches."""
        return tuple(
            match
            for match in self.matches
            if match.status == "geplant"
        )

    @property
    def affected(self) -> bool:
        """Return whether current roadworks affect the route."""
        return bool(self.current_matches)


class ComuroCoordinator(
    DataUpdateCoordinator[dict[str, RouteState]]
):
    """Coordinate Dortmund data, tracking and route matching."""

    def __init__(
        self,
        hass: HomeAssistant,
        route_store: RouteStore,
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
        self.route_store = route_store

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
        self._sites: list[ConstructionSite] = []

    async def _async_setup(self) -> None:
        """Load persistent lifecycle state before first refresh."""
        stored = await self.tracker_store.async_load()

        if stored:
            self.tracker = ConstructionTracker.from_dict(stored)

    async def async_reload_routes(self) -> None:
        """Re-evaluate routes against the cached construction snapshot."""
        routes = await self.hass.async_add_executor_job(
            self.route_store.get_routes
        )
        evaluated = await self.hass.async_add_executor_job(
            self._match_routes,
            routes,
            self._sites,
        )
        self.async_set_updated_data(evaluated)

    async def _async_update_data(
        self,
    ) -> dict[str, RouteState]:
        """Fetch the hourly snapshot and evaluate all routes."""
        try:
            sites = await self.hass.async_add_executor_job(
                self.provider.fetch_snapshot
            )

            self._sites = sites

            self.events = self.tracker.process_snapshot(
                sites
            )

            await self.tracker_store.async_save(
                self.tracker.to_dict()
            )

            routes = await self.hass.async_add_executor_job(
                self.route_store.get_routes
            )

            return await self.hass.async_add_executor_job(
                self._match_routes,
                routes,
                sites,
            )

        except Exception as err:
            raise UpdateFailed(
                f"Comuro update failed: {err}"
            ) from err

    @staticmethod
    def _match_routes(
        routes: list[Route],
        sites: list[ConstructionSite],
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
