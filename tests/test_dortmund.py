from datetime import date

from custom_components.comuro.dortmund import DortmundProvider


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, current_record, planned_record):
        self.current_record = current_record
        self.planned_record = planned_record

    def get(self, url, **kwargs):
        record = (
            self.current_record
            if "tagesaktuell" in url
            else self.planned_record
        )
        return FakeResponse({
            "results": [record],
        })


def sample_record(status_fields=None):
    record = {
        "geo_shape": {
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [7.45, 51.51],
                    [7.451, 51.51],
                    [7.451, 51.511],
                    [7.45, 51.511],
                    [7.45, 51.51],
                ]],
            }
        },
        "geo_point_2d": {
            "lon": 7.4505,
            "lat": 51.5105,
        },
        "art_der_baumassnahme": (
            "Teststraße - Deckensanierung // Vollsperrung"
        ),
        "auftraggeber": "Stadt Dortmund",
        "einschrankung": None,
        "zeitraum": "02.10.2026 - 13.11.2026",
        "von": "2026-10-02",
        "bis": "2026-11-13",
        "stadtbezirk": "Hombruch",
        "status": status_fields or "geplant",
        "kommune": "Dortmund",
        "strasse": "Teststraße",
    }
    return record


def test_normalizes_current_dortmund_schema():
    provider = DortmundProvider(
        session=FakeSession(
            sample_record("aktuell"),
            sample_record("geplant"),
        )
    )

    sites = provider.fetch_dataset(
        "aktuell",
        "https://example.test/tagesaktuell-flachen",
    )

    assert len(sites) == 1
    assert sites[0].construction_id.startswith("dortmund:")
    assert sites[0].name == "Teststraße"
    assert sites[0].status == "aktuell"
    assert sites[0].start == date(2026, 10, 2)
    assert sites[0].end == date(2026, 11, 13)
    assert sites[0].restriction is None
    assert sites[0].raw_data["art_der_baumassnahme"].endswith(
        "Vollsperrung"
    )


def test_same_site_in_planned_and_current_prefers_current():
    provider = DortmundProvider(
        session=FakeSession(
            sample_record("aktuell"),
            sample_record("geplant"),
        )
    )

    sites = provider.fetch_snapshot()

    assert len(sites) == 1
    assert sites[0].status == "aktuell"


def test_fallback_construction_id_is_stable_when_end_date_changes():
    first = sample_record("geplant")
    second = sample_record("geplant")
    second["bis"] = "2026-11-20"
    second["zeitraum"] = "02.10.2026 - 20.11.2026"

    first_site = DortmundProvider._normalize_record(
        first,
        "geplant",
    )
    second_site = DortmundProvider._normalize_record(
        second,
        "geplant",
    )

    assert first_site is not None
    assert second_site is not None
    assert first_site.construction_id == second_site.construction_id

def test_default_session_retries_transient_http_errors():
    provider = DortmundProvider()

    adapter = provider.session.get_adapter("https://example.test")
    retry = adapter.max_retries

    assert retry.total == 3
    assert retry.status == 3
    assert retry.connect == 3
    assert retry.read == 3
    assert retry.backoff_max == 30
    assert 503 in retry.status_forcelist
    assert 429 in retry.status_forcelist
    assert retry.allowed_methods == frozenset({"GET"})
