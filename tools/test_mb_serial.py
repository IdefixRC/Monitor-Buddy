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

    def test_coins_points_at_the_file_form(self):
        for arg in ("coins=BTC-USD", "coins="):
            with self.assertRaisesRegex(ValueError, "set @file"):
                mb_serial.parse_set_args([arg])

    def test_coins_via_file_body(self):
        body = '{"config":{"coins":[{"pair":"BTC-USD","source":"coinbase","on":true}]}}'
        self.assertEqual(mb_serial.parse_set_args([body])["config"]["coins"][0]["pair"], "BTC-USD")

    def test_coin_page_switch(self):
        self.assertEqual(mb_serial.parse_set_args(["pages.coin=false"]), {"config": {"pages": {"coin": False}}})


if __name__ == "__main__":
    unittest.main()
