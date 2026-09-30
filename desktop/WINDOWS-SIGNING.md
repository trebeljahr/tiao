# Windows signing verification

`.github/workflows/windows-signing.yml` is a manual, main-only, artifact-only build.
It does not create releases, push tags, or upload to stores. Existing desktop and
Steam release workflows do not use this signing configuration yet.

The workflow installs the pinned `ArtifactSigning` PowerShell module (0.1.20),
logs in with GitHub OIDC, and uses `electron-builder.windows-signing.cjs`.
The custom hook signs during packaging, including the embedded NSIS uninstaller.
Signing failures stop packaging. The publisher is also recorded in updater metadata.

Azure configuration:

- Application/client ID: `3b02aa37-f2ac-45aa-a6c2-112f54f2c189`
- Tenant: `ce0c906e-8a84-4877-afd9-cdf103ddaacb`
- Subscription: `4aaef5a5-286b-46a0-b9e4-84622e8fdc4f`
- Federated subject: `repo:trebeljahr/tiao:ref:refs/heads/main`
- Audience: `api://AzureADTokenExchange`
- Role: Artifact Signing Certificate Profile Signer
- Role scope: `ricoslabs-signing` account, `ricoslabs-public` certificate profile
- Endpoint: `https://weu.codesigning.azure.net/`
- Required publisher: `Ricos Labs LLC`

These IDs are public configuration, not secrets. This identity has no password or
certificate credential. It cannot authenticate from pull requests or other branches.

After the workflow is available on remote main, dispatch `windows-signing` there.
A successful run uploads NSIS and portable executables plus
`windows-signatures.json`, which records Authenticode status, publisher, certificate
subject/thumbprint, timestamp subject, and SHA-256 for the unpacked app, outer
installers, installed app, and installed uninstaller. The silent install runs only
on the disposable Windows runner. Artifacts expire after 14 days.

Do not claim signing is verified from static checks alone. A hosted Windows run
must complete signature verification before these artifacts are trusted for use.
