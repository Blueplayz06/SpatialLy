from datetime import datetime, timezone, timedelta
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from data.simulate_crowd import generate_pattern_series

NOW = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc)


def test_ramp_pattern_starts_low_and_ends_near_capacity():
    series = generate_pattern_series(capacity=100, pattern="ramp", minutes=20, end_time=NOW)
    assert len(series) == 21
    # First entry should be ~25% capacity
    assert 20 <= series[0][1] <= 30
    # Final entry should be ~90-95% capacity
    assert 88 <= series[-1][1] <= 95
    # Timestamps should be ordered chronologically
    for i in range(len(series) - 1):
        assert series[i][0] < series[i + 1][0]
        # Counts should generally increase in a ramp
        assert series[i][1] <= series[i + 1][1]


def test_dispersal_pattern_clears_crowd():
    series = generate_pattern_series(capacity=200, pattern="dispersal", minutes=15, end_time=NOW)
    assert len(series) == 16
    assert series[0][1] > series[-1][1]
    assert series[-1][1] <= 40  # dropped to low percentage


def test_surge_pattern_has_inflection_point():
    series = generate_pattern_series(capacity=100, pattern="surge", minutes=20, end_time=NOW)
    mid_idx = len(series) // 2
    # Influx accelerates in the second half
    first_half_gain = series[mid_idx][1] - series[0][1]
    second_half_gain = series[-1][1] - series[mid_idx][1]
    assert second_half_gain > first_half_gain


def test_plateau_stays_around_nominal_load():
    series = generate_pattern_series(capacity=100, pattern="plateau", minutes=10, end_time=NOW)
    for _, count in series:
        assert 35 <= count <= 55
