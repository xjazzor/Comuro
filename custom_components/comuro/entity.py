"""Common entity helpers for Comuro."""

from __future__ import annotations

from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import ComuroCoordinator, RouteState


class ComuroRouteEntity(
    CoordinatorEntity[ComuroCoordinator]
):
    """Base class for entities belonging to one route."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: ComuroCoordinator,
        route_id: str,
    ) -> None:
        super().__init__(coordinator)

        self.route_id = route_id

        self._attr_device_info = {
            "identifiers": {
                (DOMAIN, route_id),
            },
            "name": self._route_name(),
            "manufacturer": "Comuro",
            "model": "Route",
        }

    def route_state(self) -> RouteState | None:
        """Return the current state for this route."""
        return self.coordinator.data.get(
            self.route_id
        )

    @property
    def available(self) -> bool:
        """Return whether the configured route is currently available."""
        return self.route_state() is not None

    def _route_name(self) -> str:
        state = self.coordinator.data.get(
            self.route_id
        )
        if state:
            return state.route.name

        return self.route_id

    def match_attributes(self) -> list[dict]:
        """Return compact route match data for HA state attributes."""
        state = self.route_state()

        if state is None:
            return []

        return [
            {
                "construction_id": match.construction_id,
                "status": match.status,
                "name": match.construction.name,
                "route_position_m": match.route_position_m,
                "distance_m": match.distance_m,
                "start": (
                    match.construction.start.isoformat()
                    if match.construction.start
                    else None
                ),
                "end": (
                    match.construction.end.isoformat()
                    if match.construction.end
                    else None
                ),
            }
            for match in state.matches
        ]
