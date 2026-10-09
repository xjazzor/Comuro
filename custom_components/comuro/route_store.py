"""Persistent storage and CRUD operations for Comuro routes."""

from __future__ import annotations

import json
from asyncio import Lock
from copy import deepcopy
from pathlib import Path
from typing import Any
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .models import Route

STORE_VERSION = 1
STORE_KEY = f"{DOMAIN}.routes"
LEGACY_ROUTES_FILE = Path("/share/comuro/routes.json")


class RouteStore:
    """Persist and manage Comuro route definitions."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store = Store[dict[str, Any]](
            hass,
            STORE_VERSION,
            STORE_KEY,
        )
        self._routes: list[dict[str, Any]] = []
        self._lock = Lock()

    async def async_load(self) -> None:
        """Load routes from Home Assistant storage, migrating the legacy file once."""
        stored = await self._store.async_load()

        if stored is None:
            routes = await self._async_load_legacy_file()
            self._routes = routes
            if routes:
                await self._async_save_locked()
            return

        raw_routes = stored.get("routes", [])
        if not isinstance(raw_routes, list):
            self._routes = []
            return

        self._routes = [
            deepcopy(route)
            for route in raw_routes
            if isinstance(route, dict)
        ]

    def get_routes(self) -> list[Route]:
        """Return valid enabled routes for the coordinator."""
        routes: list[Route] = []

        for raw in self._routes:
            route = self._route_from_dict(raw)
            if route is not None and route.enabled:
                routes.append(route)

        return routes

    def get_all(self) -> list[dict[str, Any]]:
        """Return all routes including disabled routes."""
        return deepcopy(self._routes)

    async def async_create(
        self,
        name: str,
        coordinates: list[list[float]],
        buffer_m: int,
        enabled: bool,
    ) -> dict[str, Any]:
        """Create and persist a route."""
        route = {
            "id": str(uuid4()),
            "name": name.strip(),
            "coordinates": coordinates,
            "buffer_m": buffer_m,
            "enabled": enabled,
        }

        async with self._lock:
            self._routes.append(route)
            await self._async_save_locked()

        return deepcopy(route)

    async def async_update(
        self,
        route_id: str,
        name: str,
        coordinates: list[list[float]],
        buffer_m: int,
        enabled: bool,
    ) -> dict[str, Any] | None:
        """Update and persist an existing route."""
        route = {
            "id": route_id,
            "name": name.strip(),
            "coordinates": coordinates,
            "buffer_m": buffer_m,
            "enabled": enabled,
        }

        async with self._lock:
            for index, existing in enumerate(self._routes):
                if existing.get("id") != route_id:
                    continue

                self._routes[index] = route
                await self._async_save_locked()
                return deepcopy(route)

        return None

    async def async_delete(self, route_id: str) -> bool:
        """Delete and persist an existing route."""
        async with self._lock:
            original_routes = deepcopy(self._routes)
            self._routes = [
                route
                for route in self._routes
                if route.get("id") != route_id
            ]

            if len(self._routes) == len(original_routes):
                return False

            await self._async_save_locked()

            # Home Assistant's Store handles write errors internally. Reload
            # the just-saved data so a failed disk write cannot silently look
            # like a successful route deletion while the entity state is
            # already being removed from the coordinator.
            stored = await self._store.async_load()
            if not isinstance(stored, dict):
                self._routes = original_routes
                raise RuntimeError(
                    "Comuro route deletion could not be persisted."
                )

            persisted_routes = stored.get("routes", [])
            if not isinstance(persisted_routes, list) or any(
                isinstance(route, dict) and route.get("id") == route_id
                for route in persisted_routes
            ):
                self._routes = [
                    deepcopy(route)
                    for route in persisted_routes
                    if isinstance(route, dict)
                ]
                raise RuntimeError(
                    "Comuro route deletion could not be persisted."
                )

            return True

    @staticmethod
    def _route_from_dict(raw: dict[str, Any]) -> Route | None:
        """Convert a stored route into the domain model."""
        route_id = str(raw.get("id", "")).strip()
        name = str(raw.get("name", "")).strip()
        coordinates = raw.get("coordinates")

        if (
            not route_id
            or not name
            or not isinstance(coordinates, list)
            or len(coordinates) < 2
        ):
            return None

        try:
            buffer_m = max(int(raw.get("buffer_m", 30)), 0)
        except (TypeError, ValueError):
            return None

        if any(
            not isinstance(point, list)
            or len(point) != 2
            or not all(isinstance(value, (int, float)) for value in point)
            for point in coordinates
        ):
            return None

        return Route(
            id=route_id,
            name=name,
            coordinates=coordinates,
            buffer_m=buffer_m,
            enabled=bool(raw.get("enabled", True)),
        )

    async def _async_save_locked(self) -> None:
        await self._store.async_save(
            {
                "version": STORE_VERSION,
                "routes": self._routes,
            }
        )

    async def _async_load_legacy_file(self) -> list[dict[str, Any]]:
        """Read the old /share/comuro/routes.json format for migration."""
        if not LEGACY_ROUTES_FILE.exists():
            return []

        try:
            payload = await self._hass.async_add_executor_job(
                self._read_legacy_file
            )
        except (OSError, json.JSONDecodeError):
            return []

        if isinstance(payload, dict):
            raw_routes = payload.get("routes", [])
        elif isinstance(payload, list):
            raw_routes = payload
        else:
            return []

        return [
            deepcopy(route)
            for route in raw_routes
            if isinstance(route, dict)
        ]

    @staticmethod
    def _read_legacy_file() -> Any:
        """Read the legacy route JSON file."""
        return json.loads(
            LEGACY_ROUTES_FILE.read_text(encoding="utf-8")
        )
