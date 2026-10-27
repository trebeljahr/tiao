// Only Apple artifacts may come from the explicitly enabled local runner.
// Callers still verify the repository, workflow, main ref, exact commit and
// manifest hashes. Other platforms must retain GitHub-hosted provenance.
export function attestationRunnerArgs(platform, env = process.env) {
  const localApple = ["macos", "mas", "ios"].includes(platform) && env.APPLE_RUNNER?.trim();
  return localApple ? [] : ["--deny-self-hosted-runners"];
}
