from datetime import date

from comuro.models import ConstructionSite


def site(end=date(2026, 11, 13), status="aktuell"):
    return ConstructionSite(
        construction_id="dortmund:1",
        status=status,
        name="Teststraße",
        geometry={"type": "Point", "coordinates": [7.4, 51.5]},
        start=date(2026, 10, 1),
        end=end,
        restriction=None,
    )


def test_fingerprint_changes_when_end_date_changes():
    assert site().fingerprint != site(date(2026, 11, 20)).fingerprint
