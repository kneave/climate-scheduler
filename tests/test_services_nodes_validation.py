import pytest


def test_normalize_nodes_payload_accepts_json_string() -> None:
    from custom_components.climate_scheduler.services import normalize_nodes_payload

    parsed = normalize_nodes_payload('[{"time":"06:30","temp":20}]', "set_schedule")

    assert parsed == [{"time": "06:30", "temp": 20}]


def test_normalize_nodes_payload_rejects_invalid_json_string() -> None:
    from custom_components.climate_scheduler.services import normalize_nodes_payload

    with pytest.raises(ValueError, match="valid JSON"):
        normalize_nodes_payload('{"time":"06:30"', "set_schedule")


def test_normalize_nodes_payload_rejects_invalid_node() -> None:
    from custom_components.climate_scheduler.services import normalize_nodes_payload

    with pytest.raises(ValueError, match="invalid node"):
        normalize_nodes_payload([{"time": "06:30", "temp": "hot"}], "set_schedule")
