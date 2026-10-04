"""Validate an App Store provisioning profile and optionally render export options."""
import datetime
import os
import plistlib
import sys

TEAM = "4BHY8H2J25"
BUNDLE = "com.ricoslabs.tiao"


def validate(profile):
    entitlements = profile.get("Entitlements", {})
    if profile.get("TeamIdentifier") != [TEAM] or entitlements.get("application-identifier") != TEAM + "." + BUNDLE:
        raise ValueError("Provisioning profile belongs to another team or bundle ID.")
    if profile.get("ProvisionedDevices") is not None or profile.get("ProvisionsAllDevices") or entitlements.get("get-task-allow"):
        raise ValueError("Use an App Store distribution profile, not development, ad hoc or enterprise.")
    if not entitlements.get("beta-reports-active"):
        raise ValueError("Profile does not support App Store/TestFlight distribution.")
    expiry = profile.get("ExpirationDate")
    if not isinstance(expiry, datetime.datetime) or expiry <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
        raise ValueError("Provisioning profile is expired or has no expiration.")
    if not profile.get("Name") or not profile.get("DeveloperCertificates"):
        raise ValueError("Profile has no name or distribution certificate.")
    return profile["Name"]


if __name__ == "__main__":
    with open(sys.argv[1], "rb") as stream:
        profile = plistlib.load(stream)
    name = validate(profile)
    print("App Store profile validated for " + BUNDLE)
    if len(sys.argv) == 3:
        options = {
            "method": "app-store-connect", "destination": "export", "teamID": TEAM,
            "signingStyle": "manual", "signingCertificate": "Apple Distribution",
            "provisioningProfiles": {BUNDLE: name}, "uploadSymbols": True,
            "stripSwiftSymbols": True, "manageAppVersionAndBuildNumber": False,
        }
        with open(sys.argv[2], "wb") as stream:
            plistlib.dump(options, stream)
        # Newlines cannot be injected into the workflow environment file.
        if "\n" in name or "\r" in name:
            raise ValueError("Invalid profile name.")
        with open(os.environ["GITHUB_ENV"], "a") as stream:
            stream.write("APPLE_PROVISIONING_PROFILE_NAME=" + name + "\n")
            stream.write("IOS_EXPORT_OPTIONS=" + sys.argv[2] + "\n")
