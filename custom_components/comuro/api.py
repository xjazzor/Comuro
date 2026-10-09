"""HTTP API for the native Comuro route panel."""

from __future__ import annotations

from http import HTTPStatus
from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView, KEY_HASS
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .runtime import ComuroRuntimeData

MAX_BUFFER_METERS = 500


def _validate_payload(payload: Any) -> tuple[
    str, list[list[float]], int, bool
] | None:
    """Validate and normalize a route payload."""
    if not isinstance(payload, dict):
        return None

    name = payload.get("name")
    coordinates = payload.get("coordinates")
    buffer_m = payload.get("buffer_m", 30)
    enabled = payload.get("enabled", True)

    if not isinstance(name, str):
        return None
    name = name.strip()
    if not 1 <= len(name) <= 100:
        return None

    if (
        not isinstance(coordinates, list)
        or len(coordinates) < 2
    ):
        return None

    normalized_coordinates: list[list[float]] = []
    for point in coordinates:
        if (
            not isinstance(point, list)
            or len(point) != 2
            or not all(
                isinstance(value, (int, float)) and not isinstance(value, bool)
                for value in point
            )
        ):
            return None
        normalized_coordinates.append(
            [float(point[0]), float(point[1])]
        )

    if (
        not isinstance(buffer_m, int)
        or isinstance(buffer_m, bool)
        or not 0 <= buffer_m <= MAX_BUFFER_METERS
    ):
        return None

    if not isinstance(enabled, bool):
        return None

    return name, normalized_coordinates, buffer_m, enabled


class ComuroRouteCollectionView(HomeAssistantView):
    """Expose the Comuro route collection."""

    url = "/api/comuro/routes"
    name = "api:comuro:routes"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        """Return all routes."""
        hass: HomeAssistant = request.app[KEY_HASS]
        runtime = _get_runtime(hass)
        if runtime is None:
            return self.json_message(
                "Comuro is not configured.",
                HTTPStatus.NOT_FOUND,
            )

        return self.json(runtime.route_store.get_all())

    async def post(self, request: web.Request) -> web.Response:
        """Create a route."""
        hass: HomeAssistant = request.app[KEY_HASS]
        runtime = _get_runtime(hass)
        if runtime is None:
            return self.json_message(
                "Comuro is not configured.",
                HTTPStatus.NOT_FOUND,
            )

        if not request["hass_user"].is_admin:
            return self.json_message(
                "Administrator access required.",
                HTTPStatus.FORBIDDEN,
            )

        try:
            payload = await request.json()
        except ValueError:
            return self.json_message(
                "Invalid JSON.",
                HTTPStatus.BAD_REQUEST,
            )

        validated = _validate_payload(payload)
        if validated is None:
            return self.json_message(
                "Invalid route data.",
                HTTPStatus.BAD_REQUEST,
            )

        route = await runtime.route_store.async_create(*validated)
        await runtime.coordinator.async_reload_routes()
        return self.json(route)


class ComuroRouteResourceView(HomeAssistantView):
    """Expose one Comuro route."""

    url = "/api/comuro/routes/{route_id}"
    name = "api:comuro:route"
    requires_auth = True

    async def put(
        self,
        request: web.Request,
        route_id: str,
    ) -> web.Response:
        """Update a route."""
        hass: HomeAssistant = request.app[KEY_HASS]
        runtime = _get_runtime(hass)
        if runtime is None:
            return self.json_message(
                "Comuro is not configured.",
                HTTPStatus.NOT_FOUND,
            )

        if not request["hass_user"].is_admin:
            return self.json_message(
                "Administrator access required.",
                HTTPStatus.FORBIDDEN,
            )

        try:
            payload = await request.json()
        except ValueError:
            return self.json_message(
                "Invalid JSON.",
                HTTPStatus.BAD_REQUEST,
            )

        validated = _validate_payload(payload)
        if validated is None:
            return self.json_message(
                "Invalid route data.",
                HTTPStatus.BAD_REQUEST,
            )

        route = await runtime.route_store.async_update(
            route_id,
            *validated,
        )
        if route is None:
            return self.json_message(
                "Route not found.",
                HTTPStatus.NOT_FOUND,
            )

        await runtime.coordinator.async_reload_routes()
        return self.json(route)

    async def delete(
        self,
        request: web.Request,
        route_id: str,
    ) -> web.Response:
        """Delete a route."""
        hass: HomeAssistant = request.app[KEY_HASS]
        runtime = _get_runtime(hass)
        if runtime is None:
            return self.json_message(
                "Comuro is not configured.",
                HTTPStatus.NOT_FOUND,
            )

        if not request["hass_user"].is_admin:
            return self.json_message(
                "Administrator access required.",
                HTTPStatus.FORBIDDEN,
            )

        deleted = await runtime.route_store.async_delete(route_id)
        if not deleted:
            return self.json_message(
                "Route not found.",
                HTTPStatus.NOT_FOUND,
            )

        await runtime.coordinator.async_reload_routes()
        return self.json({"success": True})


def _get_runtime(
    hass: HomeAssistant,
) -> ComuroRuntimeData | None:
    """Return the loaded Comuro runtime."""
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    if not entries:
        return None

    runtime = getattr(entries[0], "runtime_data", None)
    if not isinstance(runtime, ComuroRuntimeData):
        return None

    return runtime


async def async_setup_views(hass: HomeAssistant) -> None:
    """Register Comuro HTTP views."""
    hass.http.register_view(ComuroRouteCollectionView())
    hass.http.register_view(ComuroRouteResourceView())
