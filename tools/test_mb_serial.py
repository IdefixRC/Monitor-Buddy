import unittest
import mb_serial


class ParseSetArgs(unittest.TestCase):
    def test_stocks_list(self):
        self.assertEqual(mb_serial.parse_set_args(["stocks=aapl, msft"]),
                         {"config": {"stocks": [{"symbol": "AAPL", "on": True},
                                                {"symbol": "MSFT", "on": True}]}})

    def test_stocks_skips_empty_parts(self):
        self.assertEqual(mb_serial.parse_set_args(["stocks=a,,b,"])["config"]["stocks"],
                         [{"symbol": "A", "on": True}, {"symbol": "B", "on": True}])

    def test_stocks_needs_a_ticker(self):
        for arg in ("stocks=", "stocks=,, ,"):
            with self.assertRaisesRegex(ValueError, "at least one ticker"):
                mb_serial.parse_set_args([arg])

    def test_ticker_still_works(self):
        self.assertEqual(mb_serial.parse_set_args(["ticker=AVGO"]), {"config": {"ticker": "AVGO"}})

    def test_expected_keys_by_version(self):
        self.assertNotIn("stocks", mb_serial.expected_keys(1))
        self.assertIn("stocks", mb_serial.expected_keys(2))
        self.assertNotIn("coins", mb_serial.expected_keys(1))
        self.assertIn("coins", mb_serial.expected_keys(2))
        for key in ("clock_format", "night", "brightness"):
            self.assertNotIn(key, mb_serial.expected_keys(1))
            self.assertIn(key, mb_serial.expected_keys(2))

    def test_set_clock_format_and_night_fields(self):
        self.assertEqual(mb_serial.parse_set_args(["clock_format=12h"]), {"config": {"clock_format": "12h"}})
        self.assertEqual(mb_serial.parse_set_args(["night.start=22", "night.enabled=true"]),
                         {"config": {"night": {"start": 22, "enabled": True}}})
        with self.assertRaises(ValueError):
            mb_serial.parse_set_args(["night.start=late"])
        with self.assertRaises(ValueError):
            mb_serial.parse_set_args(["night.colour=1"])

    def test_set_brightness_is_a_number(self):
        self.assertEqual(mb_serial.parse_set_args(["brightness=200"]), {"config": {"brightness": 200}})
        with self.assertRaisesRegex(ValueError, "brightness must be a whole number"):
            mb_serial.parse_set_args(["brightness=bright"])

    def test_coins_points_at_the_file_form(self):
        for arg in ("coins=BTC-USD", "coins="):
            with self.assertRaisesRegex(ValueError, "set @file"):
                mb_serial.parse_set_args([arg])

    def test_coins_via_file_body(self):
        body = '{"config":{"coins":[{"pair":"BTC-USD","source":"coinbase","on":true}]}}'
        self.assertEqual(mb_serial.parse_set_args([body])["config"]["coins"][0]["pair"], "BTC-USD")

    def test_coin_page_switch(self):
        self.assertEqual(mb_serial.parse_set_args(["pages.coin=false"]), {"config": {"pages": {"coin": False}}})


class VerifyChange(unittest.TestCase):
    def verify(self, want, have):
        from unittest import mock
        with mock.patch.object(mb_serial, "_read_ok", return_value={"config": have}):
            return mb_serial.verify_change(None, "SET", {"config": want})

    def test_night_fields_are_compared_one_by_one(self):
        have = {"night": {"enabled": False, "start": 22, "end": 7, "brightness": 40}}
        self.assertEqual(self.verify({"night": {"start": 22}}, have)[0], True)
        self.assertEqual(self.verify({"night": {"start": 22, "enabled": False}}, have)[0], True)
        ok, detail = self.verify({"night": {"start": 21}}, have)
        self.assertFalse(ok)
        self.assertIn("night.start", detail)
        self.assertFalse(self.verify({"night": {"enabled": True}}, have)[0])
        self.assertFalse(self.verify({"night": {"start": 22}}, {})[0])

    def test_pages_still_compared_one_by_one(self):
        self.assertTrue(self.verify({"pages": {"coin": False}}, {"pages": {"coin": False, "moon": True}})[0])
        self.assertFalse(self.verify({"pages": {"coin": True}}, {"pages": {"coin": False}})[0])


if __name__ == "__main__":
    unittest.main()
