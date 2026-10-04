import copy
import datetime
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("profile_validator", Path(__file__).with_name("ios-profile.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AppStoreProfileTests(unittest.TestCase):
    def setUp(self):
        self.profile = {
            "Name": "Tiao App Store",
            "TeamIdentifier": ["4BHY8H2J25"],
            "ExpirationDate": datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(days=1),
            "DeveloperCertificates": [b"test-public-certificate"],
            "Entitlements": {
                "application-identifier": "4BHY8H2J25.com.ricoslabs.tiao",
                "get-task-allow": False,
                "beta-reports-active": True,
            },
        }

    def test_accepts_app_store_profile(self):
        self.assertEqual(module.validate(self.profile), "Tiao App Store")

    def test_rejects_other_app_and_other_team(self):
        for change in [
            {"TeamIdentifier": ["OTHERTEAM"]},
            {"Entitlements": {**self.profile["Entitlements"], "application-identifier": "4BHY8H2J25.com.ricoslabs.trackyourtime"}},
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.validate({**self.profile, **change})

    def test_rejects_expired_development_adhoc_and_enterprise_profiles(self):
        for change in [
            {"ExpirationDate": datetime.datetime(2020, 1, 1)},
            {"ProvisionedDevices": ["fake-device"]},
            {"ProvisionsAllDevices": True},
            {"Entitlements": {**self.profile["Entitlements"], "get-task-allow": True}},
            {"Entitlements": {**self.profile["Entitlements"], "beta-reports-active": False}},
            {"DeveloperCertificates": []},
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.validate({**copy.deepcopy(self.profile), **change})


if __name__ == "__main__":
    unittest.main()
