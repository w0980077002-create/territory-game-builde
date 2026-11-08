#!/usr/bin/env python3
"""Regression tests: never accept a cosmetically changed but incomplete AI draft."""
import unittest

from free_issue_agent import verify_css_task_acceptance


class VisualAgentQualityTest(unittest.TestCase):
    def test_reject_one_gradient_when_two_requested(self):
        with self.assertRaisesRegex(ValueError, "2 gradient layers"):
            verify_css_task_acceptance(
                "REQUEST: Сделай сияние из двух radial-gradient для сундука",
                {"value": "radial-gradient(circle, #fdd, transparent)"}
            )

    def test_accept_two_gradients_with_transparent_edge(self):
        verify_css_task_acceptance(
            "QUALITY_MIN_GRADIENT_LAYERS: 2\nQUALITY_REQUIRE_TRANSPARENT_EDGE: yes",
            {"value": "radial-gradient(circle, #ffb, transparent 70%), "
                      "radial-gradient(circle, #a72, transparent 80%)"}
        )

    def test_explicit_quality_rejects_one_flat_layer(self):
        with self.assertRaisesRegex(ValueError, "2 gradient layers"):
            verify_css_task_acceptance(
                "QUALITY_MIN_GRADIENT_LAYERS: 2",
                {"value": "linear-gradient(#432, #210)"}
            )

    def test_missing_required_value_fails(self):
        with self.assertRaisesRegex(ValueError, "Required acceptance text missing"):
            verify_css_task_acceptance(
                "QUALITY_REQUIRED_VALUE_TEXT: rgba(255,215,119",
                {"value": "linear-gradient(#432, #210)"}
            )

    def test_plain_safe_change_no_requirement(self):
        verify_css_task_acceptance(
            "REQUEST: change only an existing button shadow",
            {"value": "0 2px 6px rgba(0,0,0,.5)"}
        )


if __name__ == "__main__":
    unittest.main()
