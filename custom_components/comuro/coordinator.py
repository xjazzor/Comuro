"""Data update coordinator for Comuro."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime

from homeassistant.config_entries import ConfigEntry
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
    UPDATE_RETRY_INTERVAL,
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
        config_entry: ConfigEntry | None = None,
        provider: DortmundProvider | None = None,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            config_entry=config_entry,
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

    async def async_initialize(self) -> None:
        """Load persistent lifecycle state before the first refresh."""
        stored = await self.tracker_store.async_load()

        if not stored:
            return

        if not isinstance(stored, dict):
            _LOGGER.warning(
                "Ignoring invalid Comuro tracker storage"
            )
            return

        try:
            self.tracker = ConstructionTracker.from_dict(stored)
        except (KeyError, TypeError, ValueError) as err:
            _LOGGER.warning(
                "Ignoring invalid Comuro tracker storage: %s",
                err,
            )

    async def async_reload_routes(self) -> None:
        """Re-evaluate routes against the cached construction snapshot."""
        routes = await self.hass.async_add_executor_job(
            self.route_store.get_routes
        )

        # A route change should also recover Comuro if there is no valid
        # provider snapshot yet. This is particularly useful immediately
        # after startup when the first Dortmund request is still failing.
        if self.data is None or not self.last_update_success:
            await self.async_refresh()
            return

        evaluated = await self.hass.async_add_executor_job(
            self._match_routes,
            routes,
            self._sites,
        )
        self.async_set_updated_data(evaluated)

    async def _async_update_data(
        self,
    ) -> dict[str, RouteState]:
        """Fetch the latest snapshot and evaluate all routes."""
        try:
            sites = await self.hass.async_add_executor_job(
                self.provider.fetch_snapshot
            )

            routes = await self.hass.async_add_executor_job(
                self.route_store.get_routes
            )

            evaluated = await self.hass.async_add_executor_job(
                self._match_routes,
                routes,
                sites,
            )

            self.events = self.tracker.process_snapshot(
                sites
            )

            try:
                await self.tracker_store.async_save(
                    self.tracker.to_dict()
                )
            except Exception as err:  # noqa: BLE001
                # Lifecycle persistence is useful but must not make the
                # current route state unavailable when the tracker storage
                # has a transient write problem.
                _LOGGER.warning(
                    "Could not persist Comuro tracker state: %s",
                    err,
                )

            # Only replace the cached provider snapshot after the complete
            # fetch and route evaluation succeeded.
            self._sites = sites

            return evaluated

        except Exception as err:
            raise UpdateFailed(
                f"Comuro update failed: {err}",
                retry_after=UPDATE_RETRY_INTERVAL.total_seconds(),
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
