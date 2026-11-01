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


if __name__ == "__main__":
    unittest.main()
